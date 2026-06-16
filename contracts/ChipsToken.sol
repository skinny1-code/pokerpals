// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ChipsToken — PokerVsPlayer in-game currency ("PokerChips / CHIPS")
/// @notice Used as the denomination for all tables, pots, and rake distribution.
///         Dev allocation is locked in-contract and linearly vested over 24 months.
contract ChipsToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY      = 1_000_000_000 * 10**18; // 1 billion CHIPS
    uint256 public constant DEV_RESERVE     =   100_000_000 * 10**18; // 10% dev (vested 24 mo)
    uint256 public constant STAKING_POOL    =   200_000_000 * 10**18; // 20% staking rewards
    uint256 public constant COMMUNITY_ALLOC =   100_000_000 * 10**18; // 10% community (tournaments, airdrops, grants)
    uint256 public constant OPS_RESERVE     =   100_000_000 * 10**18; // 10% ops/devops budget (servers, staff, marketing)
    uint256 public constant LIQUIDITY_ALLOC =   500_000_000 * 10**18; // 50% liquidity

    // Dev vesting — linear over 24 months, starts at deploy
    address public devWallet;
    uint256 public devReleaseStart;
    uint256 public devReleased;

    address public escrowFactory;

    event EscrowFactorySet(address indexed factory);
    event DevVestClaimed(address indexed devWallet, uint256 amount);

    constructor(address _devWallet, address communityWallet, address liquidityWallet, address opsWallet)
        ERC20("PokerChips", "CHIPS")
        Ownable(msg.sender)
    {
        devWallet       = _devWallet;
        devReleaseStart = block.timestamp;

        // Dev tokens locked in this contract, released linearly over 24 months
        _mint(address(this),   DEV_RESERVE);
        _mint(communityWallet, COMMUNITY_ALLOC);
        _mint(opsWallet,       OPS_RESERVE);
        _mint(liquidityWallet, LIQUIDITY_ALLOC);
        // Deployer receives staking pool to transfer into ChipsStaking post-deploy
        _mint(msg.sender,      STAKING_POOL);
    }

    // ─── DEV VESTING ──────────────────────────────────────────────────────────
    /// @notice Dev claims their linearly vested tokens. Callable any time.
    function claimDevVest() external {
        require(msg.sender == devWallet, "Not dev wallet");
        uint256 elapsed   = block.timestamp - devReleaseStart;
        uint256 vested    = (DEV_RESERVE * elapsed) / (2 * 365 days);
        if (vested > DEV_RESERVE) vested = DEV_RESERVE;
        uint256 claimable = vested - devReleased;
        require(claimable > 0, "Nothing claimable");
        devReleased += claimable;
        _transfer(address(this), devWallet, claimable);
        emit DevVestClaimed(devWallet, claimable);
    }

    /// @notice How many CHIPS the dev wallet can claim right now
    function devClaimable() external view returns (uint256) {
        uint256 elapsed = block.timestamp - devReleaseStart;
        uint256 vested  = (DEV_RESERVE * elapsed) / (2 * 365 days);
        if (vested > DEV_RESERVE) vested = DEV_RESERVE;
        return vested > devReleased ? vested - devReleased : 0;
    }

    function setDevWallet(address w) external onlyOwner { devWallet = w; }

    function setEscrowFactory(address _factory) external onlyOwner {
        escrowFactory = _factory;
        emit EscrowFactorySet(_factory);
    }

    /// @notice Testnet faucet — REMOVE before mainnet deployment
    function faucet(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }
}
