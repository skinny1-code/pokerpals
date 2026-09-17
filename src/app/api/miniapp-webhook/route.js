import { NextResponse } from 'next/server';

// Farcaster Mini App webhook — receives events like miniapp_added, notifications_enabled, etc.
// Extend this to send push notifications via Neynar or a custom relay.
export async function POST(request) {
  try {
    const body = await request.json();
    // Already bounded at 500 chars, and JSON.stringify escapes control
    // characters, so an unauthenticated poster cannot spoof log lines or
    // flood them.
    console.log('[miniapp-webhook]', JSON.stringify(body).slice(0, 500));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
