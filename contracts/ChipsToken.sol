// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ChipsToken — Saloon in-game currency ("Saloon / SALOON")
/// @notice Used as the denomination for all tables, pots, and rake distribution.
///         Dev allocation: 25M released at deploy + 2M/month thereafter (2% of total per month).
contract ChipsToken is ERC20, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY        = 1_000_000_000 * 10**18; // 1 billion SALOON
    uint256 public constant DEV_RESERVE       =   100_000_000 * 10**18; // 10% dev total
    uint256 public constant DEV_INITIAL_GRANT =    25_000_000 * 10**18; // 25M released at deploy
    uint256 public constant DEV_MONTHLY_RATE  =     2_000_000 * 10**18; // 2M/month (2% of 100M)
    uint256 public constant STAKING_POOL      =   200_000_000 * 10**18; // 20% staking rewards
    uint256 public constant COMMUNITY_ALLOC   =   100_000_000 * 10**18; // 10% community (tournaments, airdrops, grants)
    uint256 public constant OPS_RESERVE       =   100_000_000 * 10**18; // 10% ops/devops budget (servers, staff, marketing)
    uint256 public constant LIQUIDITY_ALLOC   =   500_000_000 * 10**18; // 50% liquidity

    // Dev vesting — 25M upfront at deploy, then 2M/month from the remaining 75M
    address public devWallet;
    uint256 public devReleaseStart;
    uint256 public devReleased; // tracks only the monthly-vest portion claimed

    address public escrowFactory;

    event EscrowFactorySet(address indexed factory);
    event DevVestClaimed(address indexed devWallet, uint256 amount);

    constructor(address _devWallet, address communityWallet, address liquidityWallet, address opsWallet)
        ERC20("Saloon", "SALOON")
        Ownable(msg.sender)
    {
        devWallet       = _devWallet;
        devReleaseStart = block.timestamp;

        // Lock the vesting portion (75M) in this contract; send 25M upfront to dev
        _mint(address(this),   DEV_RESERVE - DEV_INITIAL_GRANT);
        _mint(_devWallet,      DEV_INITIAL_GRANT);
        _mint(communityWallet, COMMUNITY_ALLOC);
        _mint(opsWallet,       OPS_RESERVE);
        _mint(liquidityWallet, LIQUIDITY_ALLOC);
        // Deployer receives staking pool to transfer into ChipsStaking post-deploy
        _mint(msg.sender,      STAKING_POOL);
    }

    // ─── DEV VESTING ──────────────────────────────────────────────────────────
    /// @notice Dev claims monthly-vested tokens at 2M/month. Callable any time.
    function claimDevVest() external {
        require(msg.sender == devWallet, "Not dev wallet");
        uint256 monthsElapsed = (block.timestamp - devReleaseStart) / 30 days;
        uint256 vestable      = DEV_RESERVE - DEV_INITIAL_GRANT; // 75M
        uint256 vested        = monthsElapsed * DEV_MONTHLY_RATE;
        if (vested > vestable) vested = vestable;
        uint256 claimable = vested - devReleased;
        require(claimable > 0, "Nothing claimable");
        devReleased += claimable;
        _transfer(address(this), devWallet, claimable);
        emit DevVestClaimed(devWallet, claimable);
    }

    /// @notice How many SALOON the dev wallet can claim right now from monthly vest
    function devClaimable() external view returns (uint256) {
        uint256 monthsElapsed = (block.timestamp - devReleaseStart) / 30 days;
        uint256 vestable      = DEV_RESERVE - DEV_INITIAL_GRANT;
        uint256 vested        = monthsElapsed * DEV_MONTHLY_RATE;
        if (vested > vestable) vested = vestable;
        return vested > devReleased ? vested - devReleased : 0;
    }

    function setDevWallet(address w) external onlyOwner { devWallet = w; }

    function setEscrowFactory(address _factory) external onlyOwner {
        escrowFactory = _factory;
        emit EscrowFactorySet(_factory);
    }
}
