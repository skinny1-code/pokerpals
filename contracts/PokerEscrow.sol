// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IChipsToken is IERC20 {
    function burn(uint256 amount) external;
}
interface IChipsStaking {
    function getTier(address player) external view returns (uint8);
    function receiveYield(uint256 amount) external;
}
interface IReferralRegistry {
    function getReferrer(address player) external view returns (address);
    function creditRake(address player, uint256 rakeAmount) external;
}

/// @title PokerEscrow — seat fees + VIP rake tiers + referral splits + auto rake distribution
///
/// Rake split (of total rake per hand):
///   10% → referrer (if player has one)
///   35% → burned (deflationary)
///   35% → staking yield pool (stakers earn from every hand)
///   20% → treasury (rakeRecipient)
contract PokerEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IChipsToken;
    using ECDSA for bytes32;

    enum TableStatus { Open, Active, Closed }
    enum GameType    { HoldEm, Omaha, ShortDeck, Pineapple }

    struct Table {
        uint256 id;
        address creator;
        uint256 buyInAmount;
        uint256 bigBlind;
        uint8   maxPlayers;
        GameType gameType;
        TableStatus status;
        address[] players;
        mapping(address => uint256) chips;
        mapping(address => uint256) deposits;
        uint256 potTotal;
        uint256 handNonce;
    }

    // VIP tier rake rates (/1000). Index = tier 0-4
    uint256[5] public tierRakeNum = [15, 13, 11, 9, 6]; // 1.5% → 0.6%
    uint256 public rakeDen      = 1000;
    uint256 public rakeCapCHIPS = 50 * 10**18;
    uint256 public seatFeeCHIPS = 2  * 10**18; // flat per seat

    // Rake distribution (bps / 10000, must sum to 10000)
    uint256 public rakeBurnBps     = 3500; // 35% burned
    uint256 public rakeStakingBps  = 3500; // 35% to staking yield
    uint256 public rakeTreasuryBps = 2000; // 20% to treasury
    uint256 public referralBps     = 1000; // 10% to referrer

    IChipsToken       public immutable chipsToken;
    IChipsStaking     public stakingContract;
    IReferralRegistry public referralRegistry;
    address public operatorSigner;
    address public rakeRecipient;
    address public antiBotOracle;

    uint256 public tableCount;
    mapping(uint256 => Table) private tables;
    mapping(bytes32 => bool)  public usedSettleHashes;
    mapping(address => bool)  public humanVerified;

    // Revenue tracking
    uint256 public totalRakeCollected;
    uint256 public totalRakeBurned;
    uint256 public totalRakeToStaking;
    uint256 public totalSeatFeesCollected;
    uint256 public totalReferralsPaid;

    event TableCreated(uint256 indexed id, address creator, uint256 buyIn, GameType g);
    event PlayerJoined(uint256 indexed id, address player, uint256 buyIn, uint256 seatFee);
    event HandSettled(
        uint256 indexed id, uint256 nonce,
        address[] winners, uint256[] payouts,
        uint256 rake, uint256 burned, uint256 toStaking, uint256 referralPaid
    );
    event HumanVerified(address indexed player, bool status);

    error NotHuman(address p);
    error TableNotOpen(uint256 id);
    error AlreadySeated(address p);
    error TableFull(uint256 id);
    error InvalidSig();
    error AlreadySettled(bytes32 h);

    constructor(
        address _token, address _signer, address _rake,
        address _oracle, address _staking, address _referral
    ) Ownable(msg.sender) {
        chipsToken       = IChipsToken(_token);
        operatorSigner   = _signer;
        rakeRecipient    = _rake;
        antiBotOracle    = _oracle;
        stakingContract  = IChipsStaking(_staking);
        referralRegistry = IReferralRegistry(_referral);
    }

    // ─── ANTI-BOT ─────────────────────────────────────────────────────────────
    function markHuman(address player, bool status) external {
        require(msg.sender == antiBotOracle || msg.sender == owner(), "Unauthorized");
        humanVerified[player] = status;
        emit HumanVerified(player, status);
    }

    // ─── TABLE ────────────────────────────────────────────────────────────────
    function createTable(uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers, uint8 gameType)
        external returns (uint256 id)
    {
        require(buyInAmount >= bigBlind * 10, "Buy-in too small");
        require(maxPlayers >= 2 && maxPlayers <= 9, "Bad seats");
        id = ++tableCount;
        Table storage t = tables[id];
        t.id = id; t.creator = msg.sender; t.buyInAmount = buyInAmount;
        t.bigBlind = bigBlind; t.maxPlayers = maxPlayers;
        t.gameType = GameType(gameType); t.status = TableStatus.Open;
        emit TableCreated(id, msg.sender, buyInAmount, GameType(gameType));
    }

    function buyIn(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        if (t.status != TableStatus.Open)    revert TableNotOpen(tableId);
        if (!humanVerified[msg.sender])       revert NotHuman(msg.sender);
        if (t.deposits[msg.sender] > 0)       revert AlreadySeated(msg.sender);
        if (t.players.length >= t.maxPlayers) revert TableFull(tableId);

        uint256 total = t.buyInAmount + seatFeeCHIPS;
        chipsToken.safeTransferFrom(msg.sender, address(this), total);
        chipsToken.safeTransfer(rakeRecipient, seatFeeCHIPS);
        totalSeatFeesCollected += seatFeeCHIPS;

        t.deposits[msg.sender] = t.buyInAmount;
        t.chips[msg.sender]    = t.buyInAmount;
        t.potTotal            += t.buyInAmount;
        t.players.push(msg.sender);
        emit PlayerJoined(tableId, msg.sender, t.buyInAmount, seatFeeCHIPS);
        if (t.players.length == t.maxPlayers) t.status = TableStatus.Active;
    }

    function rebuy(uint256 tableId, uint256 amount) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Active, "Not active");
        require(t.deposits[msg.sender] > 0, "Not seated");
        uint256 fee = seatFeeCHIPS / 2;
        chipsToken.safeTransferFrom(msg.sender, address(this), amount + fee);
        chipsToken.safeTransfer(rakeRecipient, fee);
        totalSeatFeesCollected += fee;
        t.deposits[msg.sender] += amount;
        t.chips[msg.sender]    += amount;
        t.potTotal             += amount;
    }

    // ─── SETTLE ───────────────────────────────────────────────────────────────
    function settle(
        uint256 tableId, uint256 handNonce,
        address[] calldata winners, uint256[] calldata shares, bytes calldata sig
    ) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Active, "Not active");
        require(handNonce == t.handNonce, "Bad nonce");
        require(winners.length == shares.length && winners.length > 0);
        uint256 tot; for (uint i; i < shares.length; i++) tot += shares[i];
        require(tot == 1000);

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(tableId, handNonce, winners, shares))
        );
        if (usedSettleHashes[digest]) revert AlreadySettled(digest);
        if (digest.recover(sig) != operatorSigner) revert InvalidSig();
        usedSettleHashes[digest] = true;

        // VIP tier rake rate (use first winner's tier)
        uint8 tier = address(stakingContract) != address(0)
            ? stakingContract.getTier(winners[0]) : 0;
        if (tier > 4) tier = 4;
        uint256 totalRake = (t.potTotal * tierRakeNum[tier]) / rakeDen;
        if (totalRake > rakeCapCHIPS) totalRake = rakeCapCHIPS;

        // ── Rake distribution ──────────────────────────────────────────────
        uint256 referralPaid;
        if (address(referralRegistry) != address(0) && totalRake > 0) {
            address referrer = referralRegistry.getReferrer(winners[0]);
            if (referrer != address(0)) {
                referralPaid = (totalRake * referralBps) / 10000;
                chipsToken.safeTransfer(referrer, referralPaid);
                referralRegistry.creditRake(winners[0], referralPaid);
            }
        }

        uint256 remaining = totalRake - referralPaid;

        // 35% of total rake → burn
        uint256 burnAmt = (totalRake * rakeBurnBps) / 10000;
        if (burnAmt > remaining) burnAmt = remaining;
        if (burnAmt > 0) chipsToken.burn(burnAmt);
        remaining -= burnAmt;

        // 35% of total rake → staking yield pool
        uint256 stakingAmt = (totalRake * rakeStakingBps) / 10000;
        if (stakingAmt > remaining) stakingAmt = remaining;
        if (stakingAmt > 0) {
            if (address(stakingContract) != address(0)) {
                chipsToken.safeTransfer(address(stakingContract), stakingAmt);
                stakingContract.receiveYield(stakingAmt);
            } else {
                chipsToken.safeTransfer(rakeRecipient, stakingAmt);
            }
        }
        remaining -= stakingAmt;

        // Remaining (~20%) → treasury
        if (remaining > 0) chipsToken.safeTransfer(rakeRecipient, remaining);

        totalRakeCollected  += totalRake;
        totalRakeBurned     += burnAmt;
        totalRakeToStaking  += stakingAmt;
        totalReferralsPaid  += referralPaid;

        // ── Pay winners ────────────────────────────────────────────────────
        uint256 netPot = t.potTotal - totalRake;
        uint256[] memory payouts = new uint256[](winners.length);
        for (uint i; i < winners.length; i++) {
            payouts[i] = (netPot * shares[i]) / 1000;
            chipsToken.safeTransfer(winners[i], payouts[i]);
        }

        t.potTotal = 0;
        t.handNonce++;
        emit HandSettled(tableId, handNonce, winners, payouts, totalRake, burnAmt, stakingAmt, referralPaid);
    }

    function refund(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Open);
        uint256 dep = t.deposits[msg.sender];
        require(dep > 0);
        t.deposits[msg.sender] = 0; t.chips[msg.sender] = 0; t.potTotal -= dep;
        chipsToken.safeTransfer(msg.sender, dep);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────
    function getRevenueSummary() external view returns (
        uint256 rake, uint256 burned, uint256 toStaking, uint256 seats, uint256 refs, uint256 total
    ) {
        return (
            totalRakeCollected, totalRakeBurned, totalRakeToStaking,
            totalSeatFeesCollected, totalReferralsPaid,
            totalRakeCollected + totalSeatFeesCollected
        );
    }

    function getTableInfo(uint256 id) external view returns (
        uint256, uint256, uint256, uint8, uint8, TableStatus, uint256, uint256, uint8
    ) {
        Table storage t = tables[id];
        return (t.id, t.buyInAmount, t.bigBlind, t.maxPlayers, uint8(t.gameType),
                t.status, t.potTotal, t.handNonce, uint8(t.players.length));
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function setRakeParams(uint256[5] calldata tiers, uint256 cap, uint256 seatFee) external onlyOwner {
        for (uint i; i < 5; i++) require(tiers[i] <= 30, "Max 3%");
        tierRakeNum = tiers; rakeCapCHIPS = cap; seatFeeCHIPS = seatFee;
    }

    /// @notice Adjust rake split. All four values must sum to 10000.
    function setRakeSplit(
        uint256 burnBps, uint256 stakingBps, uint256 treasuryBps, uint256 refBps
    ) external onlyOwner {
        require(burnBps + stakingBps + treasuryBps + refBps == 10000, "Must sum to 10000");
        rakeBurnBps     = burnBps;
        rakeStakingBps  = stakingBps;
        rakeTreasuryBps = treasuryBps;
        referralBps     = refBps;
    }

    function setOperatorSigner(address s) external onlyOwner { operatorSigner = s; }
    function setRakeRecipient(address r)  external onlyOwner { rakeRecipient = r; }
    function setStaking(address s)        external onlyOwner { stakingContract = IChipsStaking(s); }
    function setReferral(address r)       external onlyOwner { referralRegistry = IReferralRegistry(r); }
    function setAntiBotOracle(address o)  external onlyOwner { antiBotOracle = o; }
}
