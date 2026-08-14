/* ==========================================================================
 * Pokemon Sphere AutoChess — Colyseus multiplayer server
 *
 * Authoritative auto-chess room: server owns every player's gold/shop/team,
 * pairs players each round, and runs the deterministic sphere sim headlessly
 * for results. Clients replay the same Battle(seed) locally for the visuals —
 * engine.js/data.js are shared verbatim between browser and Node.
 * ========================================================================== */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const { Server, Room } = require("colyseus");
const db = require("./db");

/* ---- load the shared sim (data.js + engine.js) into this process ---- */
const shared = ["data.js", "engine.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"))
  .join("\n;\n") +
  "\n;globalThis.__SIM = { UNITS, MOVES, ITEMS, ECON, SHOP_ODDS, ENEMY_PLAN, TRAINERS, SYNERGY, SIM, EEVEELUTIONS, Battle, mulberry32, computeSynergies, typeMul, craftFor, BASIC_ITEMS };";
vm.runInThisContext(shared, { filename: "shared-sim.js" });
const S = globalThis.__SIM;
const POOL = Object.keys(S.UNITS).filter(k => S.UNITS[k].pool !== false);

const env = (k, d) => (process.env[k] ? parseInt(process.env[k]) : d);
const PLAN_SECONDS = env("PLAN_SECONDS", 40);
const RESULT_SECONDS = env("RESULT_SECONDS", 8);
const ITEM_SECONDS = env("ITEM_SECONDS", 14);
const BATTLE_MAX_SECONDS = env("BATTLE_SECONDS", 22);

class AutoChessRoom extends Room {
  maxClients = 8;

  onCreate() {
    this.setSeatReservationTime(20);
    this.phase = "lobby";
    this.round = 0;
    this.players = new Map();     // sessionId -> P
    this.rngState = (Math.random() * 1e9) | 0;
    this.rng = S.mulberry32(this.rngState);
    this.phaseTimer = null;

    this.onMessage("join-info", (client, msg) => {
      const p = this.players.get(client.sessionId);
      if (p && msg && typeof msg.name === "string") {
        p.name = msg.name.slice(0, 16) || p.name;
        this.broadcastLobby();
      }
    });
    this.onMessage("start", () => {
      if (this.phase === "lobby" && this.alive().length >= 2) this.startRound(1);
    });
    this.onMessage("again", () => {
      if (this.phase === "over") this.resetGame();
    });
    this.onMessage("buy", (c, m) => this.act(c, p => this.buy(p, m.slot)));
    this.onMessage("sell", (c, m) => this.act(c, p => this.sell(p, m.idx)));
    this.onMessage("reroll", (c) => this.act(c, p => this.reroll(p)));
    this.onMessage("equip", (c, m) => this.act(c, p => this.equip(p, m.item, m.unit)));
    this.onMessage("reorder", (c, m) => this.act(c, p => this.reorder(p, m.from, m.to)));
    this.onMessage("position", (c, m) => this.act(c, p => this.setPos(p, m.idx, m.px, m.py)));
    this.onMessage("ready", (c) => {
      const p = this.players.get(c.sessionId);
      if (p && this.phase === "plan" && !p.eliminated) {
        p.ready = true;
        this.pushViews();
        if (this.alive().every(x => x.ready || !x.connected)) this.startBattle();
      }
    });
    this.onMessage("pick-item", (c, m) => {
      const p = this.players.get(c.sessionId);
      if (p && this.phase === "item" && p.pendingItems) {
        p.itemsInv.push(p.pendingItems[Math.max(0, Math.min(2, m.i | 0))]);
        p.pendingItems = null;
        this.pushViews();
        if (this.alive().every(x => !x.pendingItems)) this.afterItems();
      }
    });
  }

  /* ---------------- lifecycle ---------------- */
  async onJoin(client, options) {
    const name = (options && options.name ? String(options.name) : "Trainer").slice(0, 16);
    // DB is the authority on ratings; the client's copy is just a hint
    let rating = Math.max(100, Math.min(3000, parseInt(options && options.rating) || 1000));
    try {
      const dbRating = await db.getRating(name);
      if (dbRating != null) rating = dbRating;
    } catch (e) { /* db unavailable — keep hint */ }
    this.players.set(client.sessionId, {
      id: client.sessionId, client, name, rating, ratingDelta: 0,
      gold: S.ECON.startGold, hp: S.ECON.startHP, streak: 0,
      units: [], itemsInv: [], shop: [], pity: 0,
      ready: false, eliminated: false, connected: true, spectator: false,
      pendingItems: null, lastResult: null,
    });
    if (this.phase !== "lobby") {
      // late joiner becomes spectator (no Elo stakes)
      this.players.get(client.sessionId).eliminated = true;
      this.players.get(client.sessionId).spectator = true;
      this.players.get(client.sessionId).hp = 0;
    }
    this.broadcastLobby();
    this.pushViews();
  }

