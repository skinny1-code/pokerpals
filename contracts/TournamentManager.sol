// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title TournamentManager — scheduled tournaments with entry fees and operator-signed payouts
///
/// Revenue model:
///   tournamentRake (10% default) taken from total prize pool before payout
///   House guaranteed edge = entry_count × entryFee × rake%
///
/// Example: 100 players × 100 PPP entry × 10% = 1,000 PPP to house per tournament
contract TournamentManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    enum TournStatus { Registration, Running, Settled, Cancelled }

    struct Tournament {
        uint256 id;
        string  name;
        uint256 entryFee;
        uint256 startTime;
        uint8   maxPlayers;
        uint8   gameType;       // 0=holdem,1=omaha,etc
        TournStatus status;
        address[] entrants;
        uint256 prizePool;
        uint256 rakeCollected;
        bool    guaranteed;     // if true, house tops up to guaranteedPrize if not enough entrants
        uint256 guaranteedPrize;
    }

    IERC20  public immutable pppToken;
    address public operatorSigner;
    address public rakeRecipient;
    address public antiBotOracle;

    uint256 public tournamentRake   = 100;  // 10% (basis points / 1000)
    uint256 public rakeDenominator  = 1000;

    uint256 public tournamentCount;
    mapping(uint256 => Tournament)   public tournaments;
    mapping(uint256 => mapping(address => bool)) public registered;
    mapping(address => bool)         public humanVerified;
    mapping(bytes32 => bool)         public usedPayoutHashes;

    // Revenue
    uint256 public totalTournamentRake;

    event TournamentCreated(uint256 indexed id, string name, uint256 entryFee, uint256 startTime);
    event PlayerRegistered(uint256 indexed id, address player, uint256 feePaid);
    event TournamentStarted(uint256 indexed id, uint256 prizePool, uint256 rake);
    event TournamentPaid(uint256 indexed id, address[] winners, uint256[] payouts);
    event TournamentCancelled(uint256 indexed id);
    event HumanVerified(address indexed player, bool status);

    error NotHuman(address p);
    error TournNotOpen(uint256 id);
    error AlreadyRegistered(address p);
    error TournFull(uint256 id);
    error InvalidSig();
    error AlreadyUsed(bytes32 h);

    constructor(address _token, address _signer, address _rake, address _oracle)
        Ownable(msg.sender)
    {
        pppToken = IERC20(_token); operatorSigner = _signer;
        rakeRecipient = _rake;    antiBotOracle = _oracle;
    }

    function markHuman(address player, bool status) external {
        require(msg.sender == antiBotOracle || msg.sender == owner());
        humanVerified[player] = status;
        emit HumanVerified(player, status);
    }

    // ─── TOURNAMENT LIFECYCLE ─────────────────────────────────────────────────
    /// @notice Owner creates a tournament. Can be guaranteed (house tops up prize pool).
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

        // Fund guarantee upfront if set
        if (guaranteed && guaranteedPrize > 0) {
            pppToken.safeTransferFrom(msg.sender, address(this), guaranteedPrize);
        }
        emit TournamentCreated(id, name, entryFee, startTime);
    }

    /// @notice Player registers and locks entry fee
    function register(uint256 tournId) external nonReentrant {
        Tournament storage t = tournaments[tournId];
        if (t.status != TournStatus.Registration)   revert TournNotOpen(tournId);
        if (!humanVerified[msg.sender])              revert NotHuman(msg.sender);
        if (registered[tournId][msg.sender])         revert AlreadyRegistered(msg.sender);
        if (t.entrants.length >= t.maxPlayers)       revert TournFull(tournId);

        pppToken.safeTransferFrom(msg.sender, address(this), t.entryFee);
        t.prizePool += t.entryFee;
        t.entrants.push(msg.sender);
        registered[tournId][msg.sender] = true;
        emit PlayerRegistered(tournId, msg.sender, t.entryFee);
    }

    /// @notice Operator starts tournament — takes rake, locks prize pool
    function startTournament(uint256 tournId) external {
        require(msg.sender == operatorSigner || msg.sender == owner());
        Tournament storage t = tournaments[tournId];
        require(t.status == TournStatus.Registration, "Not in registration");
        require(block.timestamp >= t.startTime || t.entrants.length == t.maxPlayers, "Too early");
        require(t.entrants.length >= 2, "Need 2+ players");

        uint256 pool = t.prizePool;
        uint256 rake = (pool * tournamentRake) / rakeDenominator;
        t.rakeCollected = rake;

        // Apply guarantee top-up if applicable
        if (t.guaranteed && pool - rake < t.guaranteedPrize) {
            // guaranteedPrize already deposited by owner, net is already in contract
            t.prizePool = t.guaranteedPrize + rake; // keep rake on top
        }

        pppToken.safeTransfer(rakeRecipient, rake);
        totalTournamentRake += rake;
        t.prizePool -= rake;
        t.status = TournStatus.Running;
        emit TournamentStarted(tournId, t.prizePool, rake);
    }

    /// @notice Operator signs final standings and calls payout (or any entrant submits sig)
    /// @param winners  Ordered addresses (1st, 2nd, 3rd, etc.)
    /// @param shares   Basis points / 1000, must sum to 1000
    function payout(
        uint256 tournId,
        address[] calldata winners,
        uint256[] calldata shares,
        bytes calldata sig
    ) external nonReentrant {
        Tournament storage t = tournaments[tournId];
        require(t.status == TournStatus.Running, "Not running");

        uint256 tot; for (uint i; i < shares.length; i++) tot += shares[i];
        require(tot == 1000);

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(tournId, winners, shares))
        );
        if (usedPayoutHashes[digest]) revert AlreadyUsed(digest);
        if (digest.recover(sig) != operatorSigner) revert InvalidSig();
        usedPayoutHashes[digest] = true;

        uint256[] memory payouts = new uint256[](winners.length);
        for (uint i; i < winners.length; i++) {
            payouts[i] = (t.prizePool * shares[i]) / 1000;
            pppToken.safeTransfer(winners[i], payouts[i]);
        }
        t.status = TournStatus.Settled;
        emit TournamentPaid(tournId, winners, payouts);
    }

    /// @notice Refund all entrants if tournament cancelled
    function cancelTournament(uint256 tournId) external onlyOwner {
        Tournament storage t = tournaments[tournId];
        require(t.status == TournStatus.Registration, "Cannot cancel");
        t.status = TournStatus.Cancelled;
        for (uint i; i < t.entrants.length; i++) {
            pppToken.safeTransfer(t.entrants[i], t.entryFee);
        }
        emit TournamentCancelled(tournId);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────
    function getEntrants(uint256 id) external view returns (address[] memory) {
        return tournaments[id].entrants;
    }
    function getRevenue() external view returns (uint256) {
        return totalTournamentRake;
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function setRake(uint256 num, uint256 den) external onlyOwner {
        require(num <= 150 && den >= 1000, "Max 15% tournament rake");
        tournamentRake = num; rakeDenominator = den;
    }
    function setOperatorSigner(address s) external onlyOwner { operatorSigner = s; }
    function setRakeRecipient(address r)  external onlyOwner { rakeRecipient = r; }
}
