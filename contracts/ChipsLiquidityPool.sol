// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStablecoinPool {
    function notifyDeposit(uint256 amount) external;
    function authorizedPayout(address to, uint256 amount) external;
}

/// @title ChipsLiquidityPool — SALOON↔USDC trading pool at a fixed owner-set peg
/// @notice Seeded with 500M SALOON (full liquidity allocation). Players buy SALOON with
///         USDC or redeem SALOON back for USDC at the current peg rate.
///         USDC proceeds from sales flow into StablecoinPool; USDC payouts for
///         redemptions come from StablecoinPool.
///
/// Rate encoding: `rateUsdcPerChip` = USDC-wei per 1e18 SALOON-wei
///   $0.001/CHIP → rateUsdcPerChip = 1000  (1000 USDC-wei = 0.001 USDC with 6 decimals)
///   $0.01/CHIP  → rateUsdcPerChip = 10000
///   $1/CHIP     → rateUsdcPerChip = 1_000_000
contract ChipsLiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable chipsToken;
    IERC20 public immutable usdc;
    IStablecoinPool public stablecoinPool;

    uint256 public rateUsdcPerChip; // USDC-wei per 1e18 SALOON-wei
    bool    public paused;

    /// @notice Timestamp of the last `setRate` call. Zero until the first one, so
    ///         a deploy-time peg can be corrected immediately.
    uint256 public lastRateUpdate;

    /// The peg is the only thing standing between `redeemChips` and the USDC in
    /// StablecoinPool: `authorizedPayout` is exempt from that pool's redemption
    /// floor (it is what the floor exists to serve), so an unbounded `setRate`
    /// let the owner mint an arbitrarily large redemption and walk the reserve
    /// out through the front door — and a fat-fingered rate did the same by
    /// accident. Rate moves are capped at 10% per day in either direction, which
    /// leaves normal peg maintenance intact while making a drain slow, visible
    /// on-chain, and interruptible with `setPaused`.
    uint256 public constant MAX_RATE_CHANGE_BPS = 1_000; // 10%
    uint256 public constant RATE_UPDATE_COOLDOWN = 1 days;

    event ChipsBought(address indexed buyer, uint256 usdcIn, uint256 chipsOut);
    event ChipsRedeemed(address indexed redeemer, uint256 chipsIn, uint256 usdcOut);
    event RateUpdated(uint256 newRate);
    event Paused(bool isPaused);
    event ChipsDeposited(uint256 amount);
    event ChipsWithdrawn(uint256 amount);
    event StablecoinPoolUpdated(address newPool);

    error PoolPaused();
    error InsufficientChips();
    error ZeroAmount();
    error ZeroRate();
    error RateChangeTooLarge(uint256 minRate, uint256 maxRate);
    error RateUpdateTooSoon(uint256 retryAt);

    constructor(
        address _chipsToken,
        address _usdc,
        address _stablecoinPool,
        uint256 _rateUsdcPerChip
    ) Ownable(msg.sender) {
        require(_rateUsdcPerChip > 0, "Rate must be > 0");
        chipsToken      = IERC20(_chipsToken);
        usdc            = IERC20(_usdc);
        stablecoinPool  = IStablecoinPool(_stablecoinPool);
        rateUsdcPerChip = _rateUsdcPerChip;
    }

    // ─── PLAYER ACTIONS ───────────────────────────────────────────────────────

    /// @notice Buy SALOON with USDC. USDC goes directly into StablecoinPool.
    ///         Player must approve this contract for USDC before calling.
    function buyChips(uint256 usdcAmount) external nonReentrant {
        if (paused) revert PoolPaused();
        if (usdcAmount == 0) revert ZeroAmount();
        uint256 chipsOut = (usdcAmount * 1e18) / rateUsdcPerChip;
        if (chipsOut == 0) revert ZeroAmount();
        if (chipsToken.balanceOf(address(this)) < chipsOut) revert InsufficientChips();

        // Transfer USDC directly from player to StablecoinPool
        usdc.safeTransferFrom(msg.sender, address(stablecoinPool), usdcAmount);
        stablecoinPool.notifyDeposit(usdcAmount);

        // Send SALOON to player
        chipsToken.safeTransfer(msg.sender, chipsOut);
        emit ChipsBought(msg.sender, usdcAmount, chipsOut);
    }

    /// @notice Redeem SALOON for USDC. USDC is paid out from StablecoinPool.
    ///         Player must approve this contract for SALOON before calling.
    function redeemChips(uint256 chipsAmount) external nonReentrant {
        if (paused) revert PoolPaused();
        if (chipsAmount == 0) revert ZeroAmount();
        uint256 usdcOut = (chipsAmount * rateUsdcPerChip) / 1e18;
        if (usdcOut == 0) revert ZeroAmount();

        // Hold SALOON in this contract (float recycles for future buyers)
        chipsToken.safeTransferFrom(msg.sender, address(this), chipsAmount);

        // StablecoinPool pays USDC directly to the player
        stablecoinPool.authorizedPayout(msg.sender, usdcOut);
        emit ChipsRedeemed(msg.sender, chipsAmount, usdcOut);
    }

    // ─── OWNER ACTIONS ────────────────────────────────────────────────────────

    /// @notice Move the peg, by at most MAX_RATE_CHANGE_BPS and at most once per
    ///         RATE_UPDATE_COOLDOWN. A larger repeg is a sequence of steps, not a
    ///         single call — deliberately, see MAX_RATE_CHANGE_BPS above.
    function setRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert ZeroRate();

        uint256 nextAllowed = lastRateUpdate + RATE_UPDATE_COOLDOWN;
        if (lastRateUpdate != 0 && block.timestamp < nextAllowed)
            revert RateUpdateTooSoon(nextAllowed);

        uint256 current = rateUsdcPerChip;
        uint256 delta   = (current * MAX_RATE_CHANGE_BPS) / 10_000;
        uint256 minRate = current - delta;
        uint256 maxRate = current + delta;
        if (newRate < minRate || newRate > maxRate) revert RateChangeTooLarge(minRate, maxRate);

        rateUsdcPerChip = newRate;
        lastRateUpdate  = block.timestamp;
        emit RateUpdated(newRate);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function setStablecoinPool(address _pool) external onlyOwner {
        stablecoinPool = IStablecoinPool(_pool);
        emit StablecoinPoolUpdated(_pool);
    }

    /// @notice Owner tops up the SALOON float (requires prior approve).
    function depositChips(uint256 amount) external onlyOwner {
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        emit ChipsDeposited(amount);
    }

    /// @notice Owner drains SALOON from the pool (e.g. if market closes).
    function withdrawChips(uint256 amount) external onlyOwner {
        chipsToken.safeTransfer(msg.sender, amount);
        emit ChipsWithdrawn(amount);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function chipsBalance() external view returns (uint256) {
        return chipsToken.balanceOf(address(this));
    }

    /// @notice Quote: how many SALOON for a given USDC amount
    function quoteChipsOut(uint256 usdcAmount) external view returns (uint256) {
        return (usdcAmount * 1e18) / rateUsdcPerChip;
    }

    /// @notice Quote: how much USDC for a given SALOON amount
    function quoteUsdcOut(uint256 chipsAmount) external view returns (uint256) {
        return (chipsAmount * rateUsdcPerChip) / 1e18;
    }
}
