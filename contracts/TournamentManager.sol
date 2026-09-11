// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IChipsTokenBurnable is IERC20 {
    function burn(uint256 amount) external;
}
interface IChipsStakingForTourn {
    function receiveYield(uint256 amount) external;
}
interface IKingsPoolForTourn {
    function receiveOps(uint256 amount) external;
}
interface IPokerHandle {
    function isHandleEligible(address player) external view returns (bool);
    function effectiveTokenId(address player) external view returns (uint256);
}

/// @title TournamentManager — scheduled tournaments with entry fees and operator-signed payouts
///
/// Rake split (of tournament rake):
///   15% → burned (deflationary)
///   45% → staking yield pool
///   10% → King of Spades Pool (operating expenses)
///   30% → treasury (rakeRecipient)
contract TournamentManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IChipsTokenBurnable;
    using ECDSA for bytes32;

    enum TournStatus { Registration, Running, Settled, Cancelled }

    struct Tournament {
        uint256 id;
        string  name;
        uint256 entryFee;
        uint256 startTime;
        uint8   maxPlayers;
        uint8   gameType;
        TournStatus status;
        address[] entrants;
        uint256 prizePool;
        uint256 rakeCollected;
        bool    guaranteed;
        uint256 guaranteedPrize;
    }

    IChipsTokenBurnable public immutable chipsToken;
    IChipsStakingForTourn public stakingContract;
    IKingsPoolForTourn    public kingsPool;
    IPokerHandle          public pokerHandle;
    address public operatorSigner;
    address public rakeRecipient;

    // Tournament rake: 10% default (num/den)
    uint256 public tournamentRake  = 100;
    uint256 public rakeDenominator = 1000;

    // Rake split (bps / 10000, burn + staking + kings + treasury must sum to 10000)
    uint256 public rakeBurnBps    = 1500; // 15%
    uint256 public rakeStakingBps = 4500; // 45%
    uint256 public rakeKingsBps   = 1000; // 10% → King of Spades Pool
    // treasury = 10000 - rakeBurnBps - rakeStakingBps - rakeKingsBps = 30%

    uint256 public tournamentCount;
    mapping(uint256 => Tournament)              public tournaments;
    mapping(uint256 => mapping(address => bool)) public registered;
    mapping(bytes32 => bool)                    public usedPayoutHashes;

    uint256 public totalTournamentRake;
    uint256 public totalRakeBurned;
    uint256 public totalRakeToStaking;

    event TournamentCreated(uint256 indexed id, string name, uint256 entryFee, uint256 startTime);
    event PlayerRegistered(uint256 indexed id, address player, uint256 feePaid);
    event TournamentStarted(uint256 indexed id, uint256 prizePool, uint256 rake, uint256 burned, uint256 toStaking);
    event TournamentPaid(uint256 indexed id, address[] winners, uint256[] payouts);
    event TournamentCancelled(uint256 indexed id);

    error NotHuman(address p);
    error TournNotOpen(uint256 id);
    error AlreadyRegistered(address p);
    error TournFull(uint256 id);
    error InvalidSig();
    error AlreadyUsed(bytes32 h);
    error DuplicateIdentity(uint256 tokenId);

    constructor(address _token, address _signer, address _rake, address _staking)
        Ownable(msg.sender)
    {
        chipsToken      = IChipsTokenBurnable(_token);
        operatorSigner  = _signer;
        rakeRecipient   = _rake;
        stakingContract = IChipsStakingForTourn(_staking);
    }

    // ─── TOURNAMENT LIFECYCLE ─────────────────────────────────────────────────
    function createTournament(
        string calldata name,
        uint256 entryFee,
        uint256 startTime,
        uint8   maxPlayers,
        uint8   gameType,
        bool    guaranteed,
        uint256 guaranteedPrize
    ) external onlyOwner returns (uint256 id) {
        require(startTime > block.timestamp, "Start in future");
        id = ++tournamentCount;
        Tournament storage t = tournaments[id];
        t.id = id; t.name = name; t.entryFee = entryFee;
        t.startTime = startTime; t.maxPlayers = maxPlayers;
        t.gameType = gameType; t.status = TournStatus.Registration;
        t.guaranteed = guaranteed; t.guaranteedPrize = guaranteedPrize;

        if (guaranteed && guaranteedPrize > 0) {
            chipsToken.safeTransferFrom(msg.sender, address(this), guaranteedPrize);
        }
        emit TournamentCreated(id, name, entryFee, startTime);
    }

    function register(uint256 tournId) external nonReentrant {
        Tournament storage t = tournaments[tournId];
        if (t.status != TournStatus.Registration)  revert TournNotOpen(tournId);
        if (!pokerHandle.isHandleEligible(msg.sender)) revert NotHuman(msg.sender);
        if (registered[tournId][msg.sender])        revert AlreadyRegistered(msg.sender);
        if (t.entrants.length >= t.maxPlayers)      revert TournFull(tournId);
        _checkNoDuplicateIdentity(t, msg.sender);

        chipsToken.safeTransferFrom(msg.sender, address(this), t.entryFee);
        t.prizePool += t.entryFee;
        t.entrants.push(msg.sender);
        registered[tournId][msg.sender] = true;
        emit PlayerRegistered(tournId, msg.sender, t.entryFee);
    }

    /// @notice Blocks one handle (owner + any of its linked alias wallets) from holding
    ///         two entries in the same tournament — closes the collusion/double-entry
    ///         path that wallet linking would otherwise open.
    function _checkNoDuplicateIdentity(Tournament storage t, address player) internal view {
        uint256 tokenId = pokerHandle.effectiveTokenId(player);
        for (uint i; i < t.entrants.length; i++) {
            if (pokerHandle.effectiveTokenId(t.entrants[i]) == tokenId) revert DuplicateIdentity(tokenId);
        }
    }

    function startTournament(uint256 tournId) external {
        require(msg.sender == operatorSigner || msg.sender == owner());
        Tournament storage t = tournaments[tournId];
        require(t.status == TournStatus.Registration, "Not in registration");
        require(block.timestamp >= t.startTime || t.entrants.length == t.maxPlayers, "Too early");
        require(t.entrants.length >= 2, "Need 2+ players");

        uint256 pool = t.prizePool;
        uint256 rake = (pool * tournamentRake) / rakeDenominator;
        t.rakeCollected = rake;

        // ── Rake distribution ──────────────────────────────────────────────
        uint256 burnAmt    = (rake * rakeBurnBps)    / 10000;
        uint256 stakingAmt = (rake * rakeStakingBps) / 10000;
        uint256 kingsAmt   = (rake * rakeKingsBps)   / 10000;
        uint256 treasuryAmt = rake - burnAmt - stakingAmt - kingsAmt;

        if (burnAmt > 0) chipsToken.burn(burnAmt);

        if (stakingAmt > 0) {
            if (address(stakingContract) != address(0)) {
                chipsToken.safeTransfer(address(stakingContract), stakingAmt);
                stakingContract.receiveYield(stakingAmt);
            } else {
                chipsToken.safeTransfer(rakeRecipient, stakingAmt);
            }
        }

        if (kingsAmt > 0 && address(kingsPool) != address(0)) {
            chipsToken.safeTransfer(address(kingsPool), kingsAmt);
            // Notification only — funds already moved, so a revert here (e.g. pool not
            // yet authorized) must not roll back tournament start.
            try kingsPool.receiveOps(kingsAmt) {} catch {}
        } else if (kingsAmt > 0) {
            chipsToken.safeTransfer(rakeRecipient, kingsAmt);
        }

        if (treasuryAmt > 0) chipsToken.safeTransfer(rakeRecipient, treasuryAmt);

        totalTournamentRake += rake;
        totalRakeBurned     += burnAmt;
        totalRakeToStaking  += stakingAmt;

        uint256 netPool = pool - rake; // entry fees after rake
        if (t.guaranteed && netPool < t.guaranteedPrize) {
            // Guarantee applies: return net entry fees to treasury, pay winners from guaranteedPrize
            if (netPool > 0) chipsToken.safeTransfer(rakeRecipient, netPool);
            t.prizePool = t.guaranteedPrize;
        } else {
            t.prizePool = netPool;
            // Guarantee didn't bind — the guaranteedPrize deposited at creation is
            // unused surplus; return it to the owner instead of stranding it.
            if (t.guaranteed && t.guaranteedPrize > 0) {
                chipsToken.safeTransfer(owner(), t.guaranteedPrize);
            }
        }

        t.status = TournStatus.Running;
        emit TournamentStarted(tournId, t.prizePool, rake, burnAmt, stakingAmt);
    }

    function payout(
        uint256 tournId,
        address[] calldata winners,
        uint256[] calldata shares,
        bytes calldata sig
    ) external nonReentrant {
        Tournament storage t = tournaments[tournId];
        require(t.status == TournStatus.Running, "Not running");
        require(winners.length == shares.length && winners.length > 0, "len");

        uint256 tot; for (uint i; i < shares.length; i++) tot += shares[i];
        require(tot == 1000);

        // Bind chainId + this contract so a signature cannot be replayed on
        // another chain or a redeployed instance sharing the operator key.
        // Unambiguous only because winners.length == shares.length is required
        // above: the packed tail is 52n bytes, which fixes n and so fixes the
        // 20n/32n boundary. See the same note in PokerEscrow.settle.
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(block.chainid, address(this), tournId, winners, shares))
        );
        if (usedPayoutHashes[digest]) revert AlreadyUsed(digest);
        if (digest.recover(sig) != operatorSigner) revert InvalidSig();
        usedPayoutHashes[digest] = true;

        uint256[] memory payouts = new uint256[](winners.length);
        for (uint i; i < winners.length; i++) {
            payouts[i] = (t.prizePool * shares[i]) / 1000;
            chipsToken.safeTransfer(winners[i], payouts[i]);
        }
        t.status = TournStatus.Settled;
        emit TournamentPaid(tournId, winners, payouts);
    }

    function cancelTournament(uint256 tournId) external onlyOwner {
        Tournament storage t = tournaments[tournId];
        require(t.status == TournStatus.Registration, "Cannot cancel");
        t.status = TournStatus.Cancelled;
        for (uint i; i < t.entrants.length; i++) {
            chipsToken.safeTransfer(t.entrants[i], t.entryFee);
        }
        // Return the guaranteed prize deposit to the owner
        if (t.guaranteed && t.guaranteedPrize > 0) {
            chipsToken.safeTransfer(owner(), t.guaranteedPrize);
        }
        emit TournamentCancelled(tournId);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────
    function getEntrants(uint256 id) external view returns (address[] memory) {
        return tournaments[id].entrants;
    }

    function getRevenue() external view returns (
        uint256 rake, uint256 burned, uint256 toStaking
    ) {
        return (totalTournamentRake, totalRakeBurned, totalRakeToStaking);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function setRake(uint256 num, uint256 den) external onlyOwner {
        require(num <= 150 && den >= 1000, "Max 15% tournament rake");
        tournamentRake = num; rakeDenominator = den;
    }

    function setRakeSplit(uint256 burnBps, uint256 stakingBps, uint256 kingsBps) external onlyOwner {
        require(burnBps + stakingBps + kingsBps <= 10000, "Exceeds 100%");
        rakeBurnBps    = burnBps;
        rakeStakingBps = stakingBps;
        rakeKingsBps   = kingsBps;
    }

    function setOperatorSigner(address s)  external onlyOwner { operatorSigner = s; }
    function setRakeRecipient(address r)   external onlyOwner { rakeRecipient = r; }
    function setStaking(address s)         external onlyOwner { stakingContract = IChipsStakingForTourn(s); }
    function setKingsPool(address pool)    external onlyOwner { kingsPool = IKingsPoolForTourn(pool); }
    function setPokerHandle(address h)     external onlyOwner { pokerHandle = IPokerHandle(h); }
}
