// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChipsTokenBurn is IERC20 {
    function burn(uint256 amount) external;
}
interface IChipsStakingYield {
    function receiveYield(uint256 amount) external;
}
interface IERC721Minimal {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title TableRegistry — on-chain room leasing with optional NFT gating
///
/// Anyone can lease a private poker room by paying a weekly CHIPS fee.
/// Rooms can be:
///   - Open (any verified human can sit)
///   - NFT-gated (only holders of a specified ERC-721 can sit)
///   - Public or invite-only (enforced server-side; on-chain flag for UX)
///
/// Lease fee split: 35% burned | 35% staking yield | 30% treasury
///
/// PokerEscrow calls canSit(roomId, player) before allowing buy-in when a
/// table is linked to a room.
contract TableRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IChipsTokenBurn;

    struct Room {
        uint256 id;
        address lessee;
        string  name;
        address nftGate;       // address(0) = open to all verified humans
        uint256 minBuyIn;      // minimum buy-in in CHIPS (18 decimals); 0 = no minimum
        uint256 maxBuyIn;      // maximum buy-in in CHIPS; 0 = no maximum
        uint8   maxPlayers;    // 2–9
        uint8   gameType;      // mirrors PokerEscrow.GameType enum
        bool    isPublic;      // false = NFT/lessee-invite only (UI hint; NFT gate enforced on-chain)
        uint256 leaseExpiry;   // unix timestamp; 0 = expired/not leased
        uint256 dailyRate;     // CHIPS per day paid; used for pro-rata refunds on terminate
    }

    IChipsTokenBurn    public immutable chipsToken;
    IChipsStakingYield public stakingContract;
    address            public rakeRecipient;

    uint256 public weeklyFee   = 33_500  * 10**18;  // 33,500 CHIPS per week
    uint256 public monthlyFee  = 100_000 * 10**18;  // 100,000 CHIPS per month (~30 days)
    uint256 public minWeeks    = 1;
    uint256 public maxWeeks    = 52;
    uint256 public minMonths   = 1;
    uint256 public maxMonths   = 12;

    // Lease fee split (bps / 10000)
    uint256 public leaseBurnBps    = 3500; // 35%
    uint256 public leaseStakingBps = 3500; // 35%
    // treasury = 10000 - leaseBurnBps - leaseStakingBps = 30%

    uint256 public roomCount;
    mapping(uint256 => Room) public rooms;

    // Revenue tracking
    uint256 public totalLeaseFeesCollected;
    uint256 public totalLeaseFeesBurned;
    uint256 public totalLeaseFeesToStaking;

    event RoomLeased(
        uint256 indexed roomId, address indexed lessee, string name,
        address nftGate, uint256 leaseExpiry, uint256 feePaid
    );
    event LeaseRenewed(uint256 indexed roomId, uint256 newExpiry, uint256 feePaid);
    event RoomUpdated(uint256 indexed roomId);

    error RoomNotFound(uint256 id);
    error NotLessee(uint256 id);
    error LeaseExpired(uint256 id);
    error WeekCountOutOfRange(uint256 w);
    error MonthCountOutOfRange(uint256 m);

    constructor(address _token, address _rake, address _staking) Ownable(msg.sender) {
        chipsToken      = IChipsTokenBurn(_token);
        rakeRecipient   = _rake;
        stakingContract = IChipsStakingYield(_staking);
    }

    // ─── LEASE ────────────────────────────────────────────────────────────────

    /// @notice Lease a private room. Caller pays weeklyFee * weeks_ up-front.
    /// @param weeks_       Lease duration in weeks (1–52)
    /// @param nftGate      ERC-721 contract address; address(0) for no gate
    /// @param minBuyIn     Minimum buy-in in CHIPS (0 = no minimum)
    /// @param maxBuyIn     Maximum buy-in in CHIPS (0 = no maximum)
    /// @param maxPlayers   Seats at the table (2–9)
    /// @param gameType     0=HoldEm 1=Omaha 2=ShortDeck 3=Pineapple
    /// @param isPublic     true = visible in lobby; false = private/invite
    /// @param name         Display name for the room
    function leaseRoom(
        uint256 weeks_,
        address nftGate,
        uint256 minBuyIn,
        uint256 maxBuyIn,
        uint8   maxPlayers,
        uint8   gameType,
        bool    isPublic,
        string calldata name
    ) external nonReentrant returns (uint256 roomId) {
        if (weeks_ < minWeeks || weeks_ > maxWeeks) revert WeekCountOutOfRange(weeks_);
        require(maxPlayers >= 2 && maxPlayers <= 9, "Bad seat count");
        require(maxBuyIn == 0 || maxBuyIn >= minBuyIn, "maxBuyIn < minBuyIn");

        uint256 fee = weeklyFee * weeks_;
        _collectAndSplitFee(fee);

        roomId = ++roomCount;
        rooms[roomId] = Room({
            id:          roomId,
            lessee:      msg.sender,
            name:        name,
            nftGate:     nftGate,
            minBuyIn:    minBuyIn,
            maxBuyIn:    maxBuyIn,
            maxPlayers:  maxPlayers,
            gameType:    gameType,
            isPublic:    isPublic,
            leaseExpiry: block.timestamp + (weeks_ * 7 days),
            dailyRate:   weeklyFee / 7
        });

        emit RoomLeased(roomId, msg.sender, name, nftGate, rooms[roomId].leaseExpiry, fee);
    }

