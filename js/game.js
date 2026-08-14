/* ==========================================================================
 * Pokemon Sphere AutoChess — roguelike game loop
 * phases: plan -> battle -> result -> (item) -> plan ... -> victory/gameover
 * Deterministic via ?seed=N. Battle speed via ?speed=N (1/2/4/8/16).
 * Exposes window.game for testing (Playwright drives the real UI + this API).
 * ========================================================================== */

const POOL = Object.keys(UNITS).filter(k => UNITS[k].pool !== false);

class Game {
  constructor(seed) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.round = 1;
    this.gold = ECON.startGold;
    this.hp = ECON.startHP;
    this.streak = 0;           // positive = win streak
    this.units = [];           // [{key, star, item, sellValue}]
    this.itemsInv = [];        // unequipped item keys
    this.phase = "plan";
    this.shop = [];
    this.enemyTeam = [];
    this.battle = null;
    this.speedMul = 1;
    this.lastResult = null;
    this.pendingItems = null;  // [key,key,key] choice after item rounds
    this.history = [];
    this.career = {};          // {unitKey: {dmg, kos, mvps}} across the run
    this.totals = { wins: 0, losses: 0, goldEarned: 0 };

    const params = new URLSearchParams(location.search);
    if (params.get("speed")) this.speedMul = Math.max(1, Math.min(16, parseInt(params.get("speed")) || 1));

