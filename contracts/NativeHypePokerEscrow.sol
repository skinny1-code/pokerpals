// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title NativeHypePokerEscrow
/// @notice Isolated Elysium testnet prototype: real native HYPE semantics, zero fees.
/// @dev No production use. On-chain bankroll updates depend on an operator's signature
///      and are NOT independently verified against card-game rules or shuffles.
///      Real-money gaming requires independent audits and jurisdictional approval.
contract NativeHypePokerEscrow is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    uint256 public constant EMERGENCY_DELAY = 24 hours;

    enum TableStatus { Open, Active, Closed }

    struct Table {
        uint256 id;
        address creator;
        uint256 buyInAmount;
        uint256 bigBlind;
        uint8 maxPlayers;
        uint8 gameType;
        TableStatus status;
        uint256 bankroll;
        uint256 handNonce;
        uint256 lastActionAt;
        address[] players;
    }

    mapping(uint256 => Table) private tables;
    mapping(uint256 => mapping(address => bool)) public seated;
    mapping(uint256 => mapping(address => uint256)) private balances;
    mapping(uint256 => mapping(address => uint256)) public cashOutNonce;
    mapping(address => bool) public humanVerified;
    mapping(address => uint256) public claimable;
    uint256 public tableCount;
    uint256 public totalLiabilities;

    address public operatorSigner;
    address public verificationOracle;

    event TableCreated(uint256 indexed tableId, address indexed creator, uint256 buyIn, uint8 gameType);
    event PlayerJoined(uint256 indexed tableId, address indexed player, uint256 amount);
    event PlayerRebuyed(uint256 indexed tableId, address indexed player, uint256 amount);
    event BalancesSettled(uint256 indexed tableId, uint256 indexed nonce, address[] players, uint256[] balances);
    event CashOutCredited(uint256 indexed tableId, address indexed player, uint256 amount);
    event RefundCredited(uint256 indexed tableId, address indexed player, uint256 amount);
    event EmergencyActivated(uint256 indexed tableId);
    event CreditClaimed(address indexed player, uint256 amount);
    event HumanVerified(address indexed player, bool verified);
    event TableClosed(uint256 indexed tableId);

    error InvalidTable();
    error Unauthorized();
    error BadValue();
    error BadState();
    error InvalidSignature();
    error AccountingMismatch();
    error NotSeated();
    error AlreadySeated();
    error FullTable();
    error ExpiredEmergencyDelay();

    constructor(address signer_, address oracle_) Ownable(msg.sender) {
        if (signer_ == address(0) || oracle_ == address(0)) revert Unauthorized();
        operatorSigner = signer_;
        verificationOracle = oracle_;
    }

    function markHuman(address player, bool verified) external {
        if (msg.sender != verificationOracle && msg.sender != owner()) revert Unauthorized();
        humanVerified[player] = verified;
        emit HumanVerified(player, verified);
    }

    /// @dev Room leases are deliberately disabled in this isolated prototype.
    function createTable(uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers, uint8 gameType, uint256 roomId)
        external returns (uint256 tableId)
    {
        if (!humanVerified[msg.sender]) revert Unauthorized();
        if (roomId != 0 || gameType > 1) revert BadState();
        if (bigBlind == 0 || buyInAmount < 10 * bigBlind || maxPlayers < 2 || maxPlayers > 9)
            revert BadValue();
        tableId = ++tableCount;
        Table storage t = tables[tableId];
        t.id = tableId;
        t.creator = msg.sender;
        t.buyInAmount = buyInAmount;
        t.bigBlind = bigBlind;
        t.maxPlayers = maxPlayers;
        t.gameType = gameType;
        t.status = TableStatus.Open;
        t.lastActionAt = block.timestamp;
        emit TableCreated(tableId, msg.sender, buyInAmount, gameType);
    }

    function buyIn(uint256 tableId) external payable nonReentrant {
        Table storage t = _table(tableId);
        if (t.status != TableStatus.Open) revert BadState();
        if (!humanVerified[msg.sender]) revert Unauthorized();
        if (seated[tableId][msg.sender]) revert AlreadySeated();
        if (t.players.length == t.maxPlayers) revert FullTable();
        if (msg.value != t.buyInAmount) revert BadValue();
        seated[tableId][msg.sender] = true;
        balances[tableId][msg.sender] = msg.value;
        t.players.push(msg.sender);
        t.bankroll += msg.value;
        t.lastActionAt = block.timestamp;
        totalLiabilities += msg.value;
        if (t.players.length == 2) t.status = TableStatus.Active;
        emit PlayerJoined(tableId, msg.sender, msg.value);
    }

    function rebuy(uint256 tableId, uint256 amount) external payable nonReentrant {
        Table storage t = _table(tableId);
        if (t.status != TableStatus.Active) revert BadState();
        if (!seated[tableId][msg.sender]) revert NotSeated();
        if (amount == 0 || amount != msg.value) revert BadValue();
        balances[tableId][msg.sender] += amount;
        t.bankroll += amount;
        t.lastActionAt = block.timestamp;
        totalLiabilities += amount;
        emit PlayerRebuyed(tableId, msg.sender, amount);
    }

    /// @notice Atomically updates all seated bankrolls, preserves the exact table total.
    /// @dev ETH-signed hash of ABI encoding; safe against cross-chain/contract/replay.
    ///      The operator is entrusted with gameplay correctness; this contract
    ///      only enforces seat membership, sequence and bankroll conservation.
    function settleBalances(
        uint256 tableId,
        uint256 handNonce,
        address[] calldata players,
        uint256[] calldata newBalances,
        bytes calldata signature
    ) external nonReentrant {
        Table storage t = _table(tableId);
        if (t.status != TableStatus.Active) revert BadState();
        if (handNonce != t.handNonce) revert BadState();
        if (players.length != t.players.length || newBalances.length != players.length)
            revert BadValue();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(
                "HYPE_SETTLE_V1", block.chainid, address(this), tableId, handNonce,
                players, newBalances
            ))
        );
        if (digest.recover(signature) != operatorSigner) revert InvalidSignature();

        uint256 oldSum;
        uint256 nextSum;
        for (uint256 i; i < players.length; ++i) {
            if (players[i] != t.players[i]) revert BadState();
            oldSum += balances[tableId][players[i]];
            nextSum += newBalances[i];
        }
        if (oldSum != t.bankroll || nextSum != oldSum) revert AccountingMismatch();

        for (uint256 i; i < players.length; ++i) {
            balances[tableId][players[i]] = newBalances[i];
        }
        ++t.handNonce;
        t.lastActionAt = block.timestamp;
        emit BalancesSettled(tableId, handNonce, players, newBalances);
    }

    /// @notice Existing server-style operator-signed cashout, now credited for pull withdrawal.
    ///         Player may submit, or the operator may sponsor this transaction.
    function cashOut(
        uint256 tableId, address player, uint256 amount, uint256 nonce, bytes calldata signature
    ) external nonReentrant {
        Table storage t = _table(tableId);
        if (t.status != TableStatus.Active) revert BadState();
        if (!seated[tableId][player]) revert NotSeated();
        if (nonce != cashOutNonce[tableId][player]) revert BadState();
        if (amount != balances[tableId][player]) revert AccountingMismatch();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(
                "HYPE_CASHOUT_V1", block.chainid, address(this), tableId, player, amount, nonce
            ))
        );
        if (digest.recover(signature) != operatorSigner) revert InvalidSignature();

        ++cashOutNonce[tableId][player];
        _removeAndCredit(tableId, t, player);
        emit CashOutCredited(tableId, player, amount);
    }

    function refund(uint256 tableId) external nonReentrant {
        Table storage t = _table(tableId);
        if (t.status != TableStatus.Open) revert BadState();
        if (!seated[tableId][msg.sender]) revert NotSeated();
        uint256 amount = balances[tableId][msg.sender];
        _removeAndCredit(tableId, t, msg.sender);
        emit RefundCredited(tableId, msg.sender, amount);
    }

    /// @notice Recovery when the operator goes offline. No owner access to player HYPE.
    /// @dev Any participant can close a stale table; all participants then cash out the
    ///      last *signed* bankroll state without needing cooperation from the operator.
    function activateEmergency(uint256 tableId) external {
        Table storage t = _table(tableId);
        if (t.status == TableStatus.Closed) revert BadState();
        if (!seated[tableId][msg.sender]) revert NotSeated();
        if (block.timestamp < t.lastActionAt + EMERGENCY_DELAY) revert ExpiredEmergencyDelay();
        t.status = TableStatus.Closed;
        emit EmergencyActivated(tableId);
    }

    function emergencyCashOut(uint256 tableId) external nonReentrant {
        Table storage t = _table(tableId);
        if (t.status != TableStatus.Closed) revert BadState();
        if (!seated[tableId][msg.sender]) revert NotSeated();
        uint256 amount = balances[tableId][msg.sender];
        _removeAndCredit(tableId, t, msg.sender);
        emit CashOutCredited(tableId, msg.sender, amount);
    }

    function closeTable(uint256 tableId) external {
        Table storage t = _table(tableId);
        if (msg.sender != t.creator && msg.sender != owner()) revert Unauthorized();
        if (t.bankroll != 0 || t.players.length != 0) revert BadState();
        t.status = TableStatus.Closed;
        emit TableClosed(tableId);
    }

    /// @notice Pull withdrawals: a recipient contract cannot block other players' settlement.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert BadValue();
        claimable[msg.sender] = 0;
        totalLiabilities -= amount;
        (bool ok, ) = payable(msg.sender).call{ value: amount }("");
        if (!ok) revert BadState();
        emit CreditClaimed(msg.sender, amount);
    }

    function getPlayerDeposit(uint256 tableId, address player) external view returns (uint256) {
        return balances[tableId][player];
    }

    function getSeats(uint256 tableId) external view returns (address[] memory) {
        return _table(tableId).players;
    }

    function getTableInfo(uint256 tableId) external view returns (
        uint256 id, uint256 buyInAmount, uint256 bigBlind, uint8 maxPlayers,
        uint8 gameType, TableStatus status, uint256 potTotal, uint256 handNonce, uint8 seatedCount
    ) {
        Table storage t = _table(tableId);
        return (t.id, t.buyInAmount, t.bigBlind, t.maxPlayers, t.gameType,
                t.status, t.bankroll, t.handNonce, uint8(t.players.length));
    }

    function setOperatorSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert Unauthorized();
        operatorSigner = newSigner;
    }
    function setVerificationOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert Unauthorized();
        verificationOracle = newOracle;
    }

    function _removeAndCredit(uint256 tableId, Table storage t, address player) private {
        uint256 amount = balances[tableId][player];
        t.bankroll -= amount;
        balances[tableId][player] = 0;
        seated[tableId][player] = false;
        claimable[player] += amount;
        t.lastActionAt = block.timestamp;
        uint256 length = t.players.length;
        for (uint256 i; i < length; ++i) {
            if (t.players[i] == player) {
                t.players[i] = t.players[length - 1];
                t.players.pop();
                return;
            }
        }
        revert AccountingMismatch();
    }

    function _table(uint256 tableId) private view returns (Table storage t) {
        if (tableId == 0 || tableId > tableCount) revert InvalidTable();
        t = tables[tableId];
    }

    receive() external payable { revert BadState(); }
    fallback() external payable { revert BadState(); }
}
