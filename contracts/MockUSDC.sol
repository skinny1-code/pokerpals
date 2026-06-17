// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC — testnet USDC stand-in
/// @notice 6 decimals to match real USDC. Owner can mint freely for testing.
///         REMOVE / do not deploy on mainnet — use 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 instead.
contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) { return 6; }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
