// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";

/// @title HandleRenderer — on-chain SVG art for PokerHandle NFTs
/// @notice Crest-style emblem: obsidian card, champagne double border with
///         playing-card corner spades, a gold-ringed medallion holding the
///         token's poker-animal silhouette, and the handle beneath. Deployed
///         separately from PokerHandle so the art can be upgraded by pointing
///         PokerHandle.setRenderer at a new renderer — no re-minting.
contract HandleRenderer {
    using Strings for uint256;

    function animalName(uint8 idx) public pure returns (string memory) {
        if (idx == 0) return "BEAR";
        if (idx == 1) return "WOLF";
        if (idx == 2) return "FOX";
        if (idx == 3) return "SHARK";
        if (idx == 4) return "EAGLE";
        if (idx == 5) return "TIGER";
        if (idx == 6) return "RABBIT";
        return "BULL";
    }

    function _accent(uint8 idx) internal pure returns (string memory) {
        if (idx == 0) return "#c87032";
        if (idx == 1) return "#8888c0";
        if (idx == 2) return "#e07030";
        if (idx == 3) return "#209898";
        if (idx == 4) return "#c8a020";
        if (idx == 5) return "#e84820";
        if (idx == 6) return "#d870a8";
        return "#c83030";
    }

    /// @dev Animal head silhouettes in a 100x100 viewBox. Interior features
    ///      (eyes, nose, stripes) are separate subpaths rendered as holes via
    ///      fill-rule=evenodd.
    function _animalPath(uint8 idx) internal pure returns (string memory) {
        if (idx == 0) return "M32 26 C26 14 38 10 42 18 C46 15 54 15 58 18 C62 10 74 14 68 26 C78 32 84 42 84 54 C84 74 70 86 50 86 C30 86 16 74 16 54 C16 42 22 32 32 26 Z M36 46 A4 5 0 1 1 35.9 46 Z M64 46 A4 5 0 1 1 63.9 46 Z M50 58 L44 65 L56 65 Z M46 70 C48 73 52 73 54 70 L50 68 Z";
        if (idx == 1) return "M20 8 L36 30 L50 26 L64 30 L80 8 L74 40 C82 48 84 56 82 64 L66 80 L58 92 L50 86 L42 92 L34 80 L18 64 C16 56 18 48 26 40 Z M36 50 L44 54 L36 58 Z M64 50 L56 54 L64 58 Z M50 62 L44 70 L50 76 L56 70 Z";
        if (idx == 2) return "M14 10 L38 26 L62 26 L86 10 L82 44 C86 52 84 60 78 66 L58 84 L50 92 L42 84 L22 66 C16 60 14 52 18 44 Z M34 46 L42 50 L34 54 Z M66 46 L58 50 L66 54 Z M50 66 L44 72 L50 78 L56 72 Z";
        if (idx == 3) return "M4 52 C16 40 34 32 52 33 C55 20 66 14 76 19 L69 34 C79 37 88 44 94 50 L86 53 L92 62 L80 58 C82 64 78 70 72 70 L68 62 C56 70 40 72 26 66 L33 58 C21 58 11 56 4 52 Z M70 43 A3 3 0 1 1 69.9 43 Z M10 52 L26 54 L12 57 Z";
        if (idx == 4) return "M18 42 C18 22 34 10 52 10 C70 10 82 22 82 36 L94 42 C90 46 86 47 80 47 C84 51 83 56 78 57 L72 55 C72 66 66 76 56 80 L58 88 L48 82 L46 90 L38 80 L40 74 C26 70 18 58 18 42 Z M60 30 A4 4 0 1 1 59.9 30 Z";
        if (idx == 5) return "M30 20 C24 8 36 6 40 14 C46 11 54 11 60 14 C64 6 76 8 70 20 C80 28 84 38 84 48 C84 56 80 62 74 66 C70 78 62 86 50 86 C38 86 30 78 26 66 C20 62 16 56 16 48 C16 38 20 28 30 20 Z M34 44 L44 48 L34 52 Z M66 44 L56 48 L66 52 Z M50 58 L44 64 L50 70 L56 64 Z M46 22 L48 32 L44 32 Z M54 22 L56 32 L52 32 Z M50 20 L51 30 L49 30 Z M24 40 L34 42 L25 46 Z M76 40 L66 42 L75 46 Z M26 54 L35 55 L27 58 Z M74 54 L65 55 L73 58 Z";
        if (idx == 6) return "M30 4 C22 8 24 26 32 40 C24 46 20 54 20 62 C20 78 33 88 50 88 C67 88 80 78 80 62 C80 54 76 46 68 40 C76 26 78 8 70 4 C62 0 56 16 54 34 C51 33 49 33 46 34 C44 16 38 0 30 4 Z M38 56 A4 6 0 1 1 37.9 56 Z M62 56 A4 6 0 1 1 61.9 56 Z M50 66 L45 72 L55 72 Z";
        return "M4 24 C2 8 18 2 30 10 C24 16 22 24 25 32 C32 24 41 20 50 20 C59 20 68 24 75 32 C78 24 76 16 70 10 C82 2 98 8 96 24 C94 36 85 42 74 44 C78 50 80 55 80 61 C80 77 68 88 50 88 C32 88 20 77 20 61 C20 55 22 50 26 44 C15 42 6 36 4 24 Z M38 52 A4 5 0 1 1 37.9 52 Z M62 52 A4 5 0 1 1 61.9 52 Z M43 72 A3 3 0 1 1 42.9 72 Z M57 72 A3 3 0 1 1 56.9 72 Z";
    }

    function _badge(uint8 tier) internal pure returns (string memory) {
        if (tier == 0) return "GENESIS OG";
        if (tier == 1) return "EARLY BIRD";
        if (tier == 2) return "RARE";
        return "STANDARD";
    }

    function render(
        string memory handle,
        uint256 tokenId,
        uint8 tier,
        uint8 animal
    ) external pure returns (bytes memory) {
        string memory accent = _accent(animal);
        return abi.encodePacked(
            _defs(accent),
            _frame(tier),
            _medallion(accent, animal),
            _nameplate(handle, tokenId, accent, animal)
        );
    }

    function _defs(string memory accent) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">',
            '<defs>',
              '<linearGradient id="champ" x1="0" y1="0" x2="1" y2="1">',
                '<stop offset="0%" stop-color="#f0e6cf"/><stop offset="45%" stop-color="#d9c08a"/><stop offset="100%" stop-color="#9c854f"/>',
              '</linearGradient>',
              '<radialGradient id="vig" cx="50%" cy="42%" r="75%">',
                '<stop offset="0%" stop-color="#17171b"/><stop offset="100%" stop-color="#0a0a0c"/>',
              '</radialGradient>',
              '<radialGradient id="halo" cx="50%" cy="50%" r="50%">',
                '<stop offset="0%" stop-color="', accent, '" stop-opacity="0.28"/>',
                '<stop offset="100%" stop-color="', accent, '" stop-opacity="0"/>',
              '</radialGradient>',
            '</defs>'
        );
    }

    function _frame(uint8 tier) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<rect width="400" height="400" rx="24" fill="url(#vig)"/>',
            '<rect x="6" y="6" width="388" height="388" rx="19" fill="none" stroke="url(#champ)" stroke-width="2"/>',
            '<rect x="13" y="13" width="374" height="374" rx="14" fill="none" stroke="#d9c08a" stroke-width="0.6" opacity="0.35"/>',
            '<text x="26" y="46" font-family="Georgia,serif" font-size="22" fill="url(#champ)">', unicode"♠", '</text>',
            '<text x="374" y="376" font-family="Georgia,serif" font-size="22" fill="url(#champ)" text-anchor="end" transform="rotate(180,374,369)">', unicode"♠", '</text>',
            '<text x="200" y="42" font-family="monospace" font-size="10" font-weight="700" fill="#d9c08a" text-anchor="middle" letter-spacing="4" opacity="0.9">', _badge(tier), '</text>'
        );
    }

    function _medallion(string memory accent, uint8 animal) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<circle cx="200" cy="172" r="118" fill="url(#halo)"/>',
            '<circle cx="200" cy="172" r="96" fill="#101013"/>',
            '<circle cx="200" cy="172" r="96" fill="none" stroke="url(#champ)" stroke-width="2.5"/>',
            '<circle cx="200" cy="172" r="88" fill="none" stroke="', accent, '" stroke-width="1" opacity="0.5"/>',
            '<circle cx="200" cy="172" r="103" fill="none" stroke="#d9c08a" stroke-width="0.6" opacity="0.3" stroke-dasharray="2 4"/>',
            '<g transform="translate(136,108) scale(1.28)">',
              '<path d="', _animalPath(animal), '" fill="url(#champ)" fill-rule="evenodd" stroke="', accent, '" stroke-width="0.8" stroke-opacity="0.6"/>',
            '</g>'
        );
    }

    function _nameplate(
        string memory handle,
        uint256 tokenId,
        string memory accent,
        uint8 animal
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            '<text x="200" y="308" font-family="monospace" font-size="13" fill="', accent, '" text-anchor="middle" letter-spacing="6" opacity="0.85">', animalName(animal), '</text>',
            '<line x1="118" y1="322" x2="172" y2="322" stroke="#d9c08a" stroke-width="0.8" opacity="0.4"/>',
            '<text x="200" y="326" font-family="Georgia,serif" font-size="11" fill="#d9c08a" text-anchor="middle">', unicode"♠", '</text>',
            '<line x1="228" y1="322" x2="282" y2="322" stroke="#d9c08a" stroke-width="0.8" opacity="0.4"/>',
            '<text x="200" y="356" font-family="monospace" font-size="24" font-weight="700" fill="url(#champ)" text-anchor="middle" letter-spacing="2">@', handle, '</text>',
            '<text x="200" y="380" font-family="monospace" font-size="8" fill="#a29c8e" text-anchor="middle" letter-spacing="3">ALL IN ', unicode"·", ' #', tokenId.toString(), '</text>',
            '</svg>'
        );
    }
}
