// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IPPPStaking {
    function getTier(address player) external view returns (uint8);
}
interface IReferralRegistry {
    function getReferrer(address player) external view returns (address);
    function creditRake(address player, uint256 rakeAmount) external;
}

/// @title PokerEscrow v2 — seat fees + VIP rake tiers + referral splits
contract PokerEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
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
    uint256 public rakeDen    = 1000;
    uint256 public rakeCapPPP = 50  * 10**18;
    uint256 public seatFeePPP = 2   * 10**18;   // flat per seat
    uint256 public referralRakeShare = 2000;     // 20% of rake to referrer (bps/10000)

    IERC20            public immutable pppToken;
    IPPPStaking       public stakingContract;
    IReferralRegistry public referralRegistry;
    address public operatorSigner;
    address public rakeRecipient;
    address public antiBotOracle;

    uint256 public tableCount;
    mapping(uint256 => Table) private tables;
    mapping(bytes32 => bool)  public usedSettleHashes;
    mapping(address => bool)  public humanVerified;

    // Revenue tracking — readable by frontend dashboard
    uint256 public totalRakeCollected;
    uint256 public totalSeatFeesCollected;
    uint256 public totalReferralsPaid;

    event TableCreated(uint256 indexed id, address creator, uint256 buyIn, GameType g);
    event PlayerJoined(uint256 indexed id, address player, uint256 buyIn, uint256 seatFee);
    event HandSettled(uint256 indexed id, uint256 nonce, address[] winners, uint256[] payouts, uint256 rake, uint256 referralPaid);
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
        pppToken         = IERC20(_token);
        operatorSigner   = _signer;
        rakeRecipient    = _rake;
        antiBotOracle    = _oracle;
        stakingContract  = IPPPStaking(_staking);
        referralRegistry = IReferralRegistry(_referral);
    }

    // ─── ANTI-BOT ─────────────────────────────────────────────────────────────
    function markHuman(address player, bool status) external {
        require(msg.sender == antiBotOracle || msg.sender == owner(), "Unauthorized");
        humanVerified[player] = status;
        emit HumanVerified(player, status);
    }

    // ─── TABLE ────────────────────────────────────────────────────────────────
    function createTable(uint256 buyIn, uint256 bigBlind, uint8 maxPlayers, uint8 gameType)
        external returns (uint256 id)
    {
        require(buyIn >= bigBlind * 10, "Buy-in too small");
        require(maxPlayers >= 2 && maxPlayers <= 9, "Bad seats");
        id = ++tableCount;
        Table storage t = tables[id];
        t.id = id; t.creator = msg.sender; t.buyInAmount = buyIn;
        t.bigBlind = bigBlind; t.maxPlayers = maxPlayers;
        t.gameType = GameType(gameType); t.status = TableStatus.Open;
        emit TableCreated(id, msg.sender, buyIn, GameType(gameType));
    }

    function buyIn(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        if (t.status != TableStatus.Open)     revert TableNotOpen(tableId);
        if (!humanVerified[msg.sender])        revert NotHuman(msg.sender);
        if (t.deposits[msg.sender] > 0)        revert AlreadySeated(msg.sender);
        if (t.players.length >= t.maxPlayers)  revert TableFull(tableId);

        uint256 total = t.buyInAmount + seatFeePPP;
        pppToken.safeTransferFrom(msg.sender, address(this), total);
        pppToken.safeTransfer(rakeRecipient, seatFeePPP);
        totalSeatFeesCollected += seatFeePPP;

        t.deposits[msg.sender] = t.buyInAmount;
        t.chips[msg.sender]    = t.buyInAmount;
        t.potTotal            += t.buyInAmount;
        t.players.push(msg.sender);
        emit PlayerJoined(tableId, msg.sender, t.buyInAmount, seatFeePPP);
        if (t.players.length == t.maxPlayers) t.status = TableStatus.Active;
    }

    function rebuy(uint256 tableId, uint256 amount) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Active, "Not active");
        require(t.deposits[msg.sender] > 0, "Not seated");
        uint256 fee = seatFeePPP / 2;
        pppToken.safeTransferFrom(msg.sender, address(this), amount + fee);
        pppToken.safeTransfer(rakeRecipient, fee);
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

        // VIP tier rake
        uint8 tier = address(stakingContract) != address(0)
            ? stakingContract.getTier(winners[0]) : 0;
        if (tier > 4) tier = 4;
        uint256 rake = (t.potTotal * tierRakeNum[tier]) / rakeDen;
        if (rake > rakeCapPPP) rake = rakeCapPPP;

        // Referral cut
        uint256 referralPaid;
        if (address(referralRegistry) != address(0) && rake > 0) {
            address referrer = referralRegistry.getReferrer(winners[0]);
            if (referrer != address(0)) {
                uint256 cut = (rake * referralRakeShare) / 10000;
                pppToken.safeTransfer(referrer, cut);
                referralPaid = cut;
                rake -= cut;
                referralRegistry.creditRake(winners[0], cut);
            }
        }

        uint256 netPot = t.potTotal - rake - referralPaid;
        uint256[] memory payouts = new uint256[](winners.length);
        for (uint i; i < winners.length; i++) {
            payouts[i] = (netPot * shares[i]) / 1000;
            pppToken.safeTransfer(winners[i], payouts[i]);
        }
        if (rake > 0) { pppToken.safeTransfer(rakeRecipient, rake); totalRakeCollected += rake; }
        totalReferralsPaid += referralPaid;
        t.potTotal = 0; t.handNonce++;
        emit HandSettled(tableId, handNonce, winners, payouts, rake, referralPaid);
    }

    function refund(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Open);
        uint256 dep = t.deposits[msg.sender];
        require(dep > 0);
        t.deposits[msg.sender] = 0; t.chips[msg.sender] = 0; t.potTotal -= dep;
        pppToken.safeTransfer(msg.sender, dep);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────
    function getRevenueSummary() external view returns (uint256 rake, uint256 seats, uint256 refs, uint256 total) {
        rake = totalRakeCollected; seats = totalSeatFeesCollected;
        refs = totalReferralsPaid; total = rake + seats;
    }
    function getTableInfo(uint256 id) external view returns (
        uint256, uint256, uint256, uint8, uint8, TableStatus, uint256, uint256, uint8
    ){
        Table storage t = tables[id];
        return (t.id, t.buyInAmount, t.bigBlind, t.maxPlayers, uint8(t.gameType),
                t.status, t.potTotal, t.handNonce, uint8(t.players.length));
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function setRakeParams(uint256[5] calldata tiers, uint256 cap, uint256 seatFee) external onlyOwner {
        for (uint i; i < 5; i++) require(tiers[i] <= 30, "Max 3%");
        tierRakeNum = tiers; rakeCapPPP = cap; seatFeePPP = seatFee;
    }
    function setReferralShare(uint256 bps) external onlyOwner { require(bps <= 3000); referralRakeShare = bps; }
    function setOperatorSigner(address s)  external onlyOwner { operatorSigner = s; }
    function setRakeRecipient(address r)   external onlyOwner { rakeRecipient = r; }
    function setStaking(address s)         external onlyOwner { stakingContract = IPPPStaking(s); }
    function setReferral(address r)        external onlyOwner { referralRegistry = IReferralRegistry(r); }
    function setAntiBotOracle(address o)   external onlyOwner { antiBotOracle = o; }
}
