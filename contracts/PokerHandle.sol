// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IChipsTokenMint is IERC20 {
    function burn(uint256 amount) external;
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

    IChipsTokenMint public immutable chipsToken;
    IPokerEscrow    public immutable escrow;

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

    event HandleMinted(address indexed player, uint256 tokenId, string handle, uint256 burned);
    event TierCostsUpdated(uint256[4] costs);
    event TierBoundsUpdated(uint256[3] bounds);

    error HandleTooShort();
    error HandleTooLong();
    error InvalidCharacter(bytes1 c);
    error HandleAlreadyTaken(string handle);
    error AlreadyHasHandle(address player);
    error NotHumanVerified(address player);

    constructor(address _chipsToken, address _escrow) ERC721("PokerVsPlayer Handle", "HANDLE") Ownable(msg.sender) {
        chipsToken = IChipsTokenMint(_chipsToken);
        escrow = IPokerEscrow(_escrow);
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

    // ─── TOKEN URI (fully on-chain SVG with poker animal art) ─────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId <= totalMinted, "Not found");
        string memory handle    = _handles[tokenId];
        uint8         tier      = getTokenTier(tokenId);
        uint8         animal    = getAnimal(tokenId);

        bytes memory svg = _buildSVG(handle, tokenId, tier, animal);

        (string memory animalName,,,,) = _animalProps(animal);
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

    function _buildSVG(
        string memory handle,
        uint256 tokenId,
        uint8 tier,
        uint8 animal
    ) internal pure returns (bytes memory) {
        (
            string memory animalName,
            string memory accent,
            string memory dimAccent,
            string memory bg1,
            string memory bg2
        ) = _animalProps(animal);

        (, , , , string memory suit, string memory badge, string memory edition) = _tierProps(tier);

        bytes memory header = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<defs>',
              '<linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
                '<stop offset="0%" stop-color="', bg1, '"/>',
                '<stop offset="100%" stop-color="', bg2, '"/>',
              '</linearGradient>',
              '<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">',
                '<feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur"/>',
                '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>',
              '</filter>',
            '</defs>'
        );

        return abi.encodePacked(
            header,
            _svgBody(handle, tokenId, accent, dimAccent, badge, edition, suit, animalName)
        );
    }

    function _svgBody(
        string memory handle,
        uint256 tokenId,
        string memory accent,
        string memory dimAccent,
        string memory badge,
        string memory edition,
        string memory suit,
        string memory animalName
    ) internal pure returns (bytes memory) {
        bytes memory part1 = abi.encodePacked(
            '<rect width="400" height="400" rx="24" fill="url(#bg)"/>',
            '<rect x="3" y="3" width="394" height="394" rx="21" fill="none" stroke="', dimAccent, '" stroke-width="1.5"/>',
            // Ambient glow orb behind animal text
            '<circle cx="200" cy="158" r="108" fill="', accent, '" opacity="0.06"/>',
            '<circle cx="200" cy="158" r="72" fill="', accent, '" opacity="0.05"/>',
            // Top row: tier badge + token ID
            '<text x="16" y="28" font-family="monospace" font-size="9" font-weight="700" fill="', accent, '" letter-spacing="2">', badge, '</text>',
            '<text x="384" y="28" font-family="monospace" font-size="9" fill="', accent, '" text-anchor="end" opacity="0.5">#', tokenId.toString(), '</text>'
        );

        bytes memory part2 = abi.encodePacked(
            // Animal name — main focal point
            '<text x="200" y="170" font-family="monospace" font-size="64" font-weight="900" ',
              'fill="', accent, '" text-anchor="middle" dominant-baseline="middle" ',
              'filter="url(#glow)" letter-spacing="2">', animalName, '</text>',
            // Suit pip below animal
            '<text x="200" y="215" font-family="serif" font-size="22" fill="', accent, '" ',
              'text-anchor="middle" opacity="0.4">', suit, '</text>',
            // Handle username
            '<text x="200" y="254" font-family="monospace" font-size="22" font-weight="bold" ',
              'fill="#f0f4f8" text-anchor="middle" letter-spacing="1">', handle, '</text>',
            // Brand
            '<text x="200" y="276" font-family="monospace" font-size="9" fill="', accent, '" ',
              'text-anchor="middle" opacity="0.4" letter-spacing="3">POKERVSPLAYER</text>',
            // Divider
            '<line x1="80" y1="293" x2="320" y2="293" stroke="', dimAccent, '" stroke-width="1"/>',
            // Edition text
            '<text x="200" y="313" font-family="monospace" font-size="8" fill="', accent, '" ',
              'text-anchor="middle" opacity="0.38" letter-spacing="1">', edition, '</text>',
            '</svg>'
        );

        return abi.encodePacked(part1, part2);
    }

    /// @dev Returns (name, accent, dimAccent, bg1, bg2) for each of the 8 poker animals.
    ///      Animal is determined by keccak256(tokenId) % 8 — deterministic but appears random.
    function _animalProps(uint8 idx) internal pure returns (
        string memory name,
        string memory accent,
        string memory dimAccent,
        string memory bg1,
        string memory bg2
    ) {
        if (idx == 0) return ("BEAR",   "#c87032", "#c8703244", "#0e0804", "#1c1208");
        if (idx == 1) return ("WOLF",   "#8888c0", "#8888c044", "#08080f", "#10101e");
        if (idx == 2) return ("FOX",    "#e07030", "#e0703044", "#120905", "#1e1008");
        if (idx == 3) return ("SHARK",  "#209898", "#20989844", "#040c10", "#06161e");
        if (idx == 4) return ("EAGLE",  "#c8a020", "#c8a02044", "#0c0904", "#181406");
        if (idx == 5) return ("TIGER",  "#e84820", "#e8482044", "#100604", "#1e0c06");
        if (idx == 6) return ("RABBIT", "#d870a8", "#d870a844", "#100810", "#1e0c1e");
                      return ("BULL",   "#c83030", "#c8303044", "#100404", "#1e0808");
    }

    function _tierProps(uint8 art) internal pure returns (
        string memory bg1, string memory bg2,
        string memory accent, string memory dimAccent,
        string memory suit, string memory badge, string memory edition
    ) {
        if (art == 0) {
            bg1 = "#08041a"; bg2 = "#1a0830";
            accent = "#ffd700"; dimAccent = "#ffd70055";
            suit = unicode"♠"; badge = "GENESIS OG";
            edition = "EDITION 1 OF 10,000";
        } else if (art == 1) {
            bg1 = "#040c1a"; bg2 = "#061828";
            accent = "#7ec8e3"; dimAccent = "#7ec8e344";
            suit = unicode"♦"; badge = "EARLY BIRD";
            edition = "EDITION 1 OF 110,000";
        } else if (art == 2) {
            bg1 = "#050e05"; bg2 = "#0a1e0a";
            accent = "#c87941"; dimAccent = "#c8794144";
            suit = unicode"♥"; badge = "RARE";
            edition = "EDITION 1 OF 1,110,000";
        } else {
            bg1 = "#0c0c12"; bg2 = "#14141e";
            accent = "#6888a8"; dimAccent = "#6888a833";
            suit = unicode"♣"; badge = "STANDARD";
            edition = "UNLIMITED EDITION";
        }
    }

    function _tierName(uint8 art) internal pure returns (string memory) {
        if (art == 0) return "Genesis OG";
        if (art == 1) return "Early Bird";
        if (art == 2) return "Rare";
        return "Standard";
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

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
        if (from != address(0)) ownerTokenId[from] = 0;
        if (to   != address(0)) ownerTokenId[to]   = tokenId;
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

    function _toLower(string calldata s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory lower = new bytes(b.length);
        for (uint i; i < b.length; i++) {
            bytes1 c = b[i];
            lower[i] = (c >= 0x41 && c <= 0x5A) ? bytes1(uint8(c) + 32) : c;
        }
        return string(lower);
    }
}