    this.startRound();
  }

  /* ---------------- shop ---------------- */
  rollShop() {
    const odds = SHOP_ODDS[Math.min(this.round - 1, SHOP_ODDS.length - 1)];
    this.shop = [];
    for (let i = 0; i < ECON.shopSlots; i++) {
      const roll = this.rng() * 100;
      let acc = 0, tier = 1;
      for (let t = 0; t < 5; t++) { acc += odds[t]; if (roll < acc) { tier = t + 1; break; } }
      const choices = POOL.filter(k => UNITS[k].cost === tier);
      this.shop.push(choices[Math.floor(this.rng() * choices.length)]);
    }
    // pity timer: sitting on 2 copies of something? after 2 dry shops in a
    // row, the 3rd copy is guaranteed to appear (SAP-style RNG mercy)
    const counts = {};
    this.units.forEach(u => { if (u.star === 1) counts[u.key] = (counts[u.key] || 0) + 1; });
    const needed = Object.keys(counts).filter(k => counts[k] === 2 && POOL.includes(k));
    if (needed.length) {
      if (this.shop.some(k => needed.includes(k))) {
        this.pityCount = 0;
      } else {
        this.pityCount = (this.pityCount || 0) + 1;
        if (this.pityCount >= 2) {
          const key = needed[Math.floor(this.rng() * needed.length)];
          this.shop[Math.floor(this.rng() * this.shop.length)] = key;
          this.pityCount = 0;
        }
      }
    } else {
      this.pityCount = 0;
    }
  }

  /* losing streak = cheaper rerolls (comfort for RNG lows) */
  rerollCost() { return this.streak <= -2 ? 1 : ECON.rerollCost; }

  reroll() {
    if (this.phase !== "plan" || this.gold < this.rerollCost()) return false;
    this.gold -= this.rerollCost();
    this.rollShop();
    SND.play("reroll");
    ui.render();
    return true;
  }

  buy(slot) {
    if (this.phase !== "plan") return false;
    const key = this.shop[slot];
    if (!key) return false;
    const cost = UNITS[key].cost;
    if (this.gold < cost || this.units.length >= ECON.benchCap) return false;
    this.gold -= cost;
    this.shop[slot] = null;
    this.units.push({ key, star: 1, item: null, sellValue: cost });
    this.tryCombine();
    SND.play("buy");
    ui.render();
    return true;
  }

  sell(idx) {
    if (this.phase !== "plan" || !this.units[idx]) return false;
    const u = this.units.splice(idx, 1)[0];
    this.gold += u.sellValue;
    if (u.item) this.itemsInv.push(u.item);
    SND.play("sell");
    ui.render();
    return true;
  }

  moveFront(idx) {
    if (this.phase !== "plan" || !this.units[idx]) return false;
    const u = this.units.splice(idx, 1)[0];
    this.units.unshift(u);
    ui.render();
    return true;
  }

  /* drag-reorder: move unit at from-index to to-index */
  reorder(from, to) {
    if (this.phase !== "plan" || !this.units[from] || from === to) return false;
    const u = this.units.splice(from, 1)[0];
    this.units.splice(to, 0, u);
    ui.render();
    return true;
  }

  /* 3 copies of same key+star -> evolve (or gold-star if no evolution) */
  tryCombine() {
    let changed = true;
    while (changed) {
      changed = false;
      const counts = {};
      this.units.forEach((u, i) => {
        const k = u.key + "|" + u.star;
        (counts[k] = counts[k] || []).push(i);
      });
      for (const k in counts) {
        if (counts[k].length >= 3) {
          const idxs = counts[k].slice(0, 3);
          const [key, star] = [this.units[idxs[0]].key, this.units[idxs[0]].star];
          const spec = UNITS[key];
          const merged = idxs.map(i => this.units[i]);
          const item = merged.find(u => u.item)?.item || null;
          const extraItems = merged.filter(u => u.item).map(u => u.item).slice(1);
          this.itemsInv.push(...extraItems);
          const sellValue = merged.reduce((s, u) => s + u.sellValue, 0);
          idxs.sort((a, b) => b - a).forEach(i => this.units.splice(i, 1));
          let result;
          if (spec.evolvesTo && star === 1) {
            let target = spec.evolvesTo;
            if (target === "@eeveelution") {
              target = EEVEELUTIONS[Math.floor(this.rng() * EEVEELUTIONS.length)];
            }
            result = { key: target, star: 1, item, sellValue };
            this.history.push(`${spec.name} evolved into ${UNITS[target].name}!`);
            if (typeof ui !== "undefined") ui.toast(`${spec.name} evolved into ${UNITS[target].name}!`, target);
          } else {
            result = { key, star: star + 1, item, sellValue };
            this.history.push(`${spec.name} powered up to ★${star + 1}!`);
            if (typeof ui !== "undefined") ui.toast(`${spec.name} powered up to ★${star + 1}!`, key);
          }
          this.units.unshift(result);
          changed = true;
          break;
        }
      }
    }
  }

  equip(itemIdx, unitIdx) {
    if (this.phase !== "plan") return false;
    const it = this.itemsInv[itemIdx], u = this.units[unitIdx];
    if (!it || !u || u.item) return false;
    u.item = it;
    this.itemsInv.splice(itemIdx, 1);
    SND.play("equip");
    ui.render();
    return true;
  }

  /* ---------------- enemies: themed by the stage's trainer ---------------- */
  trainer() { return TRAINERS[Math.min(this.round - 1, TRAINERS.length - 1)]; }

  genEnemyTeam() {
    const plan = ENEMY_PLAN[Math.min(this.round - 1, ENEMY_PLAN.length - 1)];
    const trainer = this.trainer();
    const team = [];
    let budget = plan.budget;
    if (plan.boss) {
      team.push({ key: "mewtwo", star: 1, item: "muscle_band" });
      budget -= 5;
    }
    let guard = 0;
    while (team.length < plan.units && budget > 0 && guard++ < 200) {
      const affordable = POOL.filter(k => UNITS[k].cost <= Math.min(plan.maxTier, budget));
      if (!affordable.length) break;
      // ~75% themed picks so trainer teams read as their type (and synergize)
      const themed = affordable.filter(k => trainer.types.includes(UNITS[k].type));
      const choices = themed.length && this.rng() < 0.75 ? themed : affordable;
      const key = choices[Math.floor(this.rng() * choices.length)];
      let star = 1, cost = UNITS[key].cost;
      if (this.round >= 5 && budget >= cost * 3 && this.rng() < 0.3) {
        if (UNITS[key].evolvesTo && UNITS[key].evolvesTo !== "@eeveelution") {
          team.push({ key: UNITS[key].evolvesTo, star: 1, item: null });
          budget -= cost * 3;
          continue;
        }
        star = 2; cost *= 3;
      }
      const item = this.round >= 6 && this.rng() < 0.25
        ? Object.keys(ITEMS)[Math.floor(this.rng() * Object.keys(ITEMS).length)] : null;
      team.push({ key, star, item });
      budget -= cost;
    }
    if (!team.length) team.push({ key: "magikarp", star: 1, item: null });
    return team;
  }

  fightingUnits() { return this.units.slice(0, ECON.teamCap(this.round)); }

  /* ---------------- rounds & battle ---------------- */
  startRound() {
    this.phase = "plan";
    this.battle = null;
    this.enemyTeam = this.genEnemyTeam();
    this.rollShop();
    if (typeof ui !== "undefined") ui.render();
  }

  startBattle() {
    if (this.phase !== "plan") return false;
    const mine = this.fightingUnits();
    if (!mine.length) return false;
    this.phase = "battle";
    this.battle = new Battle(mine, this.enemyTeam, (this.seed * 7919 + this.round * 104729) >>> 0);
    SND.play("battle-start");
    SND.startMusic();
    ui.render();
    return true;
  }

  /* called by the RAF loop when battle.over flips true */
  resolveBattle() {
    const b = this.battle;
    const won = b.winner === 0;
    const survivors = b.living(won ? 0 : 1).length;
    const lines = [];

    if (won) this.streak = this.streak >= 0 ? this.streak + 1 : 1;
    else this.streak = this.streak <= 0 ? this.streak - 1 : -1;

    let income = ECON.baseIncome;
    lines.push(`Base income +${ECON.baseIncome}`);
    const interest = Math.min(ECON.interestCap, Math.floor(this.gold / ECON.interestPer));
    if (interest) { income += interest; lines.push(`Interest +${interest}`); }
    const sAbs = Math.min(Math.abs(this.streak), ECON.streakBonus.length - 1);
    const sBonus = ECON.streakBonus[sAbs];
    if (sBonus) { income += sBonus; lines.push(`Streak (${Math.abs(this.streak)}) +${sBonus}`); }
    if (won) { income += ECON.winBonus; lines.push(`Win bonus +${ECON.winBonus}`); }
    this.gold += income;

    let dmgTaken = 0;
    if (!won) {
      dmgTaken = ECON.lossDamage(this.round, survivors);
      this.hp -= dmgTaken;
    }

    // MVP: your fighter with the most damage dealt (SAP-style story beat)
    const mine = b.fighters.filter(f => f.team === 0 && !f.minion);
    let mvp = null;
    for (const f of mine) {
      if (!mvp || f.dmgDealt > mvp.dmgDealt) mvp = f;
    }
    const clutch = won && b.living(0).length === 1 &&
      b.living(0)[0].hp / b.living(0)[0].maxhp < 0.3;

    // career stats for the end-of-run report (minion dmg credits the owner)
    for (const f of b.fighters.filter(x => x.team === 0)) {
      const key = f.minion ? (f.owner && f.owner.key) : f.key;
      if (!key) continue;
      const c = (this.career[key] = this.career[key] || { dmg: 0, kos: 0, mvps: 0 });
      c.dmg += f.dmgDealt;
      if (!f.minion) c.kos += f.kos;
    }
    if (mvp) (this.career[mvp.key] = this.career[mvp.key] || { dmg: 0, kos: 0, mvps: 0 }).mvps += 1;
    this.totals[won ? "wins" : "losses"] += b.winner === "draw" ? 0 : 1;
    this.totals.goldEarned += income;

    this.lastResult = {
      won, draw: b.winner === "draw", round: this.round, income, lines,
      dmgTaken, survivors, trainer: this.trainer().name, clutch,
      mvp: mvp ? { key: mvp.key, name: mvp.name, dmg: Math.round(mvp.dmgDealt), kos: mvp.kos } : null,
    };
    this.history.push(`R${this.round}: ${won ? "WIN" : (b.winner === "draw" ? "DRAW" : "LOSS")}`);

    SND.stopMusic();
    if (this.hp <= 0) {
      this.phase = "gameover";
      SND.play("lose");
    } else if (this.round >= ECON.maxRounds) {
      this.phase = "victory";
      SND.play("champion");
    } else {
      this.phase = "result";
      SND.play(won ? "win" : "lose");
    }
    ui.render();
  }

  continueFromResult() {
    if (this.phase !== "result") return false;
    if (ECON.itemRounds.includes(this.round)) {
      const keys = Object.keys(ITEMS);
      const picks = [];
      while (picks.length < 3) {
        const k = keys[Math.floor(this.rng() * keys.length)];
        if (!picks.includes(k)) picks.push(k);
      }
      this.pendingItems = picks;
      this.phase = "item";
    } else {
      this.round += 1;
      this.startRound();
    }
    ui.render();
    return true;
  }

  pickItem(i) {
    if (this.phase !== "item" || !this.pendingItems) return false;
    this.itemsInv.push(this.pendingItems[i]);
    this.pendingItems = null;
    SND.play("item");
    this.round += 1;
    this.startRound();
    return true;
  }

  setSpeed(n) { this.speedMul = Math.max(1, Math.min(16, n)); ui.render(); }

  /* projected income if the next battle ends now (for economy legibility) */
  incomePreview() {
    const interest = Math.min(ECON.interestCap, Math.floor(this.gold / ECON.interestPer));
    return { base: ECON.baseIncome, interest, total: ECON.baseIncome + interest };
  }

  /* scouting: enemy's dominant type + which types counter it */
  scoutReport() {
    const counts = countTypes(this.enemyTeam);
    let domType = null, domCount = 0;
    for (const t in counts) if (counts[t] > domCount) { domType = t; domCount = counts[t]; }
    if (!domType || domCount < 2) return null;
    const counters = Object.keys(TYPE_CHART).filter(t => (TYPE_CHART[t] && TYPE_CHART[t][domType]) === SUPER);
    return { domType, domCount, counters };
  }

  /* compact snapshot for tests */
  state() {
    return {
      phase: this.phase, round: this.round, gold: this.gold, hp: this.hp,
      streak: this.streak,
      units: this.units.map(u => ({ key: u.key, star: u.star, item: u.item })),
      shop: this.shop.slice(), items: this.itemsInv.slice(),
      enemy: this.enemyTeam.map(u => ({ key: u.key, star: u.star, item: u.item })),
      lastResult: this.lastResult,
      battleOver: this.battle ? this.battle.over : null,
      battleT: this.battle ? Math.round(this.battle.t * 10) / 10 : null,
    };
  }
}