  /* pairwise Elo by final placement (zero-sum, K scaled by lobby size) */
  applyElo() {
    const ranked = [...this.players.values()]
      .filter(p => !p.spectator)
      .sort((a, b) => (a.placement || 99) - (b.placement || 99));
    if (ranked.length < 2) return;
    const K = 32 / (ranked.length - 1);
    const deltas = new Map(ranked.map(p => [p, 0]));
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const a = ranked[i], b = ranked[j];   // a placed above b
        const expected = 1 / (1 + Math.pow(10, (b.rating - a.rating) / 400));
        const d = K * (1 - expected);
        deltas.set(a, deltas.get(a) + d);
        deltas.set(b, deltas.get(b) - d);
      }
    }
    for (const [p, d] of deltas) {
      p.ratingDelta = Math.round(d);
      p.rating = Math.max(100, p.rating + p.ratingDelta);
      db.saveResult(p.name, p.rating, p.placement === 1).catch(() => {});
    }
  }

  async onLeave(client, consented) {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    p.connected = false;
    if (this.phase === "lobby") {
      this.players.delete(client.sessionId);
      this.broadcastLobby();
      return;
    }
    this.broadcastLobby();
    // don't stall the round on a disconnected player...
    if (this.phase === "plan" && this.alive().every(x => x.ready || !x.connected)) this.startBattle();
    if (this.phase === "item" && this.alive().every(x => !x.pendingItems || !x.connected)) {
      this.alive().forEach(x => { if (x.pendingItems) { x.itemsInv.push(x.pendingItems[0]); x.pendingItems = null; } });
      this.afterItems();
    }
    // ...but give unintentional drops a 60s window to reconnect;
    // their team keeps auto-fighting in the meantime
    if (!consented && !p.eliminated) {
      try {
        const newClient = await this.allowReconnection(client, 60);
        p.client = newClient;
        p.connected = true;
        this.broadcastLobby();
        this.pushViews();
        return;
      } catch (e) { /* reconnection window expired */ }
    }
    this.checkEnd();
  }

  resetGame() {
    this.clearTimer();
    this.phase = "lobby";
    this.round = 0;
    this.winnerName = null;
    this.matches = [];
    for (const [id, p] of [...this.players.entries()]) {
      if (!p.connected) { this.players.delete(id); continue; }
      Object.assign(p, {
        gold: S.ECON.startGold, hp: S.ECON.startHP, streak: 0,
        units: [], itemsInv: [], shop: [], pity: 0,
        ready: false, eliminated: false, spectator: false, pendingItems: null,
        lastResult: null, placement: null, ratingDelta: 0,
      });
    }
    this.broadcastLobby();
    this.pushViews();
  }

  alive() { return [...this.players.values()].filter(p => !p.eliminated); }

  act(client, fn) {
    const p = this.players.get(client.sessionId);
    if (!p || this.phase !== "plan" || p.eliminated || p.ready) return;
    fn(p);
    this.pushViews();
  }

  /* ---------------- economy (mirrors the singleplayer Game class) -------- */
  rollShop(p) {
    const odds = S.SHOP_ODDS[Math.min(this.round - 1, S.SHOP_ODDS.length - 1)];
    p.shop = [];
    for (let i = 0; i < S.ECON.shopSlots; i++) {
      const roll = this.rng() * 100;
      let acc = 0, tier = 1;
      for (let t = 0; t < 5; t++) { acc += odds[t]; if (roll < acc) { tier = t + 1; break; } }
      const choices = POOL.filter(k => S.UNITS[k].cost === tier);
      p.shop.push(choices[Math.floor(this.rng() * choices.length)]);
    }
    const counts = {};
    p.units.forEach(u => { if (u.star === 1) counts[u.key] = (counts[u.key] || 0) + 1; });
    const needed = Object.keys(counts).filter(k => counts[k] === 2 && POOL.includes(k));
    if (needed.length) {
      if (p.shop.some(k => needed.includes(k))) p.pity = 0;
      else if (++p.pity >= 2) {
        p.shop[Math.floor(this.rng() * p.shop.length)] = needed[Math.floor(this.rng() * needed.length)];
        p.pity = 0;
      }
    } else p.pity = 0;
  }

  rerollCost(p) { return p.streak <= -2 ? 1 : S.ECON.rerollCost; }

  reroll(p) {
    if (p.gold < this.rerollCost(p)) return;
    p.gold -= this.rerollCost(p);
    this.rollShop(p);
  }

  buy(p, slot) {
    const key = p.shop[slot];
    if (!key) return;
    const cost = S.UNITS[key].cost;
    if (p.gold < cost || p.units.length >= S.ECON.benchCap) return;
    p.gold -= cost;
    p.shop[slot] = null;
    p.units.push({ key, star: 1, item: null, sellValue: cost });
    this.tryCombine(p);
  }

  sell(p, idx) {
    if (!p.units[idx]) return;
    const u = p.units.splice(idx, 1)[0];
    p.gold += u.sellValue;
    if (u.item) p.itemsInv.push(u.item);
  }

  equip(p, itemIdx, unitIdx) {
    const it = p.itemsInv[itemIdx], u = p.units[unitIdx];
    if (!it || !u) return;
    if (u.item) {
      const crafted = S.craftFor(it, u.item);
      if (!crafted) return;
      u.item = crafted;
      p.itemsInv.splice(itemIdx, 1);
      return;
    }
    u.item = it;
    p.itemsInv.splice(itemIdx, 1);
  }

  reorder(p, from, to) {
    if (!p.units[from] || from === to) return;
    const u = p.units.splice(from, 1)[0];
    p.units.splice(Math.max(0, Math.min(p.units.length, to)), 0, u);
  }

  setPos(p, idx, px, py) {
    const u = p.units[idx | 0];
    if (!u || typeof px !== "number" || typeof py !== "number") return;
    u.px = Math.max(0.05, Math.min(0.46, px));
    u.py = Math.max(0.08, Math.min(0.92, py));
  }

  tryCombine(p) {
    let changed = true;
    while (changed) {
      changed = false;
      const counts = {};
      p.units.forEach((u, i) => {
        const k = u.key + "|" + u.star;
        (counts[k] = counts[k] || []).push(i);
      });
      for (const k in counts) {
        if (counts[k].length >= 3) {
          const idxs = counts[k].slice(0, 3);
          const [key, star] = [p.units[idxs[0]].key, p.units[idxs[0]].star];
          const spec = S.UNITS[key];
          const merged = idxs.map(i => p.units[i]);
          const item = (merged.find(u => u.item) || {}).item || null;
          merged.filter(u => u.item).slice(1).forEach(u => p.itemsInv.push(u.item));
          const sellValue = merged.reduce((s, u) => s + u.sellValue, 0);
          idxs.sort((a, b) => b - a).forEach(i => p.units.splice(i, 1));
          let result;
          if (spec.evolvesTo && star === 1) {
            let target = spec.evolvesTo;
            if (target === "@eeveelution") target = S.EEVEELUTIONS[Math.floor(this.rng() * S.EEVEELUTIONS.length)];
            result = { key: target, star: 1, item, sellValue, evolved: spec.name + "→" + S.UNITS[target].name };
          } else {
            result = { key, star: star + 1, item, sellValue, evolved: spec.name + "→★" + (star + 1) };
          }
          p.units.unshift(result);
          changed = true;
          break;
        }
      }
    }
  }

  teamCap() { return S.ECON.teamCap(this.round); }
  fighting(p) {
    return p.units.slice(0, this.teamCap())
      .map(u => ({ key: u.key, star: u.star, item: u.item, px: u.px, py: u.py }));
  }

  /* ---------------- round flow ---------------- */
  clearTimer() { if (this.phaseTimer) { this.phaseTimer.clear(); this.phaseTimer = null; } }

  startRound(n) {
    this.clearTimer();
    this.round = n;
    this.phase = "plan";
    this.phaseEndsAt = Date.now() + PLAN_SECONDS * 1000;
    for (const p of this.alive()) {
      p.ready = false;
      p.lastResult = null;
      this.rollShop(p);
    }
    this.pushViews();
    this.phaseTimer = this.clock.setTimeout(() => this.startBattle(), PLAN_SECONDS * 1000);
  }

  startBattle() {
    if (this.phase !== "plan") return;
    this.clearTimer();
    this.phase = "battle";
    this.phaseEndsAt = Date.now() + BATTLE_MAX_SECONDS * 1000;

    // pair alive players; odd one out fights a ghost copy of a random team
    const pool = this.alive().filter(p => true);
    const order = [...pool];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.matches = [];
    for (let i = 0; i + 1 < order.length; i += 2) {
      this.matches.push({ a: order[i], b: order[i + 1], ghost: false });
    }
    if (order.length % 2 === 1) {
      const solo = order[order.length - 1];
      const donors = pool.filter(p => p !== solo);
      const donor = donors[Math.floor(this.rng() * donors.length)];
      this.matches.push({ a: solo, b: donor, ghost: true });
    }

    for (const m of this.matches) {
      const seed = (this.rng() * 0xffffffff) >>> 0;
      const teamA = this.fighting(m.a), teamB = this.fighting(m.b);
      const battle = new S.Battle(teamA, teamB, seed);
      let steps = 0;
      while (!battle.over && steps++ < 60 * (S.SIM.timeout + 2)) battle.step(S.SIM.dt);
      m.seed = seed;
      m.teamA = teamA; m.teamB = teamB;
      m.winner = battle.winner;
      m.simT = Math.round(battle.t * 10) / 10;
      m.survivors = battle.winner === "draw" ? 0 :
        battle.living(battle.winner === 0 ? 0 : 1).length;
    }
    // matchup message to both sides (each sees themself as team 0)
    for (const m of this.matches) {
      if (m.a.connected) m.a.client.send("match", { round: this.round, enemyName: m.b.name + (m.ghost ? " (ghost)" : ""), youAre: 0, teamA: m.teamA, teamB: m.teamB, seed: m.seed, simT: m.simT });
      if (!m.ghost && m.b.connected) m.b.client.send("match", { round: this.round, enemyName: m.a.name, youAre: 1, teamA: m.teamA, teamB: m.teamB, seed: m.seed, simT: m.simT });
    }
    // spectators (eliminated players) get every matchup and can watch live
    const specs = this.matches.map(m => ({
      aName: m.a.name, bName: m.b.name + (m.ghost ? " (ghost)" : ""),
      teamA: m.teamA, teamB: m.teamB, seed: m.seed, simT: m.simT,
    }));
    for (const p of this.players.values()) {
      if (p.connected && p.eliminated) {
        p.client.send("spectate-match", { round: this.round, matches: specs });
      }
    }
    this.pushViews();
    this.phaseTimer = this.clock.setTimeout(() => this.finishBattles(), BATTLE_MAX_SECONDS * 1000);
  }

  finishBattles() {
    if (this.phase !== "battle") return;
    this.clearTimer();

    for (const m of this.matches) {
      const applyResult = (p, won, draw, survivors) => {
        if (won) p.streak = p.streak >= 0 ? p.streak + 1 : 1;
        else if (!draw) p.streak = p.streak <= 0 ? p.streak - 1 : -1;
        const lines = [];
        let income = S.ECON.baseIncome;
        lines.push(`Base income +${S.ECON.baseIncome}`);
        const interest = Math.min(S.ECON.interestCap, Math.floor(p.gold / S.ECON.interestPer));
        if (interest) { income += interest; lines.push(`Interest +${interest}`); }
        const sAbs = Math.min(Math.abs(p.streak), S.ECON.streakBonus.length - 1);
        const sBonus = S.ECON.streakBonus[sAbs];
        if (sBonus) { income += sBonus; lines.push(`Streak (${Math.abs(p.streak)}) +${sBonus}`); }
        if (won) { income += S.ECON.winBonus; lines.push(`Win bonus +${S.ECON.winBonus}`); }
        p.gold += income;
        let dmgTaken = 0;
        if (!won && !draw) {
          dmgTaken = S.ECON.lossDamage(this.round, survivors);
          p.hp -= dmgTaken;
        }
        p.lastResult = { won, draw, income, lines, dmgTaken };
        if (p.hp <= 0 && !p.eliminated) {
          p.eliminated = true;
          p.placement = this.alive().length + 1;
        }
      };
      const draw = m.winner === "draw";
      applyResult(m.a, m.winner === 0, draw, m.survivors);
      if (!m.ghost) applyResult(m.b, m.winner === 1, draw, m.survivors);
    }

    if (this.checkEnd()) return;

    // item choice after the configured rounds
    if (S.ECON.itemRounds.includes(this.round)) {
      this.phase = "item";
      this.phaseEndsAt = Date.now() + ITEM_SECONDS * 1000;
      for (const p of this.alive()) {
        const picks = [];
        while (picks.length < 3) {
          const k = S.BASIC_ITEMS[Math.floor(this.rng() * S.BASIC_ITEMS.length)];
          if (!picks.includes(k)) picks.push(k);
        }
        p.pendingItems = picks;
      }
      this.pushViews();
      this.phaseTimer = this.clock.setTimeout(() => {
        this.alive().forEach(p => { if (p.pendingItems) { p.itemsInv.push(p.pendingItems[0]); p.pendingItems = null; } });
        this.afterItems();
      }, ITEM_SECONDS * 1000);
    } else {
      this.phase = "result";
      this.phaseEndsAt = Date.now() + RESULT_SECONDS * 1000;
      this.pushViews();
      this.phaseTimer = this.clock.setTimeout(() => this.startRound(this.round + 1), RESULT_SECONDS * 1000);
    }
  }

  afterItems() {
    if (this.phase !== "item") return;
    this.clearTimer();
    this.phase = "result";
    this.phaseEndsAt = Date.now() + RESULT_SECONDS * 1000;
    this.pushViews();
    this.phaseTimer = this.clock.setTimeout(() => this.startRound(this.round + 1), RESULT_SECONDS * 1000);
  }

  checkEnd() {
    const alive = this.alive();
    if (this.phase !== "lobby" && this.phase !== "over" && alive.length <= 1) {
      this.clearTimer();
      this.phase = "over";
      this.winnerName = alive.length ? alive[0].name : "nobody";
      if (alive.length) alive[0].placement = 1;
      this.applyElo();
      this.pushViews();
      return true;
    }
    return false;
  }

  /* ---------------- state views ---------------- */
  broadcastLobby() {
    this.broadcast("lobby", {
      phase: this.phase,
      players: [...this.players.values()].map(p => ({ name: p.name, rating: p.rating, connected: p.connected, eliminated: p.eliminated })),
      canStart: this.alive().length >= 2,
    });
  }

  pushViews() {
    const roster = [...this.players.values()].map(p => ({
      name: p.name, hp: Math.max(0, p.hp), streak: p.streak, rating: p.rating,
      units: p.units.length, eliminated: p.eliminated, connected: p.connected,
      placement: p.placement || null,
    }));
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      p.client.send("view", {
        phase: this.phase,
        round: this.round,
        endsAt: this.phaseEndsAt || null,
        winnerName: this.winnerName || null,
        roster,
        you: {
          name: p.name, gold: p.gold, hp: Math.max(0, p.hp), streak: p.streak,
          rating: p.rating, ratingDelta: p.ratingDelta,
          units: p.units.map(u => ({ key: u.key, star: u.star, item: u.item, sellValue: u.sellValue, px: u.px, py: u.py })),
          shop: p.shop, items: p.itemsInv,
          rerollCost: this.rerollCost(p),
          ready: p.ready, eliminated: p.eliminated,
          pendingItems: p.pendingItems,
          lastResult: p.lastResult,
          teamCap: this.teamCap(),
        },
      });
    }
  }
}

