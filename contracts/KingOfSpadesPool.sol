// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title KingOfSpadesPool — on-chain operating-expense fund
/// @notice Holds 100M CHIPS seed + 10% of all rake/lease fees.
///         Owner withdraws with an annotated reason for auditability.
///         Authorized callers (PokerEscrow, TournamentManager, TableRegistry) notify
///         this contract after transferring their rake slice to it.
contract KingOfSpadesPool is Ownable {
    using SafeERC20 for IERC20;

    string public constant poolName = "King of Spades Pool";
    IERC20 public immutable chipsToken;
    mapping(address => bool) public authorized;

    event PoolFunded(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount, string note);
    event AuthorizationUpdated(address indexed src, bool enabled);

    constructor(address _chipsToken) Ownable(msg.sender) {
        chipsToken = IERC20(_chipsToken);
    }

    /// @notice Rake contracts call this after transferring CHIPS to this pool.
    function receiveOps(uint256 amount) external {
        require(authorized[msg.sender], "KingsPool: not authorized");
        emit PoolFunded(msg.sender, amount);
    }

    /// @notice Owner withdraws CHIPS for operating expenses with an audit note.
    function withdraw(address to, uint256 amount, string calldata note) external onlyOwner {
        require(to != address(0), "KingsPool: zero address");
        chipsToken.safeTransfer(to, amount);
        emit Withdrawal(to, amount, note);
    }

    function setAuthorized(address src, bool enabled) external onlyOwner {
        authorized[src] = enabled;
        emit AuthorizationUpdated(src, enabled);
    }

    function balance() external view returns (uint256) {
        return chipsToken.balanceOf(address(this));
    }
}
