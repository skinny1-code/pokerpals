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

/// @title ChipsLiquidityPool — CHIPS↔USDC trading pool at a fixed owner-set peg
/// @notice Seeded with 500M CHIPS (full liquidity allocation). Players buy CHIPS with
///         USDC or redeem CHIPS back for USDC at the current peg rate.
///         USDC proceeds from sales flow into StablecoinPool; USDC payouts for
///         redemptions come from StablecoinPool.
///
/// Rate encoding: `rateUsdcPerChip` = USDC-wei per 1e18 CHIPS-wei
///   $0.001/CHIP → rateUsdcPerChip = 1000  (1000 USDC-wei = 0.001 USDC with 6 decimals)
///   $0.01/CHIP  → rateUsdcPerChip = 10000
///   $1/CHIP     → rateUsdcPerChip = 1_000_000
contract ChipsLiquidityPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable chipsToken;
    IERC20 public immutable usdc;
    IStablecoinPool public stablecoinPool;

    uint256 public rateUsdcPerChip; // USDC-wei per 1e18 CHIPS-wei
    bool    public paused;

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

    /// @notice Buy CHIPS with USDC. USDC goes directly into StablecoinPool.
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

        // Send CHIPS to player
        chipsToken.safeTransfer(msg.sender, chipsOut);
        emit ChipsBought(msg.sender, usdcAmount, chipsOut);
    }

    /// @notice Redeem CHIPS for USDC. USDC is paid out from StablecoinPool.
    ///         Player must approve this contract for CHIPS before calling.
    function redeemChips(uint256 chipsAmount) external nonReentrant {
        if (paused) revert PoolPaused();
        if (chipsAmount == 0) revert ZeroAmount();
        uint256 usdcOut = (chipsAmount * rateUsdcPerChip) / 1e18;
        if (usdcOut == 0) revert ZeroAmount();

        // Hold CHIPS in this contract (float recycles for future buyers)
        chipsToken.safeTransferFrom(msg.sender, address(this), chipsAmount);

        // StablecoinPool pays USDC directly to the player
        stablecoinPool.authorizedPayout(msg.sender, usdcOut);
        emit ChipsRedeemed(msg.sender, chipsAmount, usdcOut);
    }

    // ─── OWNER ACTIONS ────────────────────────────────────────────────────────

    function setRate(uint256 newRate) external onlyOwner {
        if (newRate == 0) revert ZeroRate();
        rateUsdcPerChip = newRate;
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

    /// @notice Owner tops up the CHIPS float (requires prior approve).
    function depositChips(uint256 amount) external onlyOwner {
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        emit ChipsDeposited(amount);
    }

    /// @notice Owner drains CHIPS from the pool (e.g. if market closes).
    function withdrawChips(uint256 amount) external onlyOwner {
        chipsToken.safeTransfer(msg.sender, amount);
        emit ChipsWithdrawn(amount);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function chipsBalance() external view returns (uint256) {
        return chipsToken.balanceOf(address(this));
    }

    /// @notice Quote: how many CHIPS for a given USDC amount
    function quoteChipsOut(uint256 usdcAmount) external view returns (uint256) {
        return (usdcAmount * 1e18) / rateUsdcPerChip;
    }

    /// @notice Quote: how much USDC for a given CHIPS amount
    function quoteUsdcOut(uint256 chipsAmount) external view returns (uint256) {
        return (chipsAmount * rateUsdcPerChip) / 1e18;
    }
}
