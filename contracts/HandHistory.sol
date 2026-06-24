// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @title HandHistory — batched on-chain gameplay stats
///
/// The game server keeps per-hand results in memory and periodically (e.g. every
/// 15 minutes) flushes accumulated deltas here in one transaction per batch,
/// instead of writing on every hand. This keeps gas cost low while still giving
/// every player a verifiable, on-chain record of hands played/won and winnings.
contract HandHistory is Ownable {
    address public operator;

    struct PlayerStats {
        uint256 handsPlayed;
        uint256 handsWon;
        uint256 totalWinnings; // cumulative pot winnings, in CHIPS wei (18 decimals)
        uint256 lastBatchAt;
    }

    mapping(address => PlayerStats) public stats;
    uint256 public totalBatches;
    uint256 public lastFlushAt;

    event OperatorUpdated(address indexed operator);
    event BatchRecorded(uint256 indexed batchId, uint256 playerCount, uint256 timestamp);

    constructor(address _operator) Ownable(msg.sender) {
        operator = _operator;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "HandHistory: not operator");
        _;
    }

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
        emit OperatorUpdated(_operator);
    }

    /// @notice Records one batch of accumulated per-player deltas since the last flush.
    function recordBatch(
        address[] calldata players,
        uint256[] calldata handsPlayedDelta,
        uint256[] calldata handsWonDelta,
        uint256[] calldata winningsDelta
    ) external onlyOperator {
        uint256 len = players.length;
        require(
            len == handsPlayedDelta.length &&
            len == handsWonDelta.length &&
            len == winningsDelta.length,
            "HandHistory: length mismatch"
        );

        for (uint256 i = 0; i < len; i++) {
            PlayerStats storage s = stats[players[i]];
            s.handsPlayed   += handsPlayedDelta[i];
            s.handsWon      += handsWonDelta[i];
            s.totalWinnings += winningsDelta[i];
            s.lastBatchAt    = block.timestamp;
        }

        totalBatches += 1;
        lastFlushAt = block.timestamp;
        emit BatchRecorded(totalBatches, len, block.timestamp);
    }

    function getStats(address player) external view returns (
        uint256 handsPlayed,
        uint256 handsWon,
        uint256 totalWinnings,
        uint256 lastBatchAt
    ) {
        PlayerStats memory s = stats[player];
        return (s.handsPlayed, s.handsWon, s.totalWinnings, s.lastBatchAt);
    }
}
