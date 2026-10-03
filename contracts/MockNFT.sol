// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title MockNFT — a plain ERC-721 for tests, alongside MockUSDC
/// @notice Stands in for any collection a room might gate on
///         (TableRegistry.canSit only reads balanceOf). Free to mint and with
///         no access control, so a test can hand tokens out and move them
///         around; never deploy this outside a test chain.
contract MockNFT is ERC721 {
    uint256 public nextId = 1;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId++;
        _mint(to, tokenId);
    }
}
