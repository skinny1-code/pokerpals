// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PPPStaking — Stake PPP to unlock VIP rake tiers
/// @notice Players lock PPP tokens for a minimum duration. Higher stake = lower rake.
///
/// Tiers:
///   0 Standard  — 0 PPP staked       — 1.5% rake
///   1 Bronze    — 1,000  PPP staked  — 1.3% rake
///   2 Silver    — 10,000 PPP staked  — 1.1% rake
///   3 Gold      — 50,000 PPP staked  — 0.9% rake
///   4 Whale     — 200,000 PPP staked — 0.6% rake
///
/// Staking also earns yield paid from rake revenue (set by owner).
contract PPPStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct StakeInfo {
        uint256 amount;
        uint256 since;      // timestamp
        uint256 lastClaim;  // last yield claim
        uint8   tier;
    }

    IERC20 public immutable pppToken;

    // Tier thresholds in PPP (18 decimals)
    uint256[5] public tierThresholds = [
        0,
        1_000   * 10**18,
        10_000  * 10**18,
        50_000  * 10**18,
        200_000 * 10**18
    ];

    // APR per tier in basis points (e.g. 500 = 5% APR)
    uint256[5] public tierAPR = [0, 200, 400, 700, 1200]; // 0%, 2%, 4%, 7%, 12%

    // Minimum lock period before unstake (in seconds)
    uint256 public minLockPeriod = 7 days;

    mapping(address => StakeInfo) public stakes;

    // Total staked per tier (for dashboard stats)
    uint256[5] public totalStakedByTier;
    uint256    public totalStaked;

    // Yield pool — funded by rake revenue
    uint256 public yieldPool;

    event Staked(address indexed player, uint256 amount, uint8 tier);
    event Unstaked(address indexed player, uint256 amount, uint256 yield);
    event YieldClaimed(address indexed player, uint256 amount);
    event YieldPoolFunded(uint256 amount);

    constructor(address _pppToken) Ownable(msg.sender) {
        pppToken = IERC20(_pppToken);
    }

    // ─── STAKE ────────────────────────────────────────────────────────────────
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        StakeInfo storage s = stakes[msg.sender];

        // Claim pending yield before changing stake
        if (s.amount > 0) _claimYield(msg.sender);

        pppToken.safeTransferFrom(msg.sender, address(this), amount);

        uint8 prevTier = s.tier;
        s.amount  += amount;
        s.since    = block.timestamp;
        s.lastClaim = block.timestamp;
        s.tier     = _calcTier(s.amount);

        totalStakedByTier[prevTier] -= (s.amount - amount); // adjust old tier count
        totalStakedByTier[s.tier]   += s.amount;
        totalStaked                 += amount;

        emit Staked(msg.sender, amount, s.tier);
    }

    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "Insufficient stake");
        require(block.timestamp >= s.since + minLockPeriod, "Still locked");

        // Claim yield first
        uint256 yield = _claimYield(msg.sender);

        uint8 prevTier = s.tier;
        s.amount -= amount;
        s.tier    = _calcTier(s.amount);

        totalStakedByTier[prevTier] -= amount;
        if (s.amount > 0) totalStakedByTier[s.tier] += s.amount;
        totalStaked -= amount;

        pppToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, yield);
    }

    function claimYield() external nonReentrant returns (uint256) {
        return _claimYield(msg.sender);
    }

    function _claimYield(address player) internal returns (uint256 earned) {
        StakeInfo storage s = stakes[player];
        if (s.amount == 0 || s.tier == 0) return 0;

        uint256 elapsed = block.timestamp - s.lastClaim;
        uint256 apr     = tierAPR[s.tier];
        earned          = (s.amount * apr * elapsed) / (10000 * 365 days);

        if (earned > yieldPool) earned = yieldPool;
        if (earned > 0) {
            yieldPool    -= earned;
            s.lastClaim   = block.timestamp;
            pppToken.safeTransfer(player, earned);
            emit YieldClaimed(player, earned);
        }
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────
    function getTier(address player) external view returns (uint8) {
        return stakes[player].tier;
    }

    function pendingYield(address player) external view returns (uint256) {
        StakeInfo storage s = stakes[player];
        if (s.amount == 0 || s.tier == 0) return 0;
        uint256 elapsed = block.timestamp - s.lastClaim;
        uint256 apr     = tierAPR[s.tier];
        uint256 earned  = (s.amount * apr * elapsed) / (10000 * 365 days);
        return earned > yieldPool ? yieldPool : earned;
    }

    function getStakeInfo(address player) external view returns (
        uint256 amount, uint8 tier, uint256 lockedUntil, uint256 aprBps
    ){
        StakeInfo storage s = stakes[player];
        return (s.amount, s.tier, s.since + minLockPeriod, tierAPR[s.tier]);
    }

    function getTierStats() external view returns (
        uint256[5] memory thresholds, uint256[5] memory aprs, uint256[5] memory counts
    ){
        return (tierThresholds, tierAPR, totalStakedByTier);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function fundYieldPool(uint256 amount) external {
        pppToken.safeTransferFrom(msg.sender, address(this), amount);
        yieldPool += amount;
        emit YieldPoolFunded(amount);
    }

    function setTierThresholds(uint256[5] calldata t) external onlyOwner { tierThresholds = t; }
    function setTierAPR(uint256[5] calldata a)        external onlyOwner { tierAPR = a; }
    function setMinLockPeriod(uint256 secs)           external onlyOwner { minLockPeriod = secs; }

    // ─── INTERNAL ─────────────────────────────────────────────────────────────
    function _calcTier(uint256 amount) internal view returns (uint8) {
        for (uint8 i = 4; i >= 1; i--)
            if (amount >= tierThresholds[i]) return i;
        return 0;
    }
}
