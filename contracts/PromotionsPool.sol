// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PromotionsPool — community & promotions budget
/// @notice Seeded with 100M CHIPS (community allocation). Owner allocates CHIPS
///         for contests, tournaments, airdrops, rake-free promotional periods, etc.
///         No incoming rake flows — purely the 100M seed plus any owner top-ups.
contract PromotionsPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable chipsToken;

    event Withdrawal(address indexed to, uint256 amount, string note);
    event PoolToppedUp(uint256 amount);

    constructor(address _chipsToken) Ownable(msg.sender) {
        chipsToken = IERC20(_chipsToken);
    }

    /// @notice Owner withdraws CHIPS to fund a promotion, contest, or airdrop.
    function withdraw(address to, uint256 amount, string calldata note) external onlyOwner {
        require(to != address(0), "PromotionsPool: zero address");
        chipsToken.safeTransfer(to, amount);
        emit Withdrawal(to, amount, note);
    }

    /// @notice Owner can top up the pool (requires prior approve).
    function topUp(uint256 amount) external onlyOwner {
        chipsToken.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolToppedUp(amount);
    }

    function balance() external view returns (uint256) {
        return chipsToken.balanceOf(address(this));
    }
}