/* ---------------- boot ----------------
 * One HTTP server does everything: serves the game's static files AND the
 * Colyseus websocket/matchmaking — a single $PORT works on Heroku etc.
 * -------------------------------------- */
const express = require("express");
const port = process.env.PORT || 2567;
const app = express();
app.use((req, res, next) => {
  // permissive CORS so a python-served local page (:8787) can still matchmake
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, ".."), { extensions: ["html"] }));

/* ---------------- leaderboard API ---------------- */
const utcDay = () => new Date().toISOString().slice(0, 10);
app.get("/api/leaderboard", async (req, res) => {
  try { res.json(await db.topPlayers(20)); }
  catch (e) { res.status(500).json({ error: "db" }); }
});
app.get("/api/daily", async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(req.query.day || "") ? req.query.day : utcDay();
  try { res.json({ day, scores: await db.topDaily(day, 20) }); }
  catch (e) { res.status(500).json({ error: "db" }); }
});
app.post("/api/daily", async (req, res) => {
  const name = String(req.body.name || "").slice(0, 16).trim();
  const score = req.body.score | 0;
  if (!name || score < 0 || score > 30000) return res.status(400).json({ error: "bad input" });
  try {
    await db.submitDaily(utcDay(), name, score);
    res.json({ ok: true, day: utcDay() });
  } catch (e) { res.status(500).json({ error: "db" }); }
});

const server = http.createServer(app);
const gameServer = new Server({ server });
gameServer.define("autochess", AutoChessRoom);
db.init().catch(e => console.error("[db] init failed:", e.message));
gameServer.listen(port).then(() => {
  console.log(`[autochess] game + static server listening on :${port}`);
});