    /// @notice Extend an existing lease by weeks. Adds weeks_ × weeklyFee from expiry (or now if expired).
    function renewLease(uint256 roomId, uint256 weeks_) external nonReentrant {
        Room storage r = rooms[roomId];
        if (r.lessee == address(0)) revert RoomNotFound(roomId);
        if (r.lessee != msg.sender) revert NotLessee(roomId);
        if (weeks_ < minWeeks || weeks_ > maxWeeks) revert WeekCountOutOfRange(weeks_);

        uint256 fee = weeklyFee * weeks_;
        _collectAndSplitFee(fee);

        uint256 base = r.leaseExpiry > block.timestamp ? r.leaseExpiry : block.timestamp;
        r.leaseExpiry = base + (weeks_ * 7 days);
        r.dailyRate   = weeklyFee / 7;

        emit LeaseRenewed(roomId, r.leaseExpiry, fee);
    }

    /// @notice Lease a private room for one or more calendar months (30-day periods).
    ///         Monthly rate is discounted vs weekly: 100,000 CHIPS/month vs 33,500×4=134,000 for ~4 weeks.
    function leaseRoomMonths(
        uint256 months_,
        address nftGate,
        uint256 minBuyIn,
        uint256 maxBuyIn,
        uint8   maxPlayers,
        uint8   gameType,
        bool    isPublic,
        string calldata name
    ) external nonReentrant returns (uint256 roomId) {
        if (months_ < minMonths || months_ > maxMonths) revert MonthCountOutOfRange(months_);
        require(maxPlayers >= 2 && maxPlayers <= 9, "Bad seat count");
        require(maxBuyIn == 0 || maxBuyIn >= minBuyIn, "maxBuyIn < minBuyIn");

        uint256 fee = monthlyFee * months_;
        _collectAndSplitFee(fee);

        roomId = ++roomCount;
        rooms[roomId] = Room({
            id:          roomId,
            lessee:      msg.sender,
            name:        name,
            nftGate:     nftGate,
            minBuyIn:    minBuyIn,
            maxBuyIn:    maxBuyIn,
            maxPlayers:  maxPlayers,
            gameType:    gameType,
            isPublic:    isPublic,
            leaseExpiry: block.timestamp + (months_ * 30 days),
            dailyRate:   monthlyFee / 30
        });

        emit RoomLeased(roomId, msg.sender, name, nftGate, rooms[roomId].leaseExpiry, fee);
    }

    /// @notice Extend an existing lease by months. Uses the monthly (discounted) rate.
    function renewLeaseMonths(uint256 roomId, uint256 months_) external nonReentrant {
        Room storage r = rooms[roomId];
        if (r.lessee == address(0)) revert RoomNotFound(roomId);
        if (r.lessee != msg.sender) revert NotLessee(roomId);
        if (months_ < minMonths || months_ > maxMonths) revert MonthCountOutOfRange(months_);

        uint256 fee = monthlyFee * months_;
        _collectAndSplitFee(fee);

        uint256 base = r.leaseExpiry > block.timestamp ? r.leaseExpiry : block.timestamp;
        r.leaseExpiry = base + (months_ * 30 days);
        r.dailyRate   = monthlyFee / 30;

        emit LeaseRenewed(roomId, r.leaseExpiry, fee);
    }

    /// @notice Update room settings (lessee only, lease must be active).
    function updateRoom(
        uint256 roomId,
        address nftGate,
        uint256 minBuyIn,
        uint256 maxBuyIn,
        bool    isPublic,
        string calldata name
    ) external {
        Room storage r = rooms[roomId];
        if (r.lessee != msg.sender) revert NotLessee(roomId);
        if (block.timestamp >= r.leaseExpiry) revert LeaseExpired(roomId);
        require(maxBuyIn == 0 || maxBuyIn >= minBuyIn, "maxBuyIn < minBuyIn");
        r.nftGate  = nftGate;
        r.minBuyIn = minBuyIn;
        r.maxBuyIn = maxBuyIn;
        r.isPublic = isPublic;
        r.name     = name;
        emit RoomUpdated(roomId);
    }

