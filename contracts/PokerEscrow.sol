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
interface ITableRegistry {
    function canSit(uint256 roomId, address player) external view returns (bool);
}
interface IKingsPool {
    function receiveOps(uint256 amount) external;
}

/// @title PokerEscrow — seat fees + VIP rake tiers + referral splits + auto rake distribution
///
/// Rake split (of total rake per hand):
///   10% → referrer (if player has one)
///   15% → burned (deflationary)
///   45% → staking yield pool (stakers earn from every hand)
///   10% → King of Spades Pool (operating expenses)
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

    // Rake distribution (bps / 10000, all five must sum to 10000)
    uint256 public rakeBurnBps     = 1500; // 15% burned
    uint256 public rakeStakingBps  = 4500; // 45% to staking yield
    uint256 public rakeTreasuryBps = 2000; // 20% to treasury (owner wallet)
    uint256 public referralBps     = 1000; // 10% to referrer
    uint256 public rakeKingsBps    = 1000; // 10% to King of Spades Pool (ops)

    // Rakeback loyalty — players earn back a % of their rake as claimable CHIPS
    uint256 public rakebackBps = 500;  // 5% of rake paid accrues to player
    uint256 public rakebackPool;       // funded by owner from community wallet
    mapping(address => uint256) public rakebackAccrued;  // claimable per player
    uint256 public totalRakebackPaid;

    IChipsToken       public immutable chipsToken;
    IChipsStaking     public stakingContract;
    IReferralRegistry public referralRegistry;
    ITableRegistry    public tableRegistry;
    IKingsPool        public kingsPool;
    address public operatorSigner;
    address public rakeRecipient;
    address public antiBotOracle;

    uint256 public tableCount;
    mapping(uint256 => Table)  private tables;
    mapping(uint256 => uint256) public tableRoom;  // tableId => roomId (0 = open table)
    mapping(uint256 => mapping(address => uint256)) public cashOutNonce;
    mapping(bytes32 => bool)   public usedSettleHashes;
    mapping(address => bool)   public humanVerified;

    // Revenue tracking
    uint256 public totalRakeCollected;
    uint256 public totalRakeBurned;
    uint256 public totalRakeToStaking;
    uint256 public totalSeatFeesCollected;
    uint256 public totalReferralsPaid;

    event TableCreated(uint256 indexed id, address creator, uint256 buyIn, GameType g);
    event PlayerJoined(uint256 indexed id, address player, uint256 buyIn, uint256 seatFee);
    event PlayerRebuyed(uint256 indexed id, address indexed player, uint256 amount);
    event PlayerCashedOut(uint256 indexed id, address indexed player, uint256 amount);
    event HandSettled(
        uint256 indexed id, uint256 nonce,
        address[] winners, uint256[] payouts,
        uint256 rake, uint256 burned, uint256 toStaking, uint256 referralPaid
    );
    event HumanVerified(address indexed player, bool status);
    event RakebackClaimed(address indexed player, uint256 amount);
    event RakebackPoolFunded(uint256 amount);
    event TableClosed(uint256 indexed id);

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

    /// @param roomId  Optional TableRegistry room ID; 0 = open public table.
    ///                If non-zero, only players approved by the room's access rules can buy in.
    function createTable(uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers, uint8 gameType, uint256 roomId)
        external returns (uint256 id)
    {
        require(buyInAmount >= bigBlind * 10, "Buy-in too small");
        require(maxPlayers >= 2 && maxPlayers <= 9, "Bad seats");
        id = ++tableCount;
        Table storage t = tables[id];
        t.id = id; t.creator = msg.sender; t.buyInAmount = buyInAmount;
        t.bigBlind = bigBlind; t.maxPlayers = maxPlayers;
        t.gameType = GameType(gameType); t.status = TableStatus.Open;
        if (roomId != 0) tableRoom[id] = roomId;
        emit TableCreated(id, msg.sender, buyInAmount, GameType(gameType));
    }

    function buyIn(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        if (t.status != TableStatus.Open)    revert TableNotOpen(tableId);
        if (!humanVerified[msg.sender])       revert NotHuman(msg.sender);
        if (t.deposits[msg.sender] > 0)       revert AlreadySeated(msg.sender);
        if (t.players.length >= t.maxPlayers) revert TableFull(tableId);

        // Room access check: if this table is linked to a leased room, verify the player
        uint256 roomId = tableRoom[tableId];
        if (roomId != 0 && address(tableRegistry) != address(0)) {
            require(tableRegistry.canSit(roomId, msg.sender), "Room access denied");
        }

        // Seat fee applies only to leased tables; open tables are free to join
        uint256 fee = roomId != 0 ? seatFeeCHIPS : 0;
        chipsToken.safeTransferFrom(msg.sender, address(this), t.buyInAmount + fee);
        if (fee > 0) {
            chipsToken.safeTransfer(rakeRecipient, fee);
            totalSeatFeesCollected += fee;
        }

        t.deposits[msg.sender] = t.buyInAmount;
        t.chips[msg.sender]    = t.buyInAmount;
        t.potTotal            += t.buyInAmount;
        t.players.push(msg.sender);
        emit PlayerJoined(tableId, msg.sender, t.buyInAmount, fee);
        if (t.players.length == t.maxPlayers) t.status = TableStatus.Active;
    }

    function rebuy(uint256 tableId, uint256 amount) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Active, "Not active");
        require(t.deposits[msg.sender] > 0, "Not seated");
        // Rebuy fee only for leased tables
        uint256 fee = tableRoom[tableId] != 0 ? seatFeeCHIPS / 2 : 0;
        chipsToken.safeTransferFrom(msg.sender, address(this), amount + fee);
        if (fee > 0) {
            chipsToken.safeTransfer(rakeRecipient, fee);
            totalSeatFeesCollected += fee;
        }
        t.deposits[msg.sender] += amount;
        t.chips[msg.sender]    += amount;
        t.potTotal             += amount;
        emit PlayerRebuyed(tableId, msg.sender, amount);
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

        // 15% of total rake → burn
        uint256 burnAmt = (totalRake * rakeBurnBps) / 10000;
        if (burnAmt > remaining) burnAmt = remaining;
        if (burnAmt > 0) chipsToken.burn(burnAmt);
        remaining -= burnAmt;

        // 45% of total rake → staking yield pool
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

        // 10% of total rake → King of Spades Pool (operating expenses)
        uint256 kingsAmt = (totalRake * rakeKingsBps) / 10000;
        if (kingsAmt > remaining) kingsAmt = remaining;
        if (kingsAmt > 0 && address(kingsPool) != address(0)) {
            chipsToken.safeTransfer(address(kingsPool), kingsAmt);
            // Notification only — funds already moved, so a revert here (e.g. pool not
            // yet authorized) must not roll back the whole settlement.
            try kingsPool.receiveOps(kingsAmt) {} catch {}
        } else if (kingsAmt > 0) {
            chipsToken.safeTransfer(rakeRecipient, kingsAmt);
        }
        remaining -= kingsAmt;

        // Remaining (~20%) → treasury (owner's personal wallet)
        if (remaining > 0) chipsToken.safeTransfer(rakeRecipient, remaining);

        totalRakeCollected  += totalRake;
        totalRakeBurned     += burnAmt;
        totalRakeToStaking  += stakingAmt;
        totalReferralsPaid  += referralPaid;

        // ── Rakeback accrual (5% of rake per player, claimable later) ──────
        if (rakebackBps > 0 && rakebackPool > 0) {
            uint256 rakePerPlayer = totalRake / t.players.length;
            for (uint i; i < t.players.length; i++) {
                uint256 rb = (rakePerPlayer * rakebackBps) / 10000;
                if (rb > rakebackPool) rb = rakebackPool;
                if (rb > 0) {
                    rakebackAccrued[t.players[i]] += rb;
                    rakebackPool                  -= rb;
                }
            }
        }

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
        // Remove from players array
        for (uint i = 0; i < t.players.length; i++) {
            if (t.players[i] == msg.sender) {
                t.players[i] = t.players[t.players.length - 1];
                t.players.pop();
                break;
            }
        }
        chipsToken.safeTransfer(msg.sender, dep);
    }

    /// @notice Operator-signed individual cash-out. Player sends this when they want to leave an active table.
    ///         The operator signs the player's current chip count (tracked in server memory).
    ///         Uses a per-player nonce to prevent replay.
    function cashOut(
        uint256 tableId, address player, uint256 amount, uint256 nonce, bytes calldata sig
    ) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status == TableStatus.Active, "Not active");
        require(t.deposits[player] > 0, "Not seated");
        require(nonce == cashOutNonce[tableId][player], "Bad nonce");
        require(amount <= t.potTotal, "Exceeds pot");

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked("CASHOUT", tableId, player, amount, nonce))
        );
        if (digest.recover(sig) != operatorSigner) revert InvalidSig();

        cashOutNonce[tableId][player]++;
        t.deposits[player] = 0;
        t.potTotal -= amount;
        for (uint i = 0; i < t.players.length; i++) {
            if (t.players[i] == player) {
                t.players[i] = t.players[t.players.length - 1];
                t.players.pop();
                break;
            }
        }
        chipsToken.safeTransfer(player, amount);
        emit PlayerCashedOut(tableId, player, amount);
    }

    /// @notice Close a table once all funds have been withdrawn (potTotal == 0).
    ///         Only the table creator or contract owner may call this.
    function closeTable(uint256 tableId) external nonReentrant {
        Table storage t = tables[tableId];
        require(t.status != TableStatus.Closed, "Already closed");
        require(t.potTotal == 0, "Funds remain");
        require(msg.sender == t.creator || msg.sender == owner(), "Not authorized");
        t.status = TableStatus.Closed;
        emit TableClosed(tableId);
    }

    // ─── RAKEBACK ─────────────────────────────────────────────────────────────

    /// @notice Claim all accrued rakeback CHIPS. Funded from rakebackPool (topped up by owner).
    function claimRakeback() external nonReentrant {
        uint256 amount = rakebackAccrued[msg.sender];
        require(amount > 0, "Nothing to claim");
        rakebackAccrued[msg.sender] = 0;
        totalRakebackPaid += amount;
        chipsToken.safeTransfer(msg.sender, amount);
        emit RakebackClaimed(msg.sender, amount);
    }

    /// @notice Owner tops up the rakeback pool (e.g. from community wallet).
    function fundRakebackPool(uint256 amount) external onlyOwner {
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        rakebackPool += amount;
        emit RakebackPoolFunded(amount);
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

    function getPlayerDeposit(uint256 tableId, address player) external view returns (uint256) {
        return tables[tableId].deposits[player];
    }

    function getTableInfo(uint256 id) external view returns (
        uint256 tableId, uint256 buyInAmount, uint256 bigBlind,
        uint8 maxPlayers, uint8 gameType, TableStatus status,
        uint256 potTotal, uint256 handNonce, uint8 seated
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

    /// @notice Adjust rake split. All five values must sum to 10000.
    function setRakeSplit(
        uint256 burnBps, uint256 stakingBps, uint256 treasuryBps, uint256 refBps, uint256 kingsBps
    ) external onlyOwner {
        require(burnBps + stakingBps + treasuryBps + refBps + kingsBps == 10000, "Must sum to 10000");
        rakeBurnBps     = burnBps;
        rakeStakingBps  = stakingBps;
        rakeTreasuryBps = treasuryBps;
        referralBps     = refBps;
        rakeKingsBps    = kingsBps;
    }

    function setOperatorSigner(address s)  external onlyOwner { operatorSigner = s; }
    function setRakeRecipient(address r)   external onlyOwner { rakeRecipient = r; }
    function setStaking(address s)         external onlyOwner { stakingContract = IChipsStaking(s); }
    function setReferral(address r)        external onlyOwner { referralRegistry = IReferralRegistry(r); }
    function setAntiBotOracle(address o)   external onlyOwner { antiBotOracle = o; }
    function setTableRegistry(address reg) external onlyOwner { tableRegistry = ITableRegistry(reg); }
    function setRakebackBps(uint256 bps)   external onlyOwner { require(bps <= 1000, "Max 10%"); rakebackBps = bps; }
    function setKingsPool(address pool)    external onlyOwner { kingsPool = IKingsPool(pool); }
}