/* ==========================================================================
 * UI
 * ========================================================================== */
const ui = {
  sprites: {},
  itemSprites: {},
  selectedItem: null,

  init() {
    for (const k of Object.keys(UNITS)) {
      const img = new Image();
      img.src = `sprites/${k}.png`;
      this.sprites[k] = img;
    }
    for (const k of Object.keys(ITEMS)) {
      const img = new Image();
      img.src = ITEMS[k].sprite;
      this.itemSprites[k] = img;
    }
    this.canvas = document.getElementById("arena");
    this.renderer = new BattleRenderer(this.canvas, this.sprites, this.itemSprites);
    // esc cancels equip mode
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.selectedItem !== null) {
        this.selectedItem = null;
        this.render();
      }
    });
    requestAnimationFrame(() => this.frame());
  },

  frame() {
    const g = window.game;
    if (g) {
      if (g.phase === "battle" && g.battle) {
        for (let i = 0; i < g.speedMul && !g.battle.over; i++) {
          g.battle.step(SIM.dt);
        }
        // drain battle sound events (SND throttles the spammy ones)
        for (const ev of g.battle.events) SND.play(ev);
        g.battle.events.length = 0;
        this.renderer.draw(g.battle);
        if (g.battle.over) {
          g.phase = "battle-ending";  // prevent double resolve
          setTimeout(() => { if (g.phase === "battle-ending") g.resolveBattle(); }, 600 / g.speedMul);
        }
      } else if (g.phase === "battle-ending" && g.battle) {
        this.renderer.draw(g.battle);
      } else if (g.phase === "plan") {
        const tr = g.trainer();
        this.renderer.drawPreview(g.fightingUnits(), g.enemyTeam, {
          stage: g.round, trainer: tr.name, boss: !!tr.boss,
          synA: computeSynergies(g.fightingUnits()),
          synB: computeSynergies(g.enemyTeam),
          scout: g.scoutReport(),
        });
      }
    }
    requestAnimationFrame(() => this.frame());
  },

  el(id) { return document.getElementById(id); },

  /* brief celebration banner over the arena (evolutions, star-ups) */
  toast(text, spriteKey) {
    SND.play("evolve");
    const box = this.el("toasts");
    if (!box) return;
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `${spriteKey ? `<img src="sprites/${spriteKey}.png" alt="">` : ""}<span>${text}</span>`;
    box.appendChild(t);
    setTimeout(() => t.classList.add("gone"), 4000);
    setTimeout(() => t.remove(), 4500);
  },

  /* plain-words move description generated from the move spec */
  moveBlurb(moveName) {
    const m = MOVES[moveName];
    const chg = `Charges in ${m.cost} hits.`;
    switch (m.kind) {
      case "proj":  return `Fires ${m.count} projectile${m.count > 1 ? "s" : ""} at ${m.dmg} dmg each${m.slowMul ? ", chilling the target" : ""}${m.homing ? " (homing)" : ""}. ${chg}`;
      case "dash":  return `Charges the enemy for a ${m.dmg} dmg burst${m.kb ? ", LAUNCHING them across the arena" : ""}${m.confuse ? " + confusion" : ""}${m.armor ? " and hardens armor" : ""}. ${chg}`;
      case "buff":  return `Rampages: ${Math.round((m.dmgMul - 1) * 100)}% more damage${m.speedMul ? ` and ${Math.round((m.speedMul - 1) * 100)}% speed` : ""} for ${m.dur}s. ${chg}`;
      case "grow":  return `Permanently gains +${m.dmgAdd} damage every cast. ${chg}`;
      case "heal":  return `Restores ${m.amount} HP. ${chg}`;
      case "drain": return `Drains ${m.dmg} HP from the enemy. ${chg}`;
      case "poison": return `Poisons the target with ${m.stacks} stacks. ${chg}`;
      case "sleep": return `Puts the target to sleep for ${m.dur}s (next hit wakes + hurts more). ${chg}`;
      case "slow":  return `Webs the target: ${Math.round((1 - m.mul) * 100)}% slower for ${m.dur}s. ${chg}`;
      case "aoe":   return `Blasts ${m.radius > 500 ? "the whole arena" : "nearby enemies"} for ${m.dmg} dmg${m.burn ? " + burn" : ""}. ${chg}`;
      case "harden": return `Hardens: takes 20% less damage, stacks 3 times. ${chg}`;
      case "hazard": return `Scatters ${m.count} sharp rocks on the enemy side — ${m.dmg} dmg on touch, linger ${m.ttl}s. ${chg}`;
      case "summon": return `Summons ${m.count} Egg minions (max ${m.cap}) that swarm and jostle the enemy. ${chg}`;
      case "flail": return `Does nothing... but below 40% HP this mon deals +80% damage. Pray for the combine.`;
      default: return chg;
    }
  },

  /* ---------- inspect panel ---------- */
  setInspect(key) {
    if (this.inspectKey === key) return;
    this.inspectKey = key;
    this.renderInspect();
  },

  renderInspect() {
    const box = this.el("inspect-body");
    const key = this.inspectKey;
    if (!box) return;
    if (!key || !UNITS[key]) {
      box.innerHTML = `<div class="muted" style="padding:12px 6px">Hover a Pokémon in the shop or your team to inspect it.</div>`;
      return;
    }
    const u = UNITS[key];
    const g = window.game;
    const bar = (label, val, max, cls) => {
      const pct = Math.round(Math.min(1, val / max) * 100);
      return `<div class="stat-row"><span class="stat-label">${label}</span>
        <div class="stat-bar"><div class="stat-fill ${cls}" style="width:${pct}%"></div></div>
        <span class="stat-val">${val}</span></div>`;
    };
    // evolution chain sprites
    let evo = "";
    let cur = key, chain = [key];
    while (UNITS[cur] && UNITS[cur].evolvesTo && UNITS[cur].evolvesTo !== "@eeveelution") {
      cur = UNITS[cur].evolvesTo;
      chain.push(cur);
    }
    if (UNITS[key].evolvesTo === "@eeveelution") {
      evo = `<div class="evo-line"><img src="sprites/${key}.png" alt=""><span class="evo-x3">×3</span><span class="evo-arrow">→</span><span class="evo-random">random eeveelution!</span></div>`;
    } else if (chain.length > 1) {
      evo = `<div class="evo-line">` + chain.map((k, i) =>
        `${i > 0 ? '<span class="evo-x3">×3</span><span class="evo-arrow">→</span>' : ""}<img src="sprites/${k}.png" title="${UNITS[k].name}" alt="${UNITS[k].name}">`
      ).join("") + `</div>`;
    } else {
      evo = `<div class="evo-line"><img src="sprites/${key}.png" alt=""><span class="evo-x3">×3</span><span class="evo-arrow">→</span><img src="sprites/${key}.png" alt=""><span class="star">★</span><span class="evo-note">+80% HP, +60% DMG</span></div>`;
    }
    // synergy note w/ current team count
    const syn = SYNERGY[u.type];
    const count = g ? (countTypes(g.fightingUnits())[u.type] || 0) : 0;
    const synHtml = syn ? `
      <div class="inspect-syn">
        <span class="syn-chip" style="background:${TYPE_COLORS[u.type]}">${u.type.toUpperCase()}</span>
        <b>${syn.label}</b> (${count} on team) — ${syn.desc}
      </div>` : "";
    box.innerHTML = `
      <div class="inspect-top">
        <img class="inspect-sprite" src="sprites/${key}.png" alt="${u.name}">
        <div>
          <div class="inspect-name">${u.name}</div>
          <div class="inspect-cost"><img src="sprites/items/COIN.png" alt="">${u.cost} · <span style="color:${TYPE_COLORS[u.type]}">${u.type}</span></div>
        </div>
      </div>
      ${bar("HP", u.hp, 225, "hp")}
      ${bar("DMG", u.dmg.toFixed(1), 8.5, "dmg")}
      ${bar("SPD", u.speed.toFixed(2), 1.3, "spd")}
      <div class="inspect-move"><b>${u.move}</b><br>${this.moveBlurb(u.move)}</div>
      ${synHtml}
      ${evo}`;
  },

  render() {
    const g = window.game;
    if (!g) return;
    const cap = ECON.teamCap(g.round);
    const equipMode = this.selectedItem !== null && this.selectedItem !== undefined;

    this.el("round").textContent = `Stage ${g.round}/${ECON.maxRounds}`;
    this.el("hp-val").textContent = Math.max(0, g.hp);
    this.el("gold-val").textContent = g.gold;
    const st = g.streak;
    const streakEl = this.el("streak");
    streakEl.textContent = st > 0 ? `WIN ×${st}` : (st < 0 ? `LOSS ×${-st}` : "—");
    streakEl.className = "pill " + (st > 0 ? "streak-w" : (st < 0 ? "streak-l" : ""));
    this.el("phase-label").textContent = g.phaseLabel ||
      (g.phase === "battle-ending" ? "BATTLE" : g.phase.toUpperCase());

    /* ---------- shop ---------- */
    const owned = {};
    g.units.forEach(u => { if (u.star === 1) owned[u.key] = (owned[u.key] || 0) + 1; });
    const shopEl = this.el("shop-slots");
    shopEl.innerHTML = "";
    g.shop.forEach((key, i) => {
      const card = document.createElement("div");
      card.className = "shop-card" + (key ? "" : " empty");
      card.dataset.testid = `shop-slot-${i}`;
      if (key) {
        const u = UNITS[key];
        const afford = g.gold >= u.cost && g.units.length < ECON.benchCap;
        const have = owned[key] || 0;
        card.classList.toggle("cant", !afford || g.phase !== "plan");
        if (have === 2) card.classList.add("combine-ready");
        const scout = g.scoutReport();
        const counters = scout && typeMul(u.type, scout.domType) > 1;
        card.innerHTML = `
          <div class="sc-bubble"><img src="sprites/${key}.png" alt="${u.name}"></div>
          <div class="sc-name">${u.name}</div>
          <div class="sc-type" style="background:${TYPE_COLORS[u.type]}">${u.type}</div>
          <div class="sc-cost t${u.cost}"><img src="sprites/items/COIN.png" alt="">${u.cost}</div>
          <div class="sc-move">${u.move}</div>
          ${have > 0 ? `<div class="sc-owned${have === 2 ? " ready" : ""}">${have}/3</div>` : ""}
          ${counters ? `<div class="sc-counter">COUNTER!</div>` : ""}`;
        card.dataset.tip = have === 2 ? `Buy to combine ${u.name} ×3!` : `${u.move} — HP ${u.hp}`;
        card.onclick = () => g.buy(i);
        card.onmouseenter = () => this.setInspect(key);
      } else {
        card.innerHTML = `<div class="sc-sold">SOLD</div>`;
      }
      shopEl.appendChild(card);
    });
    const rr = this.el("reroll");
    const rc = g.rerollCost();
    rr.disabled = g.phase !== "plan" || g.gold < rc;
    rr.dataset.tip = g.gold < rc ? "Not enough gold!" :
      (rc < ECON.rerollCost ? "Discounted — hang in there!" : "Roll 5 new Pokémon");
    rr.innerHTML = `Reroll <img src="sprites/items/COIN.png" alt="" class="coin-s">${rc}`;

    /* ---------- team: FIGHTING + BENCH sections ---------- */
    const teamEl = this.el("team-list");
    teamEl.innerHTML = "";
    const addSection = (label, cls) => {
      const h = document.createElement("div");
      h.className = "team-section " + cls;
      h.textContent = label;
      teamEl.appendChild(h);
    };
    addSection(`BATTLE TEAM ${Math.min(g.units.length, cap)}/${cap}`, "sec-fight");
    if (!g.units.length) {
      const empty = document.createElement("div");
      empty.className = "team-empty muted";
      empty.textContent = "Buy Pokémon from the shop below!";
      teamEl.appendChild(empty);
    }
    g.units.forEach((u, i) => {
      if (i === cap) addSection(`BENCH ${g.units.length - cap}/${ECON.benchCap - cap}`, "sec-bench");
      const spec = UNITS[u.key];
      const fighting = i < cap;
      const canEquip = equipMode && !u.item;
      const row = document.createElement("div");
      row.className = "unit-row" + (fighting ? " fighting" : " benched") + (canEquip ? " equippable" : "") + (equipMode && u.item ? " equip-blocked" : "");
      row.dataset.testid = `unit-${i}`;
      row.innerHTML = `
        <div class="ur-bubble"><img src="sprites/${u.key}.png" alt="${spec.name}"></div>
        <div class="ur-info">
          <div class="ur-name">${spec.name}${u.star > 1 ? ' <span class="star">★</span>' : ""}${u.item ? ` <img class="ur-item" src="${ITEMS[u.item].sprite}" title="${ITEMS[u.item].name}: ${ITEMS[u.item].desc}" alt="${ITEMS[u.item].name}">` : ""}</div>
          <div class="ur-sub">${spec.move} · HP ${spec.hp}</div>
        </div>
        ${!fighting ? `<button class="mini up" data-testid="front-${i}" data-tip="Move to battle team">▲</button>` : (i > 0 ? `<button class="mini up" data-testid="front-${i}" data-tip="Move to front">▲</button>` : "")}
        <button class="mini sell" data-testid="sell-${i}" data-tip="Sell for ${u.sellValue} gold"><img src="sprites/items/COIN.png" alt="">${u.sellValue}</button>`;
      const upBtn = row.querySelector(`[data-testid="front-${i}"]`);
      if (upBtn) upBtn.onclick = (e) => { e.stopPropagation(); g.moveFront(i); };
      row.querySelector(`[data-testid="sell-${i}"]`).onclick = (e) => { e.stopPropagation(); g.sell(i); };
      row.onclick = () => {
        if (equipMode) {
          if (g.equip(this.selectedItem, i)) this.selectedItem = null;
          this.render();
        }
      };
      row.onmouseenter = () => this.setInspect(u.key);
      // drag & drop: reorder units, or receive a dragged item
      row.draggable = g.phase === "plan";
      row.ondragstart = (e) => {
        e.dataTransfer.setData("text/unit", String(i));
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
      };
      row.ondragend = () => row.classList.remove("dragging");
      row.ondragover = (e) => { e.preventDefault(); row.classList.add("drop-target"); };
      row.ondragleave = () => row.classList.remove("drop-target");
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove("drop-target");
        const itemIdx = e.dataTransfer.getData("text/item");
        const unitIdx = e.dataTransfer.getData("text/unit");
        if (itemIdx !== "") {
          if (g.equip(parseInt(itemIdx), i)) this.selectedItem = null;
          this.render();
        } else if (unitIdx !== "") {
          g.reorder(parseInt(unitIdx), i);
        }
      };
      teamEl.appendChild(row);
    });
    this.el("team-cap").textContent = "Team";

    /* ---------- synergy chips (battle team) ---------- */
    const synRow = this.el("synergy-row");
    if (synRow) {
      synRow.innerHTML = "";
      const syns = computeSynergies(g.fightingUnits());
      if (!syns.length) {
        synRow.innerHTML = `<span class="muted">type synergies appear here — 2 of a type activates a team buff</span>`;
      }
      for (const s of syns) {
        const chip = document.createElement("span");
        chip.className = "syn-chip big" + (s.tier ? " lit" : "");
        chip.style.background = TYPE_COLORS[s.type];
        chip.dataset.tip = `${SYNERGY[s.type].label}: ${SYNERGY[s.type].desc}`;
        chip.textContent = `${s.type.toUpperCase()} ${s.count}${s.tier ? "" : "/2"}`;
        synRow.appendChild(chip);
      }
    }

    /* ---------- income preview ---------- */
    const hint = document.querySelector(".reroll-hint");
    if (hint) {
      const p = g.incomePreview();
      hint.textContent = `next income +${p.total}${p.interest ? ` (${p.interest} interest)` : ""} · free refresh each stage`;
    }

    /* ---------- item inventory ---------- */
    const invEl = this.el("item-inv");
    invEl.innerHTML = "";
    if (!g.itemsInv.length) invEl.innerHTML = `<span class="muted">no items yet — win stages to earn them!</span>`;
    g.itemsInv.forEach((k, i) => {
      const b = document.createElement("button");
      b.className = "item-chip" + (this.selectedItem === i ? " selected" : "");
      b.dataset.testid = `inv-item-${i}`;
      b.dataset.tip = ITEMS[k].desc;
      b.innerHTML = `<img src="${ITEMS[k].sprite}" alt=""> ${ITEMS[k].name}`;
      b.onclick = () => { this.selectedItem = this.selectedItem === i ? null : i; this.render(); };
      b.draggable = true;
      b.ondragstart = (e) => {
        e.dataTransfer.setData("text/item", String(i));
        e.dataTransfer.effectAllowed = "move";
        // light up equippable rows WITHOUT re-rendering (a render would
        // destroy the dragged node and abort the drag)
        document.querySelectorAll("#team-list .unit-row").forEach((r, ri) => {
          if (g.units[ri] && !g.units[ri].item) r.classList.add("equippable");
          else r.classList.add("equip-blocked");
        });
      };
      b.ondragend = () => this.render();
      invEl.appendChild(b);
    });
    this.el("item-hint").style.display = equipMode ? "inline" : "none";

    /* ---------- buttons ---------- */
    const sb = this.el("start-battle");
    sb.disabled = g.phase !== "plan" || !g.fightingUnits().length;
    sb.textContent = g.readyLabel || "START BATTLE";
    this.el("speed-label").textContent = `${g.speedMul}x`;

    /* ---------- overlays ---------- */
    const resOv = this.el("result-overlay");
    if (g.phase === "result" || g.phase === "victory" || g.phase === "gameover") {
      resOv.style.display = "flex";
      const r = g.lastResult;
      const banner = this.el("result-banner");
      if (g.phase === "victory") {
        banner.textContent = "CHAMPION!";
        banner.className = "banner win";
      } else if (g.phase === "gameover") {
        banner.textContent = "GAME OVER";
        banner.className = "banner lose";
      } else {
        banner.textContent = r ? (r.won ? "VICTORY!" : (r.draw ? "DRAW" : "DEFEAT...")) : "STAGE RESULTS";
        banner.className = "banner " + (r && r.won ? "win" : "lose");
      }
      const det = this.el("result-detail");
      let html = "";
      const runOver = g.phase === "victory" || g.phase === "gameover";
      if (g.phase === "victory") html += `<div class="sub-line">You survived all ${ECON.maxRounds} stages!</div>`;
      if (r && !runOver) {
        if (r.trainer) html += `<div class="vs-line">vs ${r.trainer}</div>`;
        if (r.clutch) html += `<div class="clutch-line">CLUTCH! Won with one Pokémon barely standing!</div>`;
        if (r.mvp && r.mvp.dmg > 0) {
          html += `<div class="mvp-line"><img src="sprites/${r.mvp.key}.png" alt="">
            <b>${r.mvp.name}</b> — MVP · ${r.mvp.dmg} dmg${r.mvp.kos ? ` · ${r.mvp.kos} KO${r.mvp.kos > 1 ? "s" : ""}` : ""}</div>`;
        }
        html += r.lines.map(l => `<div>${l}</div>`).join("");
        if (r.dmgTaken) html += `<div class="dmg-line">You took ${r.dmgTaken} damage</div>`;
        html += `<div class="total-line">Total income: +${r.income} gold</div>`;
      }
      if (runOver) {
        // ---- RUN REPORT: the story of the whole run ----
        const entries = Object.entries(g.career)
          .map(([k, c]) => ({ key: k, ...c }))
          .sort((a, b) => b.dmg - a.dmg)
          .slice(0, 4);
        html += `<div class="report-head">RUN REPORT</div>`;
        html += `<div class="report-record">${g.totals.wins}W — ${g.totals.losses}L · ${g.totals.goldEarned} gold earned · reached stage ${g.round}</div>`;
        if (entries.length) {
          html += entries.map((e, i) => `
            <div class="report-row${i === 0 ? " top" : ""}">
              ${i === 0 ? '<span class="report-crown">★</span>' : `<span class="report-rank">${i + 1}</span>`}
              <img src="sprites/${e.key}.png" alt="">
              <span class="report-name">${UNITS[e.key] ? UNITS[e.key].name : e.key}</span>
              <span class="report-stats">${Math.round(e.dmg)} dmg · ${e.kos} KO${e.kos === 1 ? "" : "s"}${e.mvps ? ` · ${e.mvps}× MVP` : ""}</span>
            </div>`).join("");
        }
      }
      det.innerHTML = html;
      this.el("continue").style.display = (g.phase === "result" && !g.mp) ? "inline-block" : "none";
      this.el("new-game").style.display =
        ((g.phase === "victory" || g.phase === "gameover") && g.canRematch !== false) ? "inline-block" : "none";
    } else {
      resOv.style.display = "none";
    }

    const itemOv = this.el("item-overlay");
    if (g.phase === "item" && g.pendingItems) {
      itemOv.style.display = "flex";
      const box = this.el("item-choices");
      box.innerHTML = "";
      g.pendingItems.forEach((k, i) => {
        const c = document.createElement("div");
        c.className = "item-card";
        c.dataset.testid = `item-choice-${i}`;
        c.innerHTML = `<div class="ic-icon"><img src="${ITEMS[k].sprite}" alt=""></div>
                       <div class="ic-name">${ITEMS[k].name}</div>
                       <div class="ic-desc">${ITEMS[k].desc}</div>`;
        c.onclick = () => g.pickItem(i);
        box.appendChild(c);
      });
    } else {
      itemOv.style.display = "none";
    }

    this.renderInspect();
  },
};