    // ─── ACCESS CHECK (called by PokerEscrow) ─────────────────────────────────

    /// @notice Returns true if player is allowed to sit in this room.
    ///         Checks: lease not expired + NFT ownership if gated.
    function canSit(uint256 roomId, address player) external view returns (bool) {
        Room storage r = rooms[roomId];
        if (r.lessee == address(0)) return false;
        if (block.timestamp >= r.leaseExpiry) return false;
        if (r.nftGate != address(0)) {
            return IERC721Minimal(r.nftGate).balanceOf(player) > 0;
        }
        return true;
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function getRoom(uint256 roomId) external view returns (Room memory) {
        return rooms[roomId];
    }

    /// @notice Returns all active (non-expired) public rooms for the lobby.
    function getPublicRooms() external view returns (Room[] memory active) {
        uint256 count;
        for (uint256 i = 1; i <= roomCount; i++) {
            if (rooms[i].isPublic && block.timestamp < rooms[i].leaseExpiry) count++;
        }
        active = new Room[](count);
        uint256 idx;
        for (uint256 i = 1; i <= roomCount; i++) {
            if (rooms[i].isPublic && block.timestamp < rooms[i].leaseExpiry) {
                active[idx++] = rooms[i];
            }
        }
    }

    function getLeaseRevenue() external view returns (
        uint256 total, uint256 burned, uint256 toStaking
    ) {
        return (totalLeaseFeesCollected, totalLeaseFeesBurned, totalLeaseFeesToStaking);
    }

    // ─── INTERNAL ─────────────────────────────────────────────────────────────

    function _collectAndSplitFee(uint256 fee) internal {
        chipsToken.safeTransferFrom(msg.sender, address(this), fee);

        uint256 burnAmt    = (fee * leaseBurnBps)    / 10000;
        uint256 stakingAmt = (fee * leaseStakingBps) / 10000;
        uint256 treasury   = fee - burnAmt - stakingAmt;

        if (burnAmt > 0) chipsToken.burn(burnAmt);

        if (stakingAmt > 0) {
            if (address(stakingContract) != address(0)) {
                chipsToken.safeTransfer(address(stakingContract), stakingAmt);
                stakingContract.receiveYield(stakingAmt);
            } else {
                chipsToken.safeTransfer(rakeRecipient, stakingAmt);
            }
        }

        if (treasury > 0) chipsToken.safeTransfer(rakeRecipient, treasury);

        totalLeaseFeesCollected += fee;
        totalLeaseFeesBurned    += burnAmt;
        totalLeaseFeesToStaking += stakingAmt;
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    function setWeeklyFee(uint256 fee) external onlyOwner { weeklyFee = fee; }

    function setLeaseSplit(uint256 burnBps, uint256 stakingBps) external onlyOwner {
        require(burnBps + stakingBps <= 10000, "Exceeds 100%");
        leaseBurnBps    = burnBps;
        leaseStakingBps = stakingBps;
    }

    function setWeekLimits(uint256 min_, uint256 max_) external onlyOwner {
        require(min_ >= 1 && max_ >= min_, "Bad limits");
        minWeeks = min_; maxWeeks = max_;
    }

    function setStaking(address s)      external onlyOwner { stakingContract = IChipsStakingYield(s); }
    function setRakeRecipient(address r) external onlyOwner { rakeRecipient = r; }

    /// @notice Owner can terminate an active lease and refund the lessee pro-rata.
    function terminateLease(uint256 roomId) external onlyOwner {
        Room storage r = rooms[roomId];
        require(r.lessee != address(0), "Not found");
        if (block.timestamp < r.leaseExpiry && r.dailyRate > 0) {
            uint256 remaining = r.leaseExpiry - block.timestamp;
            uint256 refund    = (r.dailyRate * remaining) / 1 days;
            if (refund > 0) chipsToken.safeTransfer(r.lessee, refund);
        }
        r.leaseExpiry = 0;
        emit RoomUpdated(roomId);
    }

    function setMonthlyFee(uint256 fee) external onlyOwner { monthlyFee = fee; }

    function setMonthLimits(uint256 min_, uint256 max_) external onlyOwner {
        require(min_ >= 1 && max_ >= min_, "Bad limits");
        minMonths = min_; maxMonths = max_;
    }
}
