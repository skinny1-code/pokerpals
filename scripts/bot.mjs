#!/usr/bin/env node
// Test bot — connects as a second player so you can test solo
// Usage: node scripts/bot.mjs [tableId]   (default: 9001)
import { WebSocket } from "ws";
import { ethers } from "ethers";

const TABLE_ID  = process.argv[2] || "9001";
const WS_URL    = process.env.NEXT_PUBLIC_WS_URL?.replace(/^https?/, m => m === "https" ? "wss" : "ws") || "ws://localhost:4000";

// Use ops wallet as the bot (has CHIPS from deploy)
const BOT_KEY   = process.env.OPS_WALLET_KEY || "0xc6e7796027e91aa8a8cc33bb241cb9a2f2de5de6f72a69092b4b848acf836381";
const wallet    = new ethers.Wallet(BOT_KEY);
const BOT_ADDR  = wallet.address;

console.log(`🤖 Bot wallet: ${BOT_ADDR}`);
console.log(`🔌 Connecting to ${WS_URL} as player 2 on table ${TABLE_ID}…`);

let state = null;

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => console.log("🟢 Connected"));

  ws.on("message", async (raw) => {
    const msg = JSON.parse(raw);

    switch (msg.type) {
      case "AUTH_CHALLENGE": {
        const sig = await wallet.signMessage(`PVP-AUTH:${msg.nonce}`);
        ws.send(JSON.stringify({ type: "AUTH", payload: { address: BOT_ADDR, signature: sig } }));
        break;
      }

      case "AUTH_OK":
        console.log("✅ Authenticated");
        ws.send(JSON.stringify({ type: "JOIN_TABLE", payload: { tableId: TABLE_ID } }));
        break;

      case "GAME_STATE": {
        state = msg.state;
        const me = state.players?.find(p => p.addr?.toLowerCase() === BOT_ADDR.toLowerCase());
        if (!me) break;

        // Only act on our turn
        if (state.activeAddr?.toLowerCase() !== BOT_ADDR.toLowerCase()) break;
        if (me.folded) break;

        // Simple strategy: always check/call, never raise
        const callAmt = Math.max(0, (state.maxBet || 0) - (me.bet || 0));
        if (callAmt === 0) {
          console.log("🤖 Check");
          ws.send(JSON.stringify({ type: "ACTION", payload: { action: "check", amount: 0 } }));
        } else {
          console.log(`🤖 Call ${callAmt}`);
          ws.send(JSON.stringify({ type: "ACTION", payload: { action: "call", amount: callAmt } }));
        }
        break;
      }

      case "HAND_OVER":
        console.log("🏆 Hand over. Winners:", msg.winners?.join(", ") || "?");
        break;

      case "ERROR":
        console.error("❌ Server error:", msg.error);
        break;
    }
  });

  ws.on("close", () => {
    console.log("🔴 Disconnected — reconnecting in 3s…");
    setTimeout(connect, 3000);
  });

  ws.on("error", e => console.error("WS error:", e.message));
}

connect();
