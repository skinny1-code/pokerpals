// src/lib/appUrl.js
// Resolve the canonical site URL for link-preview metadata into a GUARANTEED
// valid absolute URL string. This must never throw: layout.jsx feeds the result
// into `new URL()` for `metadataBase`, which is evaluated when the metadata
// module loads — a malformed NEXT_PUBLIC_APP_URL there crashes the whole build
// (static pages) or every request (dynamic), taking the site down.
//
// Handles the real-world env values that broke it:
//   "https://pokervsplayer.xyz" -> unchanged
//   "pokervsplayer.xyz"         -> "https://pokervsplayer.xyz" (scheme prepended)
//   "www.pokervsplayer.xyz"     -> "https://www.pokervsplayer.xyz"
//   ""/undefined/garbage        -> "https://pokervsplayer.xyz" (safe fallback)

export const DEFAULT_APP_URL = 'https://pokervsplayer.xyz';

export function resolveAppUrl(raw = process.env.NEXT_PUBLIC_APP_URL) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  const withScheme = trimmed && !/^https?:\/\//i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed;
  try {
    return new URL(withScheme || DEFAULT_APP_URL).toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_APP_URL;
  }
}
