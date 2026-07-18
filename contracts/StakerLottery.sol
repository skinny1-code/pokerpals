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

/// @title StakerLottery — weekly no-loss prize draw for CHIPS stakers
/// @notice The "risk-free gain" mechanic: staked principal is never touched.
///         Each epoch (default 7 days) any staker with tier >= 1 may enter()
///         once, free; their ticket weight equals their staked CHIPS. When the
///         epoch ends anyone may call draw(): a weighted-random entrant wins
///         the whole prize, and the next epoch begins. If nobody entered, the
///         prize rolls over. Prizes are funded from the PromotionsPool via
///         fundPrize() (typically by the weekly lottery:draw script).
///
///         Randomness comes from the previous blockhash — acceptable for
///         testnet stakes but manipulable by a motivated sequencer. Before
///         mainnet, swap _random() for a VRF or commit-reveal source.
contract StakerLottery is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20            public immutable chipsToken;
    IChipsStakingView public immutable staking;

    uint256 public epochDuration = 7 days;
    uint256 public epochId;
    uint256 public epochStart;

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

    constructor(address _chipsToken, address _staking) Ownable(msg.sender) {
        chipsToken = IERC20(_chipsToken);
        staking    = IChipsStakingView(_staking);
        epochStart = block.timestamp;
    }

    // ─── PLAY ─────────────────────────────────────────────────────────────────

    /// @notice Enter this epoch's draw. Free; requires an active stake (tier >= 1).
    ///         Ticket weight = staked CHIPS at entry time.
    function enter() external nonReentrant {
        require(block.timestamp < epochStart + epochDuration, "Epoch over - call draw()");
        (uint256 amount,,, uint8 tier) = staking.stakes(msg.sender);
        require(tier >= 1 && amount > 0, "Stake 25K+ CHIPS to enter");

        EpochData storage e = _epochs[epochId];
        require(e.tickets[msg.sender] == 0, "Already entered");

        uint256 tickets = amount / 1e18; // whole CHIPS
        e.tickets[msg.sender] = tickets;
        e.totalTickets       += tickets;
        e.entrants.push(msg.sender);
        emit Entered(epochId, msg.sender, tickets);
    }

    /// @notice Add CHIPS to the current epoch's prize. Open to anyone —
    ///         typically the owner forwarding a PromotionsPool withdrawal.
    function fundPrize(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        _epochs[epochId].prize += amount;
        emit PrizeFunded(epochId, msg.sender, amount);
    }

    /// @notice Settle the epoch once its time is up: pick a weighted-random
    ///         winner and pay the prize, or roll the prize over if nobody
    ///         entered. Anyone may call. Starts the next epoch either way.
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

        uint256 r = _random() % e.totalTickets;
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

    function _advanceEpoch() internal {
        epochId    += 1;
        epochStart  = block.timestamp;
    }

    function _random() internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1), address(this), epochId
        )));
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function currentEpoch() external view returns (
        uint256 id, uint256 endsAt, uint256 prize, uint256 entrants, uint256 totalTickets
    ) {
        EpochData storage e = _epochs[epochId];
        return (epochId, epochStart + epochDuration, e.prize, e.entrants.length, e.totalTickets);
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

    /// @notice Rescue tokens other than CHIPS sent here by mistake.
    function sweep(address token, address to) external onlyOwner {
        require(token != address(chipsToken), "CHIPS are prize funds");
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }
}
