import { NextResponse } from 'next/server';

// Public, unauthenticated crash reporter. Everything here is attacker-supplied.
//
// Control characters are not the risk: console's object formatting renders them
// escaped (\x1B), so a terminal-spoofing payload cannot reach the terminal. The
// risk is volume — `url` was logged whole, and a route handler will happily
// accept a multi-megabyte body, so anyone could write megabytes per request
// into logs we pay to store. Every field is bounded before it is logged.
const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    console.error('[ClientError]', {
      timestamp: cap(body.timestamp, 40),
      type:      cap(body.type, 60),
      message:   cap(body.message, 200),
      ua:        cap(body.ua, 100),
      url:       cap(body.url, 300),
      stack:     cap(body.stack, 600),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
