// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title PPPToken — PokerPartyPals Network Token
/// @notice Used as the denomination for all tables, pots, and rake distribution
contract PPPToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 10 ** 18; // 1 billion PPP
    uint256 public constant DEV_RESERVE = 100_000_000 * 10 ** 18;  // 10% dev/ops
    uint256 public constant COMMUNITY    = 400_000_000 * 10 ** 18; // 40% community rewards
    uint256 public constant LIQUIDITY    = 500_000_000 * 10 ** 18; // 50% liquidity

    address public escrowFactory;

    event EscrowFactorySet(address indexed factory);

    constructor(address devWallet, address communityWallet, address liquidityWallet)
        ERC20("PokerPartyPals", "PPP")
        Ownable(msg.sender)
    {
        _mint(devWallet,       DEV_RESERVE);
        _mint(communityWallet, COMMUNITY);
        _mint(liquidityWallet, LIQUIDITY);
    }

    function setEscrowFactory(address _factory) external onlyOwner {
        escrowFactory = _factory;
        emit EscrowFactorySet(_factory);
    }

    /// @notice Convenience faucet for testnet only — remove on mainnet
    function faucet(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }
}
