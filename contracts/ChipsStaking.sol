// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ChipsStaking — Stake SALOON to unlock VIP rake tiers and earn yield
///
/// Tiers (by staked SALOON):
///   0 Standard  —           0 SALOON — 1.5% rake —  0% APR
///   1 Bronze    —      25,000 SALOON — 1.3% rake —  5% APR
///   2 Silver    —     250,000 SALOON — 1.1% rake —  8% APR
///   3 Gold      —   1,000,000 SALOON — 0.9% rake — 12% APR
///   4 Whale     —   5,000,000 SALOON — 0.6% rake — 18% APR
///
/// Yield is pushed automatically from 35% of every rake settlement via receiveYield().
/// Use compound() to reinvest pending yield back into staked principal (true compounding).
contract ChipsStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct StakeInfo {
        uint256 amount;
        uint256 since;       // timestamp of last stake (lock resets on top-up)
        uint256 lastClaim;   // last yield claim timestamp
        uint8   tier;
    }

    IERC20 public immutable chipsToken;

    // Tier thresholds in SALOON (18 decimals)
    uint256[5] public tierThresholds = [
        0,
        25_000     * 10**18,
        250_000    * 10**18,
        1_000_000  * 10**18,
        5_000_000  * 10**18
    ];

    // APR per tier in basis points (500 = 5% APR)
    uint256[5] public tierAPR = [0, 500, 800, 1200, 1800]; // 0%, 5%, 8%, 12%, 18%

    uint256 public minLockPeriod = 7 days;

    mapping(address => StakeInfo) public stakes;

    // Addresses authorized to push yield (PokerEscrow, TournamentManager)
    mapping(address => bool) public yieldSources;

    uint256[5] public totalStakedByTier;
    uint256    public totalStaked;
    uint256    public yieldPool;

    event Staked(address indexed player, uint256 amount, uint8 tier);
    event Unstaked(address indexed player, uint256 amount, uint256 yieldEarned);
    event YieldClaimed(address indexed player, uint256 amount);
    event Compounded(address indexed player, uint256 yieldAdded, uint8 newTier);
    event YieldPoolFunded(uint256 amount);
    event YieldSourceSet(address indexed src, bool enabled);

    constructor(address _chipsToken) Ownable(msg.sender) {
        chipsToken = IERC20(_chipsToken);
    }

    // ─── STAKE ────────────────────────────────────────────────────────────────
    function stake(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        StakeInfo storage s = stakes[msg.sender];

        if (s.amount > 0) _claimYield(msg.sender);

        chipsToken.safeTransferFrom(msg.sender, address(this), amount);

        uint8 prevTier = s.tier;
        s.amount   += amount;
        s.since     = block.timestamp;
        s.lastClaim = block.timestamp;
        s.tier      = _calcTier(s.amount);

        totalStakedByTier[prevTier] -= (s.amount - amount);
        totalStakedByTier[s.tier]   += s.amount;
        totalStaked                 += amount;

        emit Staked(msg.sender, amount, s.tier);
    }

    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount >= amount, "Insufficient stake");
        require(block.timestamp >= s.since + minLockPeriod, "Still locked");

        uint256 yieldEarned = _claimYield(msg.sender);

        uint8 prevTier = s.tier;
        s.amount -= amount;
        s.tier    = _calcTier(s.amount);

        totalStakedByTier[prevTier] -= amount;
        if (s.amount > 0) totalStakedByTier[s.tier] += s.amount;
        totalStaked -= amount;

        chipsToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount, yieldEarned);
    }

    function claimYield() external nonReentrant returns (uint256) {
        return _claimYield(msg.sender);
    }

    /// @notice Reinvest pending yield into staked principal (true compounding).
    ///         Yield moves from yieldPool → staked amount, upgrading tier if threshold crossed.
    function compound() external nonReentrant {
        StakeInfo storage s = stakes[msg.sender];
        require(s.amount > 0 && s.tier > 0, "No active stake");

        uint256 elapsed = block.timestamp - s.lastClaim;
        uint256 earned  = (s.amount * tierAPR[s.tier] * elapsed) / (10000 * 365 days);
        if (earned > yieldPool) earned = yieldPool;
        require(earned > 0, "Nothing to compound");

        yieldPool   -= earned;
        s.lastClaim  = block.timestamp;
        // s.since is intentionally NOT reset: compounding does not extend the lock period.

        uint8 prevTier = s.tier;
        totalStakedByTier[prevTier] -= s.amount;

        s.amount += earned;          // yield added to principal
        s.tier    = _calcTier(s.amount);

        totalStakedByTier[s.tier] += s.amount;
        totalStaked               += earned;

        emit Compounded(msg.sender, earned, s.tier);
    }

    function _claimYield(address player) internal returns (uint256 earned) {
        StakeInfo storage s = stakes[player];
        if (s.amount == 0 || s.tier == 0) return 0;

        uint256 elapsed = block.timestamp - s.lastClaim;
        earned          = (s.amount * tierAPR[s.tier] * elapsed) / (10000 * 365 days);
        if (earned > yieldPool) earned = yieldPool;

        if (earned > 0) {
            yieldPool   -= earned;
            s.lastClaim  = block.timestamp;
            chipsToken.safeTransfer(player, earned);
            emit YieldClaimed(player, earned);
        }
    }

    // ─── YIELD POOL ───────────────────────────────────────────────────────────

    /// @notice Called by PokerEscrow/TournamentManager after transferring tokens here.
    ///         Registers the pushed amount as available yield.
    function receiveYield(uint256 amount) external {
        require(yieldSources[msg.sender], "Not authorized yield source");
        yieldPool += amount;
        emit YieldPoolFunded(amount);
    }

    /// @notice Anyone can top up the yield pool manually (e.g. community wallet)
    function fundYieldPool(uint256 amount) external {
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        yieldPool += amount;
        emit YieldPoolFunded(amount);
    }

    /// @notice One-time post-deploy: registers the 200M SALOON minted to this contract as yield.
    ///         Called by owner immediately after deploy + token transfer.
    function initYieldPool() external onlyOwner {
        require(yieldPool == 0, "Already initialized");
        uint256 bal = chipsToken.balanceOf(address(this));
        require(bal > 0, "No tokens present");
        yieldPool = bal;
        emit YieldPoolFunded(bal);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────
    function getTier(address player) external view returns (uint8) {
        return stakes[player].tier;
    }

    function pendingYield(address player) external view returns (uint256) {
        StakeInfo storage s = stakes[player];
        if (s.amount == 0 || s.tier == 0) return 0;
        uint256 elapsed = block.timestamp - s.lastClaim;
        uint256 earned  = (s.amount * tierAPR[s.tier] * elapsed) / (10000 * 365 days);
        return earned > yieldPool ? yieldPool : earned;
    }

    function getStakeInfo(address player) external view returns (
        uint256 amount, uint8 tier, uint256 lockedUntil, uint256 aprBps
    ) {
        StakeInfo storage s = stakes[player];
        return (s.amount, s.tier, s.since + minLockPeriod, tierAPR[s.tier]);
    }

    function getTierStats() external view returns (
        uint256[5] memory thresholds, uint256[5] memory aprs, uint256[5] memory counts
    ) {
        return (tierThresholds, tierAPR, totalStakedByTier);
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function setYieldSource(address src, bool enabled) external onlyOwner {
        yieldSources[src] = enabled;
        emit YieldSourceSet(src, enabled);
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
