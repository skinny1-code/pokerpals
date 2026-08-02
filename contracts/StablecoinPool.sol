// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title StablecoinPool — on-network USDC reserve
/// @notice Holds USDC received from CHIPS sales. Used for player redemptions,
///         prize pools, and on-network payouts. ChipsLiquidityPool is the
///         authorized caller for deposits (from CHIPS sales) and payouts (redemptions).
contract StablecoinPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    mapping(address => bool) public authorized;

    /// @notice USDC that backs CHIPS already sold (deposits from sales minus
    ///         redemption payouts). The owner cannot withdraw below this floor,
    ///         so player redemptions can never be rugged by an owner withdrawal.
    uint256 public reservedUsdc;

    event Deposited(address indexed from, uint256 amount);
    event USDCPaidOut(address indexed to, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount, string note);
    event AuthorizationUpdated(address indexed src, bool enabled);

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    /// @notice Authorized caller (ChipsLiquidityPool) notifies after player USDC
    ///         was transferred directly to this contract via safeTransferFrom.
    function notifyDeposit(uint256 amount) external {
        require(authorized[msg.sender], "StablecoinPool: not authorized");
        reservedUsdc += amount; // this USDC now backs outstanding CHIPS float
        emit Deposited(msg.sender, amount);
    }

    /// @notice Authorized caller pays out USDC to a player (for CHIPS redemption).
    function authorizedPayout(address to, uint256 amount) external {
        require(authorized[msg.sender], "StablecoinPool: not authorized");
        require(usdc.balanceOf(address(this)) >= amount, "StablecoinPool: insufficient USDC");
        // A redemption releases part of the backing float.
        reservedUsdc = amount >= reservedUsdc ? 0 : reservedUsdc - amount;
        usdc.safeTransfer(to, amount);
        emit USDCPaidOut(to, amount);
    }

    /// @notice Owner deposits USDC directly to seed the reserve (requires prior approve).
    function deposit(uint256 amount) external onlyOwner {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Owner withdraws USDC for on-network use (prizes, payouts, promos).
    function withdraw(address to, uint256 amount, string calldata note) external onlyOwner {
        require(to != address(0), "StablecoinPool: zero address");
        uint256 bal = usdc.balanceOf(address(this));
        require(bal >= amount, "StablecoinPool: insufficient USDC");
        // Owner may only withdraw surplus above the redemption reserve, so the
        // USDC backing outstanding CHIPS can never be drained out from under holders.
        require(bal - amount >= reservedUsdc, "StablecoinPool: would breach redemption reserve");
        usdc.safeTransfer(to, amount);
        emit Withdrawal(to, amount, note);
    }

    function setAuthorized(address src, bool enabled) external onlyOwner {
        authorized[src] = enabled;
        emit AuthorizationUpdated(src, enabled);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
