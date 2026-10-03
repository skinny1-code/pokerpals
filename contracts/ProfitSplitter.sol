// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChipsStaking {
    function stake(uint256 amount) external;
    function unstake(uint256 amount) external;
    function claimYield() external returns (uint256);
}

interface IChipsTokenVest {
    function claimDevVest() external;
}

/// @title ProfitSplitter — routes all owner income to one wallet, half staked
/// @notice Set as `rakeRecipient` on PokerEscrow / TournamentManager / TableRegistry
///         and as `devWallet` on ChipsToken, so every income stream lands here.
///         Anyone may call distribute(): the SALOON balance is split — `payoutBps`
///         (default 50%) goes straight to the payout wallet, the remainder is
///         staked in ChipsStaking. The stake is held by this contract and earns
///         tier APR; staking yield claimed back into this contract is split by
///         the same rule on the next distribute(). Funds can only ever move to
///         the payout wallet or the staking contract, so the open distribute()
///         is safe to expose. Owner can retarget the wallet, retune the split,
///         and unstake principal (paid to the payout wallet, never the caller).
contract ProfitSplitter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20        public immutable chipsToken;
    IChipsStaking public immutable staking;
    address       public payoutWallet;
    uint256       public payoutBps = 5000; // direct share; remainder is staked

    event Distributed(uint256 toWallet, uint256 staked);
    event PayoutWalletSet(address indexed wallet);
    event PayoutBpsSet(uint256 bps);
    event UnstakedToPayout(uint256 requested, uint256 forwarded);

    constructor(address _chipsToken, address _staking, address _payoutWallet) Ownable(msg.sender) {
        require(_chipsToken != address(0) && _staking != address(0) && _payoutWallet != address(0), "Zero address");
        chipsToken   = IERC20(_chipsToken);
        staking      = IChipsStaking(_staking);
        payoutWallet = _payoutWallet;
    }

    /// @notice Split the accumulated SALOON balance: payoutBps → wallet, rest → staked.
    function distribute() external nonReentrant {
        uint256 bal = chipsToken.balanceOf(address(this));
        require(bal > 0, "Nothing to distribute");

        uint256 toWallet = (bal * payoutBps) / 10000;
        uint256 toStake  = bal - toWallet;

        if (toWallet > 0) chipsToken.safeTransfer(payoutWallet, toWallet);
        if (toStake > 0) {
            chipsToken.forceApprove(address(staking), toStake);
            staking.stake(toStake);
        }
        emit Distributed(toWallet, toStake);
    }

    /// @notice Pull accrued staking yield into this contract; it joins the next
    ///         distribute() split. Callable by anyone — yield can't go anywhere else.
    function harvestYield() external nonReentrant {
        staking.claimYield();
    }

    /// @notice Claim the monthly dev vest from ChipsToken (this contract must be
    ///         set as devWallet). Vested SALOON land here for the next distribute().
    function claimDevVest() external nonReentrant {
        IChipsTokenVest(address(chipsToken)).claimDevVest();
    }

    /// @notice Unstake principal and forward everything received (principal +
    ///         auto-claimed yield) to the payout wallet.
    function unstakeToPayout(uint256 amount) external onlyOwner nonReentrant {
        uint256 before = chipsToken.balanceOf(address(this));
        staking.unstake(amount);
        uint256 received = chipsToken.balanceOf(address(this)) - before;
        chipsToken.safeTransfer(payoutWallet, received);
        emit UnstakedToPayout(amount, received);
    }

    function setPayoutWallet(address w) external onlyOwner {
        require(w != address(0), "Zero address");
        payoutWallet = w;
        emit PayoutWalletSet(w);
    }

    function setPayoutBps(uint256 bps) external onlyOwner {
        require(bps <= 10000, "Max 10000");
        payoutBps = bps;
        emit PayoutBpsSet(bps);
    }

    /// @notice Rescue tokens other than SALOON that were sent here by mistake.
    function sweep(address token, address to) external onlyOwner {
        require(token != address(chipsToken), "Use distribute for SALOON");
        IERC20(token).safeTransfer(to, IERC20(token).balanceOf(address(this)));
    }
}
