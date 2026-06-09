import { NextResponse } from 'next/server';

// Farcaster Mini App webhook — receives events like miniapp_added, notifications_enabled, etc.
// Extend this to send push notifications via Neynar or a custom relay.
export async function POST(req) {
  try {
    const body = await req.json();
    console.log('[MiniApp webhook]', body.event);
  } catch {}
  return NextResponse.json({ ok: true });
}
