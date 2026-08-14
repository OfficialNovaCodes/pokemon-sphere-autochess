/* ==========================================================================
 * Practice bot — a headless second player. Joins the room, shops greedily
 * (chasing duplicates toward combines), equips items, readies up, and picks
 * items. Run alongside the server:  node bot.js [BotName]
 * ========================================================================== */

const { Client } = require("colyseus.js");

const name = process.argv[2] || "BotRival";
const urlArg = process.argv.find(a => a.startsWith("--url="));
const url = urlArg ? urlArg.slice(6) : (process.env.SERVER_URL || "ws://localhost:2567");

async function main() {
  const client = new Client(url);
  const ratingArg = process.argv.find(a => a.startsWith("--rating="));
  const rating = ratingArg ? parseInt(ratingArg.slice(9)) : 1000;
  const room = await client.joinOrCreate("autochess", { name, rating });
  console.log(`[bot] joined as ${name} (${room.sessionId}) rating ${rating}`);

  let view = null;
  let actedForRound = -1;

  const autoStart = process.argv.includes("--start");
  room.onMessage("lobby", (msg) => {
    if (autoStart && msg.canStart) setTimeout(() => room.send("start"), 800);
  });
  room.onMessage("match", (m) => console.log(`[bot] fighting ${m.enemyName} (seed ${m.seed}, ~${m.simT}s)`));

  room.onMessage("view", (msg) => {
    view = msg;
    const you = msg.you;
    if (!you || you.eliminated) return;

    if (msg.phase === "plan" && !you.ready) {
      // act once per round, then ready
      if (actedForRound !== msg.round) {
        actedForRound = msg.round;
        setTimeout(() => planAndReady(room, view), 400 + Math.random() * 600);
      }
    }
    if (msg.phase === "item" && you.pendingItems) {
      setTimeout(() => room.send("pick-item", { i: Math.floor(Math.random() * 3) }), 300);
    }
    if (msg.phase === "over") {
      const d = you.ratingDelta || 0;
      console.log(`[bot] game over — winner: ${msg.winnerName} | my rating: ${you.rating} (${d >= 0 ? "+" : ""}${d})`);
      setTimeout(() => process.exit(0), 1000);
    }
  });

  room.onLeave(() => { console.log("[bot] left room"); process.exit(0); });
}

function planAndReady(room, msg) {
  const you = msg.you;
  if (!you) return;
  // greedy shopping: prefer keys we already own, then cheapest
  let gold = you.gold;
  const owned = {};
  you.units.forEach(u => { owned[u.key] = (owned[u.key] || 0) + 1; });
  const buys = (you.shop || [])
    .map((k, i) => ({ k, i }))
    .filter(s => s.k)
    .sort((a, b) => ((owned[a.k] ? 0 : 1) - (owned[b.k] ? 0 : 1)));
  for (const s of buys) {
    if (gold >= 2 && you.units.length < 8) {
      room.send("buy", { slot: s.i });
      gold -= 2;  // rough; server validates the real cost
    }
  }
  // equip everything
  for (let i = 0; i < (you.items || []).length; i++) {
    const slot = you.units.findIndex(u => !u.item);
    if (slot >= 0) room.send("equip", { item: 0, unit: slot });
  }
  setTimeout(() => room.send("ready"), 500);
}

main().catch(e => { console.error("[bot] error:", e.message); process.exit(1); });
