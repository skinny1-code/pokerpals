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

/// @title PokerHandle — on-chain poker username NFT
///
/// Players burn CHIPS to mint a unique handle (e.g. "Shark_99").
/// The handle is stored on-chain and embedded in a fully on-chain SVG tokenURI.
/// Burning is permanent — no refunds, supply is deflationary.
///
/// Handle rules:
///   - 3–20 characters
///   - Alphanumeric + underscore only (a-z, A-Z, 0-9, _)
///   - Case-insensitive uniqueness (stored lowercase for collision check)
///   - One handle per wallet (but handles are transferable as NFTs)
contract PokerHandle is ERC721, Ownable {
    using SafeERC20 for IChipsTokenMint;
    using Strings for uint256;

    IChipsTokenMint public immutable chipsToken;

    uint256 public mintBurnCost = 500 * 10**18; // 500 CHIPS burned to mint

    uint256 public totalMinted;
    uint256 public totalBurned;

    mapping(uint256 => string) private _handles;        // tokenId => display handle
    mapping(string  => bool)   public  handleTaken;     // lowercase handle => taken
    mapping(address => uint256) public ownerTokenId;    // wallet => tokenId (0 = none)

    event HandleMinted(address indexed player, uint256 tokenId, string handle, uint256 burned);
    event MintCostUpdated(uint256 newCost);

    error HandleTooShort();
    error HandleTooLong();
    error InvalidCharacter(bytes1 c);
    error HandleAlreadyTaken(string handle);
    error AlreadyHasHandle(address player);

    constructor(address _chipsToken) ERC721("PokerVsPals Handle", "HANDLE") Ownable(msg.sender) {
        chipsToken = IChipsTokenMint(_chipsToken);
    }

    // ─── MINT ─────────────────────────────────────────────────────────────────

    /// @notice Burn 500 CHIPS to claim a unique on-chain poker handle.
    ///         Handle is 3–20 chars, alphanumeric + underscore, case-insensitive unique.
    function mintHandle(string calldata handle) external {
        if (ownerTokenId[msg.sender] != 0) revert AlreadyHasHandle(msg.sender);

        _validateHandle(handle);

        string memory lower = _toLower(handle);
        if (handleTaken[lower]) revert HandleAlreadyTaken(handle);
        handleTaken[lower] = true;

        // Burn CHIPS permanently — no refund, deflationary
        chipsToken.safeTransferFrom(msg.sender, address(this), mintBurnCost);
        chipsToken.burn(mintBurnCost);
        totalBurned += mintBurnCost;

        uint256 tokenId = ++totalMinted;
        _handles[tokenId]        = handle;
        ownerTokenId[msg.sender] = tokenId;

        _safeMint(msg.sender, tokenId);
        emit HandleMinted(msg.sender, tokenId, handle, mintBurnCost);
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    function getHandle(uint256 tokenId) external view returns (string memory) {
        require(tokenId > 0 && tokenId <= totalMinted, "Not found");
        return _handles[tokenId];
    }

    function getHandleByAddress(address player) external view returns (string memory) {
        uint256 id = ownerTokenId[player];
        if (id == 0) return "";
        return _handles[id];
    }

    /// @notice Fully on-chain SVG tokenURI — no IPFS dependency.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId <= totalMinted, "Not found");
        string memory handle = _handles[tokenId];

        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '<stop offset="0%" style="stop-color:#0f172a"/><stop offset="100%" style="stop-color:#1e3a5f"/>',
            '</linearGradient></defs>',
            '<rect width="400" height="400" rx="24" fill="url(#bg)"/>',
            '<text x="200" y="160" font-family="monospace" font-size="48" fill="#f59e0b" text-anchor="middle">&#9824;</text>',
            '<text x="200" y="230" font-family="monospace" font-size="28" font-weight="bold" fill="#f1f5f9" text-anchor="middle">',
            handle,
            '</text>',
            '<text x="200" y="270" font-family="monospace" font-size="14" fill="#64748b" text-anchor="middle">PokerVsPals Handle</text>',
            '<text x="200" y="360" font-family="monospace" font-size="12" fill="#334155" text-anchor="middle">#',
            tokenId.toString(),
            '</text>',
            '</svg>'
        ));

        string memory json = Base64.encode(bytes(string(abi.encodePacked(
            '{"name":"@', handle, '",',
            '"description":"PokerVsPals on-chain poker handle. Burned 500 CHIPS to mint.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[{"trait_type":"Handle","value":"', handle, '"},',
            '{"trait_type":"Token ID","value":"', tokenId.toString(), '"}]}'
        ))));

        return string(abi.encodePacked("data:application/json;base64,", json));
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    function setMintBurnCost(uint256 cost) external onlyOwner {
        mintBurnCost = cost;
        emit MintCostUpdated(cost);
    }

    /// @notice Allows owner to reserve a handle (e.g. for brand protection). No CHIPS burned.
    function reserveHandle(string calldata handle, address recipient) external onlyOwner {
        _validateHandle(handle);
        string memory lower = _toLower(handle);
        require(!handleTaken[lower], "Taken");
        require(ownerTokenId[recipient] == 0, "Already has handle");
        handleTaken[lower] = true;

        uint256 tokenId = ++totalMinted;
        _handles[tokenId]         = handle;
        ownerTokenId[recipient]   = tokenId;
        _safeMint(recipient, tokenId);
    }

    // ─── ERC-721 TRANSFER HOOK ────────────────────────────────────────────────

    /// @dev Keep ownerTokenId mapping in sync on transfer.
    function _update(address to, uint256 tokenId, address auth)
        internal override returns (address from)
    {
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
            bool ok = (c >= 0x30 && c <= 0x39) || // 0-9
                      (c >= 0x41 && c <= 0x5A) || // A-Z
                      (c >= 0x61 && c <= 0x7A) || // a-z
                      (c == 0x5F);                 // _
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
