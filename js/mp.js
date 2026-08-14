/* ==========================================================================
 * Multiplayer client — Colyseus adapter.
 * window.game becomes an MPAdapter with the exact surface ui.render()/frame()
 * expect; every mutation is a server message, every server "view" patches the
 * adapter. Battles replay locally with the server's seed — the sim is
 * deterministic, so the visuals match the authoritative result exactly.
 * ========================================================================== */

(function () {
  // ?server=host[:port] joins a remote server (LAN / internet play).
  // Default: same origin (deployed / node-served); python-served local dev
  // on :8787 falls back to the local colyseus port 2567.
  const qs = new URLSearchParams(location.search);
  const serverParam = qs.get("server");
  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = serverParam
    ? (serverParam.startsWith("ws") ? serverParam : `${wsProto}://${serverParam.includes(":") ? serverParam : serverParam + ":2567"}`)
    : (location.port === "8787" ? `ws://${location.hostname}:2567` : `${wsProto}://${location.host}`);
  let room = null;
  let client = null;
  let reconnToken = null;
  let intentionalLeave = false;

  const mp = {
    mp: true,
    phase: "lobby",
    phaseLabel: "LOBBY",
    readyLabel: "READY UP",
    round: 0,
    gold: ECON.startGold,
    hp: ECON.startHP,
    streak: 0,
    units: [],
    itemsInv: [],
    shop: [],
    enemyTeam: [],
    enemyName: null,
    battle: null,
    replayDone: false,
    serverPhase: "lobby",
    speedMul: 1,
    pendingItems: null,
    lastResult: null,
    career: {},
    totals: { wins: 0, losses: 0, goldEarned: 0 },
    you: { ready: false, eliminated: false, teamCap: 2, rerollCost: 2 },
    roster: [],
    winnerName: null,
    myName: "Trainer",
    youAre: 0,
    endsAt: null,

    /* ---- surface the UI expects ---- */
    fightingUnits() { return this.units.slice(0, this.you.teamCap || ECON.teamCap(Math.max(1, this.round))); },
    trainer() {
      const foes = this.roster.filter(r => !r.eliminated && r.name !== this.myName).length;
      return { name: this.enemyName || `${foes} RIVAL${foes === 1 ? "" : "S"} REMAIN`, types: [], boss: false };
    },
    rerollCost() { return this.you.rerollCost || ECON.rerollCost; },
    incomePreview() {
      const interest = Math.min(ECON.interestCap, Math.floor(this.gold / ECON.interestPer));
      return { base: ECON.baseIncome, interest, total: ECON.baseIncome + interest };
    },
    scoutReport() { return null; },  // pairings are hidden until battle (TFT-style)

    /* ---- actions -> server messages ---- */
    buy(slot) { if (room && this.phase === "plan") { room.send("buy", { slot }); SND.play("buy"); } return true; },
    sell(idx) { if (room && this.phase === "plan") { room.send("sell", { idx }); SND.play("sell"); } return true; },
    reroll() { if (room && this.phase === "plan") { room.send("reroll"); SND.play("reroll"); } return true; },
    equip(item, unit) { if (room && this.phase === "plan") { room.send("equip", { item, unit }); SND.play("equip"); } return true; },
    reorder(from, to) { if (room && this.phase === "plan") room.send("reorder", { from, to }); return true; },
    moveFront(idx) { return this.reorder(idx, 0); },
    startBattle() {
      if (room && this.phase === "plan" && !this.you.ready) {
        room.send("ready");
        SND.play("click");
      }
      return true;
    },
    pickItem(i) { if (room && this.phase === "item") room.send("pick-item", { i }); return true; },
    setSpeed(n) { this.speedMul = Math.max(1, Math.min(16, n)); ui.render(); },
    continueFromResult() { return true; },

    /* battle replay finished locally */
    resolveBattle() {
      const b = this.battle;
      this.replayDone = true;
      SND.stopMusic();
      if (b && !this.spectatingMatch) {
        // career + mvp/clutch from the deterministic replay (same numbers
        // the server saw)
        const myTeam = this.youAre;
        for (const f of b.fighters.filter(x => x.team === myTeam)) {
          const key = f.minion ? (f.owner && f.owner.key) : f.key;
          if (!key) continue;
          const c = (this.career[key] = this.career[key] || { dmg: 0, kos: 0, mvps: 0 });
          c.dmg += f.dmgDealt;
          if (!f.minion) c.kos += f.kos;
        }
        const mine = b.fighters.filter(f => f.team === myTeam && !f.minion);
        let mvp = null;
        for (const f of mine) if (!mvp || f.dmgDealt > mvp.dmgDealt) mvp = f;
        this.localMvp = mvp ? { key: mvp.key, name: mvp.name, dmg: Math.round(mvp.dmgDealt), kos: mvp.kos } : null;
        if (this.localMvp) (this.career[this.localMvp.key] = this.career[this.localMvp.key] || { dmg: 0, kos: 0, mvps: 0 }).mvps += 1;
        const won = b.winner === myTeam;
        const alive = b.living(myTeam);
        this.localClutch = won && alive.length === 1 && alive[0].hp / alive[0].maxhp < 0.3;
      }
      this.syncPhase();
      if (this.pendingResultPhase) {
        this.pendingResultPhase = false;
        this.syncPhase();
      }
    },

    /* map server phase -> display phase (battle holds until replay ends) */
    syncPhase() {
      const sp = this.serverPhase;
      // eliminated players: their GAME OVER (with run report) shows through
      // the result phase right after the fatal loss; after that they spectate
      // and get to WATCH the remaining players' battles live.
      if (this.you && this.you.eliminated && sp !== "over" && sp !== "lobby") {
        const justLost = this.lastResult && !this.elimShown && ["result", "item"].includes(sp);
        if (sp === "plan") this.elimShown = true;
        if (sp === "battle" && this.battle && !this.replayDone) {
          this.phase = "battle";       // live spectator replay
        } else {
          this.phase = justLost ? "gameover" : "spectate";
        }
        ui.render();
        renderRoster();
        return;
      }
      if (sp === "battle") {
        this.phase = this.replayDone ? "battle-waiting" : (this.battle ? "battle" : "battle-waiting");
      } else if (sp === "result") {
        if (this.replayDone || !this.battle) {
          this.phase = "result";
          if (this.lastResult) SND.play(this.lastResult.won ? "win" : "lose");
        } else {
          this.phase = "battle";  // let the replay finish; result shows after
          this.pendingResultPhase = true;
        }
      } else if (sp === "item") {
        this.phase = this.replayDone || !this.battle ? "item" : "battle";
        if (this.phase === "battle") this.pendingResultPhase = true;
      } else if (sp === "over") {
        this.phase = this.winnerName === this.myName ? "victory" : "gameover";
        SND.stopMusic();
        SND.play(this.phase === "victory" ? "champion" : "lose");
      } else {
        this.phase = sp;  // lobby / plan
      }
      ui.render();
      renderRoster();
    },
  };

  /* ---------------- roster bar ---------------- */
  function renderRoster() {
    const el = document.getElementById("mp-roster");
    if (!el) return;
    el.innerHTML = "";
    for (const r of mp.roster) {
      const chip = document.createElement("span");
      chip.className = "roster-chip" + (r.eliminated ? " out" : "") + (r.name === mp.myName ? " me" : "");
      chip.innerHTML = `<b>${r.name}</b><span class="chip-elo">${r.rating || 1000}</span><img src="sprites/ui/HP.png" alt="">${r.hp}${r.connected ? "" : " (dc)"}`;
      el.appendChild(chip);
    }
  }

  /* ---------------- countdown ticker ---------------- */
  setInterval(() => {
    if (!mp.endsAt || ["lobby", "over"].includes(mp.serverPhase)) return;
    const s = Math.max(0, Math.ceil((mp.endsAt - Date.now()) / 1000));
    const names = { plan: "PLAN", battle: "BATTLE", result: "RESULT", item: "ITEMS" };
    mp.phaseLabel = `${names[mp.serverPhase] || mp.serverPhase.toUpperCase()} ${s}s`;
    const pl = document.getElementById("phase-label");
    if (pl) pl.textContent = mp.phaseLabel;
  }, 500);

  /* ---------------- server message handlers ---------------- */
  function bindRoom() {
    room.onMessage("lobby", (msg) => {
      const roster = document.getElementById("lobby-roster");
      const status = document.getElementById("lobby-status");
      const startBtn = document.getElementById("lobby-start");
      if (roster) {
        roster.innerHTML = msg.players.map(p =>
          `<div class="lobby-row">${p.name} <span class="chip-elo">${p.rating || 1000}</span>${p.connected ? "" : " (dc)"}</div>`).join("");
      }
      if (status) status.textContent = msg.canStart ? "ready when you are!" : "waiting for trainers (need 2+)...";
      if (startBtn) startBtn.disabled = !msg.canStart;
    });

    room.onMessage("view", (msg) => {
      mp.serverPhase = msg.phase;
      mp.round = msg.round;
      mp.endsAt = msg.endsAt;
      mp.winnerName = msg.winnerName;
      mp.roster = msg.roster || [];
      const y = msg.you;
      if (y) {
        mp.gold = y.gold; mp.hp = y.hp; mp.streak = y.streak;
        mp.units = y.units; mp.itemsInv = y.items; mp.shop = y.shop;
        mp.pendingItems = y.pendingItems;
        mp.you = y;
        mp.rating = y.rating;
        if (msg.phase === "over") {
          // persist the post-game rating; show the delta on the end screen
          if (!mp.ratingSaved && typeof y.rating === "number") {
            localStorage.setItem("psac-rating", String(y.rating));
            mp.ratingSaved = true;
            const d = y.ratingDelta || 0;
            mp.ratingLine = `Rating ${y.rating} (${d >= 0 ? "+" : ""}${d})`;
          }
        } else {
          mp.ratingSaved = false;
          mp.ratingLine = null;
        }
        mp.readyLabel = msg.phase === "plan" ? (y.ready ? "WAITING..." : "READY UP") : "READY UP";
        if (y.lastResult) {
          mp.lastResult = {
            ...y.lastResult,
            round: msg.round,
            trainer: mp.enemyName,
            mvp: mp.localMvp || null,
            clutch: !!mp.localClutch,
            survivors: 0,
          };
          if (mp.lastCountedRound !== msg.round) {
            mp.lastCountedRound = msg.round;
            if (!y.lastResult.draw) mp.totals[y.lastResult.won ? "wins" : "losses"] += 1;
            mp.totals.goldEarned += y.lastResult.income || 0;
          }
        }
      }
      if (msg.phase === "plan") {
        // fresh planning phase: clear last battle
        mp.battle = null;
        mp.replayDone = false;
        mp.enemyTeam = [];
        mp.enemyName = null;
        mp.localMvp = null;
        mp.localClutch = false;
        mp.pendingResultPhase = false;
        mp.spectatingMatch = false;
        SND.startMusic("plan");
      }
      mp.canRematch = msg.phase === "over";
      if (msg.phase === "over") {
        document.getElementById("lobby-overlay").style.display = "none";
      }
      if (msg.phase === "lobby" && mp.hasPlayed) {
        // rematch: reset the local run and show the lobby again
        mp.career = {};
        mp.totals = { wins: 0, losses: 0, goldEarned: 0 };
        mp.lastCountedRound = null;
        mp.lastResult = null;
        mp.battle = null;
        mp.elimShown = false;
        mp.localMvp = null;
        mp.winnerName = null;
        document.getElementById("lobby-overlay").style.display = "flex";
        document.getElementById("lobby-join").style.display = "none";
        document.getElementById("lobby-wait").style.display = "block";
      }
      if (msg.phase !== "lobby") {
        mp.hasPlayed = true;
        // game (re)started: make sure the lobby overlay is gone
        document.getElementById("lobby-overlay").style.display = "none";
      }
      mp.syncPhase();
    });

    room.onMessage("match", (msg) => {
      mp.enemyName = msg.enemyName;
      mp.youAre = msg.youAre;
      mp.spectatingMatch = false;
      mp.enemyTeam = msg.youAre === 0 ? msg.teamB : msg.teamA;
      // deterministic replay of the authoritative sim
      mp.battle = new Battle(msg.teamA, msg.teamB, msg.seed);
      mp.replayDone = false;
      // auto-speed so the replay fits the battle window
      mp.speedMul = Math.max(1, Math.min(16, Math.ceil(msg.simT / 14)));
      SND.play("battle-start");
      SND.startMusic();
      mp.syncPhase();
      ui.render();
    });

    // eliminated players watch the remaining trainers fight
    room.onMessage("spectate-match", (msg) => {
      const m = msg.matches && msg.matches[0];
      if (!m) return;
      mp.enemyName = `${m.aName} VS ${m.bName}`;
      mp.spectatingMatch = true;
      mp.battle = new Battle(m.teamA, m.teamB, m.seed);
      mp.replayDone = false;
      mp.speedMul = Math.max(1, Math.min(16, Math.ceil(m.simT / 14)));
      ui.toast(`Watching: ${m.aName} VS ${m.bName}`, null);
      mp.syncPhase();
      ui.render();
    });

    room.onLeave(async (code) => {
      if (intentionalLeave) return;
      const cs = document.getElementById("conn-status");
      // unintentional drop: try to reconnect (server holds our seat 60s)
      if (reconnToken) {
        document.getElementById("lobby-overlay").style.display = "flex";
        if (cs) cs.textContent = "connection lost — reconnecting...";
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await new Promise(r => setTimeout(r, 1500));
            room = await client.reconnect(reconnToken);
            reconnToken = room.reconnectionToken;
            bindRoom();
            if (cs) cs.textContent = `reconnected as ${mp.myName}`;
            document.getElementById("lobby-overlay").style.display = "none";
            return;
          } catch (e) { /* retry */ }
        }
      }
      if (cs) cs.textContent = "disconnected from server — refresh to rejoin";
      document.getElementById("lobby-overlay").style.display = "flex";
    });
  }

  /* ---------------- boot ---------------- */
  window.addEventListener("DOMContentLoaded", () => {
    ui.selectedItem = null;
    ui.init();
    window.game = mp;

    // suggested name
    const nameInput = document.getElementById("name-input");
    nameInput.value = "Trainer" + (100 + Math.floor(Math.random() * 900));

    document.getElementById("join-btn").onclick = async () => {
      const cs = document.getElementById("conn-status");
      const name = nameInput.value.trim() || "Trainer";
      mp.myName = name;
      try {
        client = new Colyseus.Client(wsUrl);
        const rating = parseInt(localStorage.getItem("psac-rating")) || 1000;
        room = await client.joinOrCreate("autochess", { name, rating });
        reconnToken = room.reconnectionToken;
        bindRoom();
        document.getElementById("lobby-join").style.display = "none";
        document.getElementById("lobby-wait").style.display = "block";
        cs.textContent = `connected as ${name}`;
        SND.play("click");
      } catch (e) {
        cs.textContent = "could not reach server — is server/index.js running? (" + (e.message || e) + ")";
      }
    };
    document.getElementById("lobby-start").onclick = () => { if (room) { room.send("start"); SND.play("click"); } };

    document.getElementById("reroll").onclick = () => mp.reroll();
    document.getElementById("start-battle").onclick = () => mp.startBattle();
    document.getElementById("new-game").onclick = () => {
      // at game end this requests a rematch (server resets the room to lobby)
      if (room && mp.serverPhase === "over") { room.send("again"); SND.play("click"); }
      else location.reload();
    };
    document.getElementById("speed-btn").onclick = () => {
      SND.play("click");
      const next = { 1: 2, 2: 4, 4: 8, 8: 16, 16: 1 }[mp.speedMul] || 1;
      mp.setSpeed(next);
    };
    const muteBtn = document.getElementById("mute-btn");
    const syncMute = () => {
      muteBtn.textContent = SND.muted ? "✕" : "♪";
      muteBtn.classList.toggle("off", SND.muted);
    };
    muteBtn.onclick = () => { SND.toggle(); if (!SND.muted) SND.play("click"); syncMute(); };
    syncMute();

    // hide lobby overlay once the game starts
    const lobbyWatcher = setInterval(() => {
      if (!["lobby"].includes(mp.serverPhase)) {
        document.getElementById("lobby-overlay").style.display = "none";
        clearInterval(lobbyWatcher);
      }
    }, 300);

    ui.render();
  });
})();
