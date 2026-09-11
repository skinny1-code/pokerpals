// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChipsStakingView {
    function stakes(address player) external view returns (
        uint256 amount, uint256 since, uint256 lastClaim, uint8 tier
    );
}

/// @title StakerLottery — weekly no-loss prize draw for SALOON stakers
/// @notice The "risk-free gain" mechanic: staked principal is never touched.
///         Each epoch (default 7 days) any staker with tier >= 1 may enter()
///         once, free; their ticket weight equals their staked SALOON. When the
///         epoch ends anyone may call draw(): a weighted-random entrant wins
///         the whole prize, and the next epoch begins. If nobody entered, the
///         prize rolls over. Prizes are funded from the PromotionsPool via
///         fundPrize() (typically by the weekly lottery:draw script).
///
///         Settling is two-phase, because randomness has to be committed to
///         before it exists. requestDraw() fixes a future block; draw() then
///         derives the winner from THAT block's hash. See requestDraw().
contract StakerLottery is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20            public immutable chipsToken;
    IChipsStakingView public immutable staking;

    uint256 public epochDuration = 7 days;
    uint256 public epochId;
    uint256 public epochStart;

    /// @notice Block whose hash will decide the current epoch, or 0 when no draw
    ///         has been requested. Set by requestDraw(), consumed by draw().
    uint256 public drawRevealBlock;

    /// @notice Blocks between requestDraw() and the deciding block. Tunable
    ///         because chains differ wildly in how fast block.number advances;
    ///         it cannot bias the outcome, since no one can predict a future
    ///         block hash whatever the delay.
    uint256 public drawDelayBlocks = 5;

    struct EpochData {
        address[] entrants;
        mapping(address => uint256) tickets; // 0 = not entered
        uint256 totalTickets;
        uint256 prize;
        address winner;
    }
    mapping(uint256 => EpochData) private _epochs;

    event Entered(uint256 indexed epochId, address indexed player, uint256 tickets);
    event PrizeFunded(uint256 indexed epochId, address indexed from, uint256 amount);
    event Drawn(uint256 indexed epochId, address indexed winner, uint256 prize, uint256 entrants);
    event RolledOver(uint256 indexed epochId, uint256 prize);
    event DrawRequested(uint256 indexed epochId, uint256 revealBlock);
    event DrawExpired(uint256 indexed epochId, uint256 revealBlock);

    constructor(address _chipsToken, address _staking) Ownable(msg.sender) {
        chipsToken = IERC20(_chipsToken);
        staking    = IChipsStakingView(_staking);
        epochStart = block.timestamp;
    }

    // ─── PLAY ─────────────────────────────────────────────────────────────────

    /// @notice Enter this epoch's draw. Free; requires an active stake (tier >= 1).
    ///         Ticket weight = staked SALOON at entry time.
    function enter() external nonReentrant {
        require(block.timestamp < epochStart + epochDuration, "Epoch over - call draw()");
        (uint256 amount,,, uint8 tier) = staking.stakes(msg.sender);
        require(tier >= 1 && amount > 0, "Stake 25K+ SALOON to enter");

        EpochData storage e = _epochs[epochId];
        require(e.tickets[msg.sender] == 0, "Already entered");

        uint256 tickets = amount / 1e18; // whole SALOON
        e.tickets[msg.sender] = tickets;
        e.totalTickets       += tickets;
        e.entrants.push(msg.sender);
        emit Entered(epochId, msg.sender, tickets);
    }

    /// @notice Add SALOON to the current epoch's prize. Open to anyone —
    ///         typically the owner forwarding a PromotionsPool withdrawal.
    function fundPrize(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        _epochs[epochId].prize += amount;
        emit PrizeFunded(epochId, msg.sender, amount);
    }

    /// @notice Commit the finished epoch to a future block, whose hash will pick
    ///         the winner. Anyone may call, once the epoch's time is up.
    ///
    ///         This is the whole point of splitting settlement in two. Deriving
    ///         the winner from `blockhash(block.number - 1)` inside draw() —
    ///         which is what this contract used to do — decides nothing: that
    ///         hash already exists when the transaction is built, so any entrant
    ///         could simulate the draw, submit only in blocks where they win,
    ///         and wrap the call in a contract that reverts otherwise. Retrying
    ///         every block costs only gas on a revert. Committing first removes
    ///         that: entries are already frozen (enter() closes when the epoch
    ///         ends), and the deciding hash does not exist yet.
    ///
    ///         Residual risk, stated plainly: blockhash is only readable for 256
    ///         blocks, so a request that nobody settles in time expires and must
    ///         be re-made. Someone who dislikes the pending outcome can let it
    ///         lapse and re-request — but only if no one else calls draw() in
    ///         the whole window, and each attempt buys one fresh 1-in-N chance.
    ///         Run lottery:draw as request-then-settle to close the window. A
    ///         VRF, once one exists on the target chain, removes even that.
    function requestDraw() external {
        require(block.timestamp >= epochStart + epochDuration, "Epoch still running");
        if (drawRevealBlock != 0) {
            require(_requestExpired(), "Draw already requested");
            emit DrawExpired(epochId, drawRevealBlock);
        }
        drawRevealBlock = block.number + drawDelayBlocks;
        emit DrawRequested(epochId, drawRevealBlock);
    }

    /// @notice Settle the epoch: pay a weighted-random entrant, or roll the
    ///         prize over if nobody entered. Anyone may call. Starts the next
    ///         epoch either way. Needs a matured requestDraw() unless the epoch
    ///         is empty, which needs no randomness at all.
    function draw() external nonReentrant {
        require(block.timestamp >= epochStart + epochDuration, "Epoch still running");
        EpochData storage e = _epochs[epochId];

        if (e.totalTickets == 0 || e.entrants.length == 0) {
            // Nobody entered — carry the prize into the next epoch.
            uint256 carried = e.prize;
            emit RolledOver(epochId, carried);
            _advanceEpoch();
            _epochs[epochId].prize += carried;
            return;
        }

        require(drawRevealBlock != 0, "Call requestDraw() first");
        require(block.number > drawRevealBlock, "Randomness not ready");
        bytes32 revealHash = blockhash(drawRevealBlock);
        require(revealHash != bytes32(0), "Randomness expired - requestDraw() again");

        // Slither flags any blockhash-derived value as a weak PRNG, and for a
        // one-phase draw it would be right. revealHash belongs to a block chosen
        // by requestDraw() before that block existed, with entries already
        // frozen — see requestDraw() for what this does and does not defend.
        uint256 r = uint256(keccak256(abi.encodePacked(
            revealHash, address(this), epochId
        ))) % e.totalTickets;

        address winner;
        uint256 cumulative;
        for (uint256 i = 0; i < e.entrants.length; i++) {
            cumulative += e.tickets[e.entrants[i]];
            if (r < cumulative) { winner = e.entrants[i]; break; }
        }

        uint256 prize = e.prize;
        e.winner = winner;
        emit Drawn(epochId, winner, prize, e.entrants.length);
        _advanceEpoch();
        if (prize > 0) chipsToken.safeTransfer(winner, prize);
    }

    /// @notice True once a pending request's block is too old for blockhash().
    function _requestExpired() internal view returns (bool) {
        // The zero check is the point, not an accident: blockhash() returns
        // exactly zero for a block outside its 256-block window, which is how a
        // commit is known to have expired.
        return drawRevealBlock != 0
            && block.number > drawRevealBlock
            && blockhash(drawRevealBlock) == bytes32(0);
    }

    function _advanceEpoch() internal {
        epochId        += 1;
        epochStart      = block.timestamp;
        drawRevealBlock = 0;
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function currentEpoch() external view returns (
        uint256 id, uint256 endsAt, uint256 prize, uint256 entrants, uint256 totalTickets
    ) {
        EpochData storage e = _epochs[epochId];
        return (epochId, epochStart + epochDuration, e.prize, e.entrants.length, e.totalTickets);
    }

    /// @notice What draw() needs before it will settle the current epoch.
    ///         `ready` means draw() will succeed now (or the epoch is empty and
    ///         needs no randomness); `expired` means requestDraw() must be
    ///         called again.
    function drawStatus() external view returns (
        uint256 revealBlock, bool requested, bool ready, bool expired
    ) {
        EpochData storage e = _epochs[epochId];
        bool overdue = block.timestamp >= epochStart + epochDuration;
        bool empty   = e.totalTickets == 0 || e.entrants.length == 0;
        bool exp     = _requestExpired();
        bool matured = drawRevealBlock != 0
            && block.number > drawRevealBlock
            && blockhash(drawRevealBlock) != bytes32(0);
        return (drawRevealBlock, drawRevealBlock != 0, overdue && (empty || matured), exp);
    }

    function myTickets(address player) external view returns (uint256) {
        return _epochs[epochId].tickets[player];
    }

    function epochWinner(uint256 id) external view returns (address winner, uint256 prize) {
        EpochData storage e = _epochs[id];
        return (e.winner, e.prize);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    function setEpochDuration(uint256 secs) external onlyOwner {
        require(secs >= 1 hours && secs <= 30 days, "1h-30d");
        epochDuration = secs;
    }

    /// @notice Tune how far ahead requestDraw() commits. Bounded well inside
    ///         blockhash()'s 256-block lookback so a request always has a
    ///         usable settle window.
    function setDrawDelayBlocks(uint256 blocks_) external onlyOwner {
        require(blocks_ >= 1 && blocks_ <= 100, "1-100 blocks");
        drawDelayBlocks = blocks_;
    }

    /// @notice Rescue tokens other than SALOON sent here by mistake.
    function sweep(address token, address to) external onlyOwner {
        require(token != address(chipsToken), "SALOON are prize funds");
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }
}
