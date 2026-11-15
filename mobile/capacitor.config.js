// Prototype-only remote client. Never use this as evidence of store approval.
// Server URL is HTTPS-pinned; the deployed site remains responsible for
// authorization, wallet signatures, chain selection, and gambling controls.
const url = process.env.POKERPALS_MOBILE_URL || 'https://pokervsplayer.xyz';
const parsed = new URL(url);
if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error('POKERPALS_MOBILE_URL must be a clean HTTPS origin');
}
if (!['pokervsplayer.xyz', 'www.pokervsplayer.xyz'].includes(parsed.hostname) &&
    process.env.POKERPALS_ALLOW_STAGING_HOST !== 'true') {
  throw new Error('Unapproved mobile host; set POKERPALS_ALLOW_STAGING_HOST=true only for controlled staging');
}
export default {
  appId: 'com.rawagon.pokerpals',
  appName: 'PokerPals',
  webDir: 'www',
  server: { url: parsed.origin, cleartext: false },
  android: { allowMixedContent: false },
};