/* ---------------- boot (singleplayer; mp.html sets MP_MODE and boots
 * its own adapter via js/mp.js instead) ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  if (window.MP_MODE) return;
  const params = new URLSearchParams(location.search);
  const seed = parseInt(params.get("seed")) || ((Math.random() * 1e9) | 0);
  ui.selectedItem = null;
  ui.init();
  window.game = new Game(seed);
  window.newGame = (s) => { window.game = new Game(s ?? ((Math.random() * 1e9) | 0)); ui.render(); };

  document.getElementById("reroll").onclick = () => game.reroll();
  document.getElementById("start-battle").onclick = () => game.startBattle();
  document.getElementById("continue").onclick = () => { SND.play("click"); game.continueFromResult(); };
  document.getElementById("new-game").onclick = () => { SND.play("click"); newGame(); };
  document.getElementById("speed-btn").onclick = () => {
    SND.play("click");
    const next = { 1: 2, 2: 4, 4: 8, 8: 16, 16: 1 }[game.speedMul] || 1;
    game.setSpeed(next);
  };
  const muteBtn = document.getElementById("mute-btn");
  const syncMute = () => {
    muteBtn.textContent = SND.muted ? "✕" : "♪";
    muteBtn.classList.toggle("off", SND.muted);
  };
  muteBtn.onclick = () => { SND.toggle(); if (!SND.muted) SND.play("click"); syncMute(); };
  syncMute();

  ui.render();
});
