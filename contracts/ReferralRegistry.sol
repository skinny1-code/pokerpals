// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReferralRegistry — viral growth loop
/// @notice Players register a referrer once. 20% of that player's rake share
///         flows to their referrer on every hand (paid via PokerEscrow.settle).
///
/// Referral codes: each verified human gets a unique code = keccak(address)[0:8]
/// Share your code link: pokerpals.gg/ref/[code]
contract ReferralRegistry is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable pppToken;

    // player => referrer
    mapping(address => address) public referrers;

    // Referrer stats
    struct ReferrerStats {
        uint256 totalEarned;   // cumulative PPP earned from referral rake
        uint256 totalReferred; // number of players referred
        uint256 activeMonth;   // players who played in current month (simplified)
    }
    mapping(address => ReferrerStats) public stats;

    // Leaderboard: top referrers (updated on each creditRake call)
    address[10] public topReferrers;

    // Authorized callers (PokerEscrow, TournamentManager)
    mapping(address => bool) public authorized;

    // Multi-level referral is tracked but L2 token payments require PokerEscrow support
    // (currently not implemented — the emit below is intentionally removed to avoid misleading events)
    bool    public multiLevel       = false;
    uint256 public level2ShareBps   = 500; // reserved for future L2 payout support

    event Referred(address indexed player, address indexed referrer, bytes8 code);
    event RakeCredited(address indexed referrer, address indexed player, uint256 amount);
    event Level2Credited(address indexed l2, uint256 amount);

    constructor(address _token) Ownable(msg.sender) {
        pppToken = IERC20(_token);
    }

    // ─── REGISTRATION ─────────────────────────────────────────────────────────
    /// @notice Player sets their referrer using a referral code
    function registerWithCode(bytes8 code) external {
        require(referrers[msg.sender] == address(0), "Already referred");
        address referrer = codeToAddress(code);
        require(referrer != address(0) && referrer != msg.sender, "Bad code");
        _register(msg.sender, referrer);
    }

    function registerWithAddress(address referrer) external {
        require(referrers[msg.sender] == address(0), "Already referred");
        require(referrer != address(0) && referrer != msg.sender, "Bad referrer");
        _register(msg.sender, referrer);
    }

    function _register(address player, address referrer) internal {
        referrers[player] = referrer;
        stats[referrer].totalReferred++;
        emit Referred(player, referrer, addressToCode(referrer));
    }

    // ─── RAKE CREDIT ──────────────────────────────────────────────────────────
    /// @notice Called by PokerEscrow/TournamentManager after paying referral cut
    function creditRake(address player, uint256 amount) external {
        require(authorized[msg.sender], "Not authorized");
        address referrer = referrers[player];
        if (referrer == address(0)) return;

        stats[referrer].totalEarned += amount;
        _updateLeaderboard(referrer);

        // Level 2 bonus — reserved; no token transfer occurs here

        emit RakeCredited(referrer, player, amount);
    }

    // ─── CODES ────────────────────────────────────────────────────────────────
    function getMyCode(address player) external pure returns (bytes8) {
        return addressToCode(player);
    }

    function addressToCode(address addr) public pure returns (bytes8) {
        return bytes8(keccak256(abi.encodePacked(addr)));
    }

    function codeToAddress(bytes8 code) public view returns (address) {
        // In production: maintain a code→address mapping populated on first referral
        // Here we return zero for unknown codes (frontend should resolve via event log)
        return _codeMap[code];
    }

    mapping(bytes8 => address) private _codeMap;

    /// @notice Players register their code on first use
    function registerCode() external {
        bytes8 code = addressToCode(msg.sender);
        require(_codeMap[code] == address(0), "Code taken");
        _codeMap[code] = msg.sender;
    }

    // ─── LEADERBOARD ──────────────────────────────────────────────────────────
    function _updateLeaderboard(address referrer) internal {
        uint256 earned = stats[referrer].totalEarned;
        for (uint8 i = 0; i < 10; i++) {
            if (topReferrers[i] == referrer) return; // already on board
            if (topReferrers[i] == address(0) || stats[topReferrers[i]].totalEarned < earned) {
                // Shift down
                for (uint8 j = 9; j > i; j--) topReferrers[j] = topReferrers[j-1];
                topReferrers[i] = referrer;
                return;
            }
        }
    }

    function getLeaderboard() external view returns (
        address[10] memory addrs, uint256[10] memory earnings, uint256[10] memory referred
    ){
        for (uint8 i = 0; i < 10; i++) {
            addrs[i]    = topReferrers[i];
            earnings[i] = stats[topReferrers[i]].totalEarned;
            referred[i] = stats[topReferrers[i]].totalReferred;
        }
    }

    function getReferrer(address player) external view returns (address) {
        return referrers[player];
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────
    function setAuthorized(address caller, bool status) external onlyOwner { authorized[caller] = status; }
    function setMultiLevel(bool enabled, uint256 bps) external onlyOwner {
        require(bps <= 2000, "Max 20% L2");
        multiLevel = enabled; level2ShareBps = bps;
    }
}
