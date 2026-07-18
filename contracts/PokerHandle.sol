// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IChipsTokenMint is IERC20 {
    function burn(uint256 amount) external;
}

interface IHandleRenderer {
    function render(string memory handle, uint256 tokenId, uint8 tier, uint8 animal) external view returns (bytes memory);
    function animalName(uint8 idx) external view returns (string memory);
}

interface IPokerEscrow {
    function humanVerified(address) external view returns (bool);
}

/// @title PokerHandle — on-chain poker username NFT
///
/// Players burn CHIPS to mint a unique handle (e.g. "Shark_99").
/// Each token gets a deterministic poker animal identity (Bear, Wolf, Fox, Shark,
/// Eagle, Tiger, Rabbit, or Bull) based on a hash of the token ID — on-chain SVG.
///
/// Handle rules:
///   - 3–20 characters, alphanumeric + underscore, case-insensitive unique
///   - One handle per wallet (transferable as NFT)
///
/// Rarity tiers by token ID (affects badge/edition, not animal):
///   #1–10,000        GENESIS OG
///   #10,001–110,000  EARLY BIRD
///   #110,001–1.11M   RARE
///   #1.11M+          STANDARD
contract PokerHandle is ERC721, Ownable {
    using SafeERC20 for IChipsTokenMint;
    using Strings for uint256;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    IChipsTokenMint public immutable chipsToken;
    IPokerEscrow    public immutable escrow;
    // Swappable art module — upgrade the NFT visuals without redeploying this
    // contract or re-minting: deploy a new renderer, call setRenderer.
    IHandleRenderer public renderer;

    uint256[3] public tierBounds = [10_000, 110_000, 1_110_000];
    uint256[4] public tierCosts  = [
        5_000  * 10**18,  // tier 0 — $5  @ $0.001/CHIP
        10_000 * 10**18,  // tier 1 — $10
        15_000 * 10**18,  // tier 2 — $15
        20_000 * 10**18   // tier 3 — $20
    ];

    uint256 public totalMinted;
    uint256 public totalBurned;

    mapping(uint256 => string)   private _handles;
    mapping(string  => bool)     public  handleTaken;
    mapping(address => uint256)  public  ownerTokenId;

    /// @notice Wallet-linking ("functional alias") — a linked wallet plays under the
    /// handle's identity without owning its own NFT, funding its own buy-ins.
    uint256 public constant MAX_LINKED_WALLETS = 5;
    mapping(uint256 => address[]) private _linkedWallets;   // tokenId => linked wallets
    mapping(address => uint256)   public  linkedToToken;     // wallet => tokenId it's linked to (0 = none)
    mapping(address => uint256)   private _linkedIndex;      // wallet => index in _linkedWallets[tokenId]

    event HandleMinted(address indexed player, uint256 tokenId, string handle, uint256 burned);
    event HandleChanged(address indexed player, uint256 indexed tokenId, string oldHandle, string newHandle, uint256 burned);
    event TierCostsUpdated(uint256[4] costs);
    event TierBoundsUpdated(uint256[3] bounds);
    event WalletLinked(uint256 indexed tokenId, address indexed owner, address indexed wallet);
    event WalletUnlinked(uint256 indexed tokenId, address indexed owner, address indexed wallet);

    error HandleTooShort();
    error HandleTooLong();
    error InvalidCharacter(bytes1 c);
    error HandleAlreadyTaken(string handle);
    error AlreadyHasHandle(address player);
    error NotHumanVerified(address player);
    error NoHandle(address player);
    error CannotLinkSelf();
    error AlreadyLinked(address wallet);
    error TooManyLinkedWallets(uint256 tokenId);
    error InvalidLinkProof();
    error NotLinked(address wallet);

    constructor(address _chipsToken, address _escrow, address _renderer) ERC721("PokerVsPlayer Handle", "HANDLE") Ownable(msg.sender) {
        chipsToken = IChipsTokenMint(_chipsToken);
        escrow = IPokerEscrow(_escrow);
        renderer = IHandleRenderer(_renderer);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function getCurrentMintCost() public view returns (uint256) {
        uint256 m = totalMinted;
        if (m < tierBounds[0]) return tierCosts[0];
        if (m < tierBounds[1]) return tierCosts[1];
        if (m < tierBounds[2]) return tierCosts[2];
        return tierCosts[3];
    }

    function getCurrentTier() public view returns (uint8) {
        uint256 m = totalMinted;
        if (m < tierBounds[0]) return 0;
        if (m < tierBounds[1]) return 1;
        if (m < tierBounds[2]) return 2;
        return 3;
    }

    function getHandle(uint256 tokenId) external view returns (string memory) {
        require(tokenId > 0 && tokenId <= totalMinted, "Not found");
        return _handles[tokenId];
    }

    function getHandleByAddress(address player) external view returns (string memory) {
        uint256 id = ownerTokenId[player];
        if (id == 0) return "";
        return _handles[id];
    }

    /// @notice Rarity tier based on token ID (lower = rarer)
    function getTokenTier(uint256 tokenId) public view returns (uint8) {
        if (tokenId <= tierBounds[0]) return 0;
        if (tokenId <= tierBounds[1]) return 1;
        if (tokenId <= tierBounds[2]) return 2;
        return 3;
    }

    /// @notice Animal type 0–7 derived from token ID hash
    function getAnimal(uint256 tokenId) public pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encodePacked(tokenId))) % 8);
    }

    // ─── MINT ─────────────────────────────────────────────────────────────────

    function mintHandle(string calldata handle) external {
        if (ownerTokenId[msg.sender] != 0) revert AlreadyHasHandle(msg.sender);
        if (!escrow.humanVerified(msg.sender)) revert NotHumanVerified(msg.sender);

        _validateHandle(handle);

        string memory lower = _toLower(handle);
        if (handleTaken[lower]) revert HandleAlreadyTaken(handle);
        handleTaken[lower] = true;

        uint256 cost = getCurrentMintCost();
        chipsToken.safeTransferFrom(msg.sender, address(this), cost);
        chipsToken.burn(cost);
        totalBurned += cost;

        uint256 tokenId = ++totalMinted;
        _handles[tokenId] = handle;
        // ownerTokenId is set inside _update during _safeMint — do NOT pre-set it here

        _safeMint(msg.sender, tokenId);
        emit HandleMinted(msg.sender, tokenId, handle, cost);
    }

    /// @notice Replace the caller's existing handle with a new one for the current
    /// mint-tier cost (burned, same as a fresh mint). Keeps the same tokenId, so the
    /// rarity tier, animal art, and any linked wallets are unaffected — only the
    /// displayed name changes. Frees the old name for others to claim.
    function changeHandle(string calldata newHandle) external {
        uint256 tokenId = ownerTokenId[msg.sender];
        if (tokenId == 0) revert NoHandle(msg.sender);

        _validateHandle(newHandle);
        string memory newLower = _toLower(newHandle);
        if (handleTaken[newLower]) revert HandleAlreadyTaken(newHandle);

        uint256 cost = getCurrentMintCost();
        chipsToken.safeTransferFrom(msg.sender, address(this), cost);
        chipsToken.burn(cost);
        totalBurned += cost;

        string memory oldHandle = _handles[tokenId];
        handleTaken[_toLower(oldHandle)] = false;
        handleTaken[newLower] = true;
        _handles[tokenId] = newHandle;

        emit HandleChanged(msg.sender, tokenId, oldHandle, newHandle, cost);
    }

    // ─── WALLET LINKING (functional alias) ─────────────────────────────────────

    /// @notice Link `wallet` to the caller's handle so it can play under the same
    /// identity without minting its own handle. `wallet` must sign a proof of consent.
    function linkWallet(address wallet, bytes calldata signature) external {
        uint256 tokenId = ownerTokenId[msg.sender];
        if (tokenId == 0) revert NoHandle(msg.sender);
        if (wallet == msg.sender) revert CannotLinkSelf();
        if (ownerTokenId[wallet] != 0) revert AlreadyHasHandle(wallet);
        if (linkedToToken[wallet] != 0) revert AlreadyLinked(wallet);
        if (_linkedWallets[tokenId].length >= MAX_LINKED_WALLETS) revert TooManyLinkedWallets(tokenId);
        if (!escrow.humanVerified(wallet)) revert NotHumanVerified(wallet);

        bytes32 hash = keccak256(abi.encodePacked("PVP-LINK:", block.chainid, address(this), msg.sender, tokenId));
        if (hash.toEthSignedMessageHash().recover(signature) != wallet) revert InvalidLinkProof();

        linkedToToken[wallet] = tokenId;
        _linkedIndex[wallet] = _linkedWallets[tokenId].length;
        _linkedWallets[tokenId].push(wallet);

        emit WalletLinked(tokenId, msg.sender, wallet);
    }

    /// @notice Remove a previously linked wallet from the caller's handle.
    function unlinkWallet(address wallet) external {
        uint256 tokenId = ownerTokenId[msg.sender];
        if (tokenId == 0) revert NoHandle(msg.sender);
        if (linkedToToken[wallet] != tokenId) revert NotLinked(wallet);

        _removeLinkedWallet(tokenId, wallet);
        emit WalletUnlinked(tokenId, msg.sender, wallet);
    }

    function _removeLinkedWallet(uint256 tokenId, address wallet) internal {
        address[] storage arr = _linkedWallets[tokenId];
        uint256 idx = _linkedIndex[wallet];
        uint256 lastIdx = arr.length - 1;
        if (idx != lastIdx) {
            address lastWallet = arr[lastIdx];
            arr[idx] = lastWallet;
            _linkedIndex[lastWallet] = idx;
        }
        arr.pop();
        delete linkedToToken[wallet];
        delete _linkedIndex[wallet];
    }

    function _clearLinkedWallets(uint256 tokenId) internal {
        address[] storage arr = _linkedWallets[tokenId];
        uint256 len = arr.length;
        for (uint256 i; i < len; i++) {
            delete linkedToToken[arr[i]];
            delete _linkedIndex[arr[i]];
        }
        delete _linkedWallets[tokenId];
    }

    /// @notice The tokenId `who` plays under — their own handle, or the handle
    /// they're linked to as an alias wallet. 0 if neither.
    function effectiveTokenId(address who) public view returns (uint256) {
        uint256 own = ownerTokenId[who];
        if (own != 0) return own;
        return linkedToToken[who];
    }

    /// @notice True if `who` owns a handle or is linked as an alias wallet to one —
    /// the single eligibility check for cash games, table creation, and tournaments.
    function isHandleEligible(address who) external view returns (bool) {
        return effectiveTokenId(who) != 0;
    }

    /// @notice The handle string `who` plays under, resolving through wallet links.
    function getEffectiveHandle(address who) external view returns (string memory) {
        uint256 tokenId = effectiveTokenId(who);
        if (tokenId == 0) return "";
        return _handles[tokenId];
    }

    function getLinkedWallets(uint256 tokenId) external view returns (address[] memory) {
        return _linkedWallets[tokenId];
    }

    // ─── TOKEN URI (fully on-chain SVG with poker animal art) ─────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId <= totalMinted, "Not found");
        string memory handle    = _handles[tokenId];
        uint8         tier      = getTokenTier(tokenId);
        uint8         animal    = getAnimal(tokenId);

        bytes memory svg = renderer.render(handle, tokenId, tier, animal);

        string memory animalName = renderer.animalName(animal);
        string memory tierName = _tierName(tier);

        bytes memory json = abi.encodePacked(
            '{"name":"@', handle, '",',
            '"description":"PokerVsPlayer on-chain poker handle. Burns CHIPS to mint. Each handle has a unique poker animal identity.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(svg), '",',
            '"attributes":[',
            '{"trait_type":"Handle","value":"', handle, '"},',
            '{"trait_type":"Animal","value":"', animalName, '"},',
            '{"trait_type":"Edition","value":"', tierName, '"},',
            '{"trait_type":"Token ID","value":', tokenId.toString(), '}',
            ']}'
        );

        return string(abi.encodePacked(
            "data:application/json;base64,", Base64.encode(json)
        ));
    }

    function _tierName(uint8 art) internal pure returns (string memory) {
        if (art == 0) return "Genesis OG";
        if (art == 1) return "Early Bird";
        if (art == 2) return "Rare";
        return "Standard";
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    /// @notice Swap the art module — every token's image updates instantly,
    ///         no re-minting. Identity data (handles, owners, tiers) is untouched.
    function setRenderer(address r) external onlyOwner {
        require(r != address(0), "Zero address");
        renderer = IHandleRenderer(r);
    }

    function setTierCosts(uint256[4] calldata costs) external onlyOwner {
        tierCosts = costs;
        emit TierCostsUpdated(costs);
    }

    function setTierBounds(uint256[3] calldata bounds) external onlyOwner {
        require(bounds[0] < bounds[1] && bounds[1] < bounds[2], "Bounds must be ascending");
        tierBounds = bounds;
        emit TierBoundsUpdated(bounds);
    }

    function reserveHandle(string calldata handle, address recipient) external onlyOwner {
        _validateHandle(handle);
        string memory lower = _toLower(handle);
        require(!handleTaken[lower], "Taken");
        require(ownerTokenId[recipient] == 0, "Already has handle");
        handleTaken[lower] = true;

        uint256 tokenId = ++totalMinted;
        _handles[tokenId] = handle;

        _safeMint(recipient, tokenId);
    }

    // ─── ERC-721 TRANSFER HOOK ────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address from)
    {
        require(to == address(0) || ownerTokenId[to] == 0, "Receiver already has a handle");
        from = super._update(to, tokenId, auth);
        if (from != address(0)) {
            ownerTokenId[from] = 0;
            _clearLinkedWallets(tokenId);
        }
        if (to != address(0)) ownerTokenId[to] = tokenId;
    }

    // ─── INTERNAL ─────────────────────────────────────────────────────────────

    function _validateHandle(string calldata handle) internal pure {
        bytes memory b = bytes(handle);
        if (b.length < 3)  revert HandleTooShort();
        if (b.length > 20) revert HandleTooLong();
        for (uint i; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= 0x30 && c <= 0x39) ||
                      (c >= 0x41 && c <= 0x5A) ||
                      (c >= 0x61 && c <= 0x7A) ||
                      (c == 0x5F);
            if (!ok) revert InvalidCharacter(c);
        }
    }

    function _toLower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory lower = new bytes(b.length);
        for (uint i; i < b.length; i++) {
            bytes1 c = b[i];
            lower[i] = (c >= 0x41 && c <= 0x5A) ? bytes1(uint8(c) + 32) : c;
        }
        return string(lower);
    }
}
