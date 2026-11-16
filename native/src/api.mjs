// No website/WebView. Calls the existing server's public, read-only lobby endpoint.
// URL inferred from Fly application name; override if the deployment uses a custom hostname.
export const GAME_API_URL = (process.env.EXPO_PUBLIC_GAME_API_URL || 'https://pokerpals-server.fly.dev').replace(/\/$/, '');
export function validateGameApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Game API must be an HTTPS origin');
  if (url.pathname !== '/') throw new Error('Game API must not include a path');
  return url.origin;
}
export async function loadTables(fetcher = fetch, base = GAME_API_URL) {
  const origin = validateGameApiUrl(base);
  const response = await fetcher(origin + '/tables', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Lobby HTTP ' + response.status);
  const data = await response.json();
  if (!data || !Array.isArray(data.tables)) throw new Error('Unexpected lobby response');
  return data.tables.map((t) => ({
    id: String(t.id), name: t.name || 'Table ' + t.id,
    seated: Number(t.seated) || 0, phase: String(t.phase || 'waiting'),
    config: t.config || {}, isFreeroll: !!t.isFreeroll,
  }));
}
