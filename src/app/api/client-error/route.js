import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const { message, stack, type, url, ua, timestamp } = body;
    console.error('[ClientError]', {
      timestamp,
      type,
      message: message?.slice(0, 200),
      ua: ua?.slice(0, 100),
      url,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
