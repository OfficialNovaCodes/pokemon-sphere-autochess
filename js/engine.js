/* ==========================================================================
 * Sphere battle engine — JS port of the pokemon_spheres.py sim core:
 * billiard physics (no gravity), seek steering, orbiting weapons, hit-charged
 * move meters, type chart, sudden-death ramp. Deterministic via seeded RNG.
 * ========================================================================== */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Fighter {
  constructor(unitKey, star, itemKey, team, rng, teamMods) {
    const u = UNITS[unitKey];
    const tm = teamMods || teamModsFrom([]);
    this.key = unitKey;
    this.star = star;                       // 1 or 2 (gold star for no-evo combines)
    this.item = itemKey ? ITEMS[itemKey] : null;
    this.itemKey = itemKey || null;
    this.team = team;                       // 0 = player, 1 = enemy
    this.name = u.name + (star > 1 ? " ★" : "");
    this.type = u.type;
    const hpMul = (star > 1 ? STAR_HP_MUL : 1) * tm.hpMul;
    const dmgMul = (star > 1 ? STAR_DMG_MUL : 1) * tm.dmgMul;
    this.maxhp = Math.round(u.hp * hpMul);
    this.hp = this.maxhp;
    this.dmg = u.dmg * dmgMul;
    this.speed = u.speed * tm.speedMul;
    this.r = u.r + (star > 1 ? 3 : 0);
    this.move = MOVES[u.move];
    this.moveName = u.move;
    this.dodge = Math.min(0.35, (u.dodge || 0) + tm.dodge);

    // team synergy mods (merged with item mods below)
    this.teamRegen = tm.regen;
    this.chargeMul = tm.chargeMul;
    this.cdMul = tm.cdMul;
    this.lifesteal = tm.lifesteal;
    this.thorns = tm.thorns;
    this.moveDmgMul = tm.moveDmgMul;
    this.executeMul = tm.executeMul;
    this.healMul = tm.healMul;
    this.poisonOnHit = tm.poisonOnHit;
    this.slowOnHit = tm.slowOnHit;

    // item static mods
    if (this.item) {
      if (this.item.dmgMul) this.dmg *= this.item.dmgMul;
      if (this.item.speedMul) this.speed *= this.item.speedMul;
      if (this.item.cdMul) this.cdMul *= this.item.cdMul;
      if (this.item.lifesteal) this.lifesteal += this.item.lifesteal;
      if (this.item.thorns) this.thorns += this.item.thorns;
    }

    // battle state
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.wAngle = rng() * Math.PI * 2;
    this.meleeCd = 0;
    this.charge = 0;
    this.alive = true;
    this.sleepT = 0;
    this.slowT = 0; this.slowMul = 1;
    this.poison = [];        // array of remaining-durations
    this.burnT = 0;
    this.buffT = 0; this.buffDmg = 1; this.buffSpd = 1;
    this.defMul = this.item && this.item.defMul ? this.item.defMul : 1;
    this.hardenStacks = 0;
    this.dashT = 0; this.dashTarget = null;
    this.launchT = 0;
    this.rechargeT = 0;
    this.sashUsed = false;
    this.growDmg = 0;        // Fury Cutter permanent growth (per battle)
    this.flail = this.move.kind === "flail";
    this.dmgDealt = 0;
    this.kos = 0;
  }

  gainCharge(amount) {
    this.charge = Math.min(this.move.cost, this.charge + amount * this.chargeMul);
  }

  effSpeed() {
    let s = this.speed * this.buffSpd;
    if (this.slowT > 0) s *= this.slowMul;
    return s;
  }

  effDmg(t) {
    let d = (this.dmg + this.growDmg) * this.buffDmg;
    if (this.flail && this.hp < this.maxhp * 0.4) d *= 1.8;
    return d;
  }
}

class Battle {
  /* teamA/teamB: arrays of {key, star, item} */
  constructor(teamA, teamB, seed) {
    this.rng = mulberry32(seed);
    this.t = 0;
    this.fighters = [];
    this.projectiles = [];
    this.hazards = [];      // stealth rocks etc: {x,y,r,dmg,team,ttl,spin}
    this.events = [];       // sound/event stream drained by the UI each frame
    this.corpses = [];      // KO'd mons fading out: {key,x,y,r,team,t}
    this.popups = [];
    this.flashes = [];      // move-name banners
    this.over = false;
    this.winner = null;     // 0 | 1 | "draw"
    this.log = [];
    this.synergies = [computeSynergies(teamA), computeSynergies(teamB)];
    const mods = [teamModsFrom(this.synergies[0]), teamModsFrom(this.synergies[1])];

    const W = SIM.arenaW, H = SIM.arenaH;
    const place = (units, team) => {
      units.forEach((u, i) => {
        const f = new Fighter(u.key, u.star, u.item, team, this.rng, mods[team]);
        const col = team === 0 ? 0.26 : 0.74;
        const n = units.length;
        f.x = W * col + (this.rng() - 0.5) * 40;
        f.y = H * ((i + 1) / (n + 1)) + (this.rng() - 0.5) * 30;
        const ang = (team === 0 ? 0 : Math.PI) + (this.rng() - 0.5) * 0.9;
        const v = SIM.baseVel * f.effSpeed();
        f.vx = Math.cos(ang) * v;
        f.vy = Math.sin(ang) * v;
        this.fighters.push(f);
      });
    };
    place(teamA, 0);
    place(teamB, 1);
  }

  /* real (non-minion) survivors — minions don't hold a team alive */
  living(team) { return this.fighters.filter(f => f.alive && f.team === team && !f.minion); }

  nearestEnemy(f) {
    let best = null, bd = 1e9;
    for (const e of this.fighters) {
      if (!e.alive || e.team === f.team) continue;
      const d = (e.x - f.x) ** 2 + (e.y - f.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  popup(x, y, text, color, big) {
    this.popups.push({ x, y, text, color, big: !!big, t: 1.1 });
  }

  emit(type) { if (this.events.length < 40) this.events.push(type); }

  dealDamage(src, dst, raw, isMove) {
    if (!dst.alive) return 0;
    let mul = typeMul(src.type, dst.type);
    if (mul > 1 && src.item && src.item.expertBelt) mul = 1.5;
    let d = raw * mul * dst.defMul * Math.pow(0.8, dst.hardenStacks);
    // dark synergy: bonus damage to weakened targets
    if (src.executeMul > 1 && dst.hp / dst.maxhp < 0.35) d *= src.executeMul;
    // sudden-death ramp applies to ALL damage (melee, moves, projectiles) —
    // lesson from the video engine: DoTs/heals must not outpace the ramp
    if (this.t > SIM.suddenDeathT) d *= 1 + SIM.suddenDeathRamp * (this.t - SIM.suddenDeathT);
    if (dst.sleepT > 0) { d *= 1.3; dst.sleepT = 0; }  // hits wake + hurt more
    d = Math.max(0.5, d);
    dst.hp -= d;
    src.dmgDealt += d;
    if (src.lifesteal > 0) {
      src.hp = Math.min(src.maxhp, src.hp + d * src.lifesteal * src.healMul);
    }
    if (!isMove && dst.thorns > 0) {
      src.hp -= dst.thorns;
      if (src.hp <= 0) this.tryKill(src, dst);
    }
    const col = mul > 1 ? "#ff8c1a" : (mul < 1 ? "#9aa0b0" : "#ffffff");
    this.popups.push({
      x: dst.x + (this.rng() - 0.5) * 18, y: dst.y - dst.r - 16,
      text: String(Math.round(d)), color: col, big: d >= 10, t: 1.1,
      miniBurst: mul > 1,   // super-effective sparkle
    });
    this.tryKill(dst, src);
    return d;
  }

  tryKill(f, killer) {
    if (f.hp > 0 || !f.alive) return;
    if (f.item && f.item.sash && !f.sashUsed) {
      f.sashUsed = true;
      f.hp = 1;
      this.popup(f.x, f.y - f.r - 30, "Focus Sash!", "#ffd700", true);
      return;
    }
    f.alive = false;
    f.hp = 0;
    if (killer) killer.kos += 1;
    this.corpses.push({ key: f.spriteKey || f.key, x: f.x, y: f.y, r: f.r, team: f.team, t: 0.5 });
    this.popups.push({ x: f.x, y: f.y, text: "KO!", color: "#ff3b30", big: true, t: 1.1, burst: true });
    this.emit(f.minion ? "minion-ko" : "ko");
    this.log.push(`${f.name} is KO'd!`);
  }

  castMove(f) {
    const m = f.move, tgt = this.nearestEnemy(f);
    if (!tgt) return;
    f.charge = 0;
    if (m.kind !== "flail") {
      this.flashes.push({ text: `${f.name}: ${f.moveName}!`, t: 1.3, team: f.team });
      this.emit("cast");
    }
    const t = this.t;
    switch (m.kind) {
      case "proj": {
        for (let i = 0; i < m.count; i++) {
          const spread = (i - (m.count - 1) / 2) * 0.22;
          const ang = Math.atan2(tgt.y - f.y, tgt.x - f.x) + spread;
          this.projectiles.push({
            x: f.x, y: f.y, vx: Math.cos(ang) * m.pspeed, vy: Math.sin(ang) * m.pspeed,
            dmg: m.dmg * (f.star > 1 ? STAR_DMG_MUL : 1) * f.buffDmg * f.moveDmgMul,
            src: f, homing: !!m.homing, slowMul: m.slowMul, slowDur: m.slowDur,
            color: TYPE_COLORS[f.type], t: 2.2, r: 8,
          });
        }
        if (m.recharge) f.rechargeT = m.recharge;
        break;
      }
      case "dash": {
        f.dashT = 0.4;
        f.dashTarget = tgt;
        f.dashDmg = m.dmg * (f.star > 1 ? STAR_DMG_MUL : 1) * f.moveDmgMul;
        f.dashArmor = m.armor;
        f.dashKb = m.kb || 0;
        const ang = Math.atan2(tgt.y - f.y, tgt.x - f.x);
        const v = 720;
        f.vx = Math.cos(ang) * v; f.vy = Math.sin(ang) * v;
        break;
      }
      case "buff":
        f.buffT = m.dur; f.buffDmg = m.dmgMul; f.buffSpd = m.speedMul || 1;
        break;
      case "grow":
        f.growDmg += m.dmgAdd;
        this.popup(f.x, f.y - f.r - 28, `DMG +${m.dmgAdd}`, "#7ee787", false);
        break;
      case "heal": {
        const amt = m.amount * (f.star > 1 ? 1.5 : 1) * f.healMul;
        f.hp = Math.min(f.maxhp, f.hp + amt);
        this.popup(f.x, f.y - f.r - 28, `+${Math.round(amt)}`, "#7ee787", true);
        break;
      }
      case "drain": {
        const d = this.dealDamage(f, tgt, m.dmg * (f.star > 1 ? STAR_DMG_MUL : 1) * f.moveDmgMul, true);
        f.hp = Math.min(f.maxhp, f.hp + d * m.healMul * f.healMul);
        this.popup(f.x, f.y - f.r - 28, `+${Math.round(d)}`, "#7ee787", false);
        break;
      }
      case "poison":
        for (let i = 0; i < m.stacks; i++) tgt.poison.push(4.0);
        this.popup(tgt.x, tgt.y - tgt.r - 28, "Poisoned!", "#a040a0", false);
        break;
      case "sleep":
        tgt.sleepT = m.dur;
        this.popup(tgt.x, tgt.y - tgt.r - 28, "Asleep!", "#f85888", false);
        break;
      case "slow":
        tgt.slowT = m.dur; tgt.slowMul = m.mul;
        this.popup(tgt.x, tgt.y - tgt.r - 28, "Slowed!", "#a8b820", false);
        break;
      case "aoe": {
        for (const e of this.fighters) {
          if (!e.alive || e.team === f.team) continue;
          const dist = Math.hypot(e.x - f.x, e.y - f.y);
          if (dist <= m.radius + e.r) {
            let dmg = m.dmg + (m.hpScale ? m.hpScale * (f.hp / f.maxhp) : 0);
            this.dealDamage(f, e, dmg * (f.star > 1 ? STAR_DMG_MUL : 1) * f.moveDmgMul, true);
            if (m.burn) e.burnT = m.burn;
          }
        }
        if (m.buffDef) { f.defMul *= m.buffDef; }
        this.flashes.push({ text: "", t: 0.35, team: f.team, ring: { x: f.x, y: f.y, r: Math.min(m.radius, 320), color: TYPE_COLORS[f.type] } });
        break;
      }
      case "harden":
        f.hardenStacks = Math.min(3, f.hardenStacks + 1);
        this.popup(f.x, f.y - f.r - 28, "Harden!", "#98d8d8", false);
        break;
      case "hazard": {
        // drop rocks in the enemy half of the arena
        const W2 = SIM.arenaW, H2 = SIM.arenaH;
        const enemySide = f.team === 0 ? [W2 * 0.5, W2 * 0.92] : [W2 * 0.08, W2 * 0.5];
        for (let i = 0; i < m.count; i++) {
          this.hazards.push({
            x: enemySide[0] + this.rng() * (enemySide[1] - enemySide[0]),
            y: 40 + this.rng() * (H2 - 80),
            r: 16, dmg: m.dmg * f.moveDmgMul * (f.star > 1 ? STAR_DMG_MUL : 1),
            pstacks: m.pstacks || 0,
            team: f.team, ttl: m.ttl, spin: this.rng() * Math.PI * 2,
          });
        }
        this.emit("hazard");
        // cap: max 9 rocks per team (oldest fade out first)
        const teamRocks = this.hazards.filter(h => h.team === f.team);
        if (teamRocks.length > 9) {
          teamRocks.slice(0, teamRocks.length - 9).forEach(h => { h.ttl = Math.min(h.ttl, 0.5); });
        }
        break;
      }
      case "summon": {
        const owned = this.fighters.filter(x => x.alive && x.minion && x.owner === f).length;
        const n = Math.min(m.count, m.cap - owned);
        for (let i = 0; i < n; i++) {
          const pet = new Fighter(f.key, 1, null, f.team, this.rng, null);
          pet.minion = true;
          pet.owner = f;
          pet.name = m.minion.name;
          pet.spriteKey = m.minion.sprite;
          pet.maxhp = m.minion.hp; pet.hp = m.minion.hp;
          pet.dmg = m.minion.dmg * f.moveDmgMul;
          pet.speed = m.minion.speed;
          pet.r = m.minion.r;
          pet.move = MOVES["Splash"];  // minions are melee-only (meter never fires)
          pet.moveName = "Splash";
          pet.flail = false;
          const a = this.rng() * Math.PI * 2;
          pet.x = Math.max(pet.r, Math.min(SIM.arenaW - pet.r, f.x + Math.cos(a) * (f.r + 30)));
          pet.y = Math.max(pet.r, Math.min(SIM.arenaH - pet.r, f.y + Math.sin(a) * (f.r + 30)));
          const v = SIM.baseVel * pet.speed;
          pet.vx = Math.cos(a) * v; pet.vy = Math.sin(a) * v;
          this.fighters.push(pet);
        }
        if (n > 0) {
          this.popup(f.x, f.y - f.r - 28, `+${n} ${m.minion.name}${n > 1 ? "s" : ""}!`, "#7ee787", false);
          this.emit("summon");
        }
        break;
      }
      case "flail":
        this.popup(f.x, f.y - f.r - 28, "...nothing happened!", "#c0c0c0", false);
        break;
    }
  }

  step(dt) {
    if (this.over) return;
    this.t += dt;
    const W = SIM.arenaW, H = SIM.arenaH;

    for (const f of this.fighters) {
      if (!f.alive) continue;

      // status ticks
      if (f.sleepT > 0) f.sleepT -= dt;
      if (f.slowT > 0) f.slowT -= dt;
      if (f.buffT > 0) { f.buffT -= dt; if (f.buffT <= 0) { f.buffDmg = 1; f.buffSpd = 1; } }
      if (f.rechargeT > 0) f.rechargeT -= dt;
      f.poison = f.poison.filter(p => p > 0);
      if (f.poison.length) {
        f.poison = f.poison.map(p => p - dt);
        f.hp -= f.poison.length * 1.0 * dt * (this.t > SIM.suddenDeathT ? 2 : 1);
        this.tryKill(f, null);
        if (!f.alive) continue;
      }
      if (f.burnT > 0) { f.burnT -= dt; f.hp -= 2 * dt; this.tryKill(f, null); if (!f.alive) continue; }
      const regen = (f.item && f.item.regen ? f.item.regen : 0) + f.teamRegen;
      if (regen > 0) f.hp = Math.min(f.maxhp, f.hp + regen * f.healMul * dt);
      if (f.item && f.item.selfDrain) { f.hp -= f.item.selfDrain * dt; this.tryKill(f, null); if (!f.alive) continue; }

      const stunned = f.sleepT > 0 || f.rechargeT > 0;

      // movement: seek steer toward nearest enemy (SEEK_RATE) unless dashing
      // or flying from a knockback (launchT = control loss, velocity persists)
      const tgt = this.nearestEnemy(f);
      if (f.launchT > 0) {
        f.launchT -= dt;
        f.vx *= 0.985; f.vy *= 0.985;
      } else if (f.dashT > 0) {
        f.dashT -= dt;
      } else if (tgt && !stunned) {
        const want = Math.atan2(tgt.y - f.y, tgt.x - f.x);
        const cur = Math.atan2(f.vy, f.vx);
        let diff = want - cur;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const turn = Math.max(-SIM.seekRate * dt, Math.min(SIM.seekRate * dt, diff));
        const na = cur + turn;
        const v = SIM.baseVel * f.effSpeed();
        f.vx = Math.cos(na) * v; f.vy = Math.sin(na) * v;
      }
      const slowFactor = stunned ? 0.25 : 1;
      f.x += f.vx * dt * slowFactor;
      f.y += f.vy * dt * slowFactor;

      // walls
      if (f.x < f.r) { f.x = f.r; f.vx = Math.abs(f.vx); }
      if (f.x > W - f.r) { f.x = W - f.r; f.vx = -Math.abs(f.vx); }
      if (f.y < f.r) { f.y = f.r; f.vy = Math.abs(f.vy); }
      if (f.y > H - f.r) { f.y = H - f.r; f.vy = -Math.abs(f.vy); }

      // weapon orbit + cooldowns
      f.wAngle += SIM.weaponOmega * f.effSpeed() * dt * (f.team === 0 ? 1 : -1);
      if (f.meleeCd > 0) f.meleeCd -= dt;
    }

    // ball-ball collisions (elastic swap along normal) + dash burst
    const alive = this.fighters.filter(f => f.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy), min = a.r + b.r;
        if (dist < min && dist > 0.001) {
          const nx = dx / dist, ny = dy / dist;
          const overlap = (min - dist) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const avn = a.vx * nx + a.vy * ny, bvn = b.vx * nx + b.vy * ny;
          if (avn - bvn > 0) {
            const d = avn - bvn;
            a.vx -= d * nx; a.vy -= d * ny;
            b.vx += d * nx; b.vy += d * ny;
          }
          // dash contact burst
          if (a.team !== b.team) {
            if (a.dashT > 0 && a.dashTarget) {
              this.dealDamage(a, b, a.dashDmg, true);
              if (a.dashArmor) a.defMul *= a.dashArmor;
              if (a.dashKb) {  // launch the victim (walls bounce them back)
                b.vx += nx * a.dashKb; b.vy += ny * a.dashKb;
                b.launchT = 0.55;
                this.popup(b.x, b.y - b.r - 30, "LAUNCHED!", "#ffcc2e", false);
                this.emit("launch");
              }
              a.dashT = 0;
            } else if (b.dashT > 0 && b.dashTarget) {
              this.dealDamage(b, a, b.dashDmg, true);
              if (b.dashArmor) b.defMul *= b.dashArmor;
              if (b.dashKb) {
                a.vx -= nx * b.dashKb; a.vy -= ny * b.dashKb;
                a.launchT = 0.55;
                this.popup(a.x, a.y - a.r - 30, "LAUNCHED!", "#ffcc2e", false);
                this.emit("launch");
              }
              b.dashT = 0;
            }
            // clang charge
            a.gainCharge(0.25);
            b.gainCharge(0.25);
          }
        }
      }
    }

    // melee: weapon tip vs enemy body
    for (const f of alive) {
      if (!f.alive || f.meleeCd > 0 || f.sleepT > 0 || f.rechargeT > 0) continue;
      const tipX = f.x + Math.cos(f.wAngle) * (f.r + SIM.weaponLen);
      const tipY = f.y + Math.sin(f.wAngle) * (f.r + SIM.weaponLen);
      for (const e of alive) {
        if (!e.alive || e.team === f.team) continue;
        const d = Math.hypot(e.x - tipX, e.y - tipY);
        if (d <= e.r + SIM.tipR) {
          if (e.dodge && this.rng() < e.dodge) {
            // dodge (teleport/foresight) — attacker still gains charge
            const na = this.rng() * Math.PI * 2;
            e.x = Math.max(e.r, Math.min(W - e.r, e.x + Math.cos(na) * 130));
            e.y = Math.max(e.r, Math.min(H - e.r, e.y + Math.sin(na) * 130));
            this.popup(e.x, e.y - e.r - 16, "Dodge!", "#f85888", false);
            f.gainCharge(0.5);
          } else {
            this.dealDamage(f, e, f.effDmg(this.t), false);
            this.emit("hit");
            f.gainCharge(SIM.chargeOnHit);
            e.gainCharge(SIM.chargeOnTaken);
            // synergy on-hit riders
            if (f.poisonOnHit > 0 && this.rng() < f.poisonOnHit) {
              e.poison.push(4.0);
              this.popup(e.x, e.y - e.r - 28, "Poisoned!", "#a040a0", false);
            }
            if (f.slowOnHit > 0 && this.rng() < f.slowOnHit) {
              e.slowT = 1.6; e.slowMul = 0.6;
              this.popup(e.x, e.y - e.r - 28, "Chilled!", "#98d8d8", false);
            }
          }
          f.meleeCd = SIM.hitCooldown * f.cdMul;
          break;
        }
      }
    }

    // cast moves at full charge
    for (const f of alive) {
      if (f.alive && f.charge >= f.move.cost && f.sleepT <= 0 && f.rechargeT <= 0) {
        this.castMove(f);
      }
    }

    // projectiles
    for (const p of this.projectiles) {
      p.t -= dt;
      if (p.homing && p.src.alive) {
        const tgt = this.nearestEnemy(p.src);
        if (tgt) {
          const want = Math.atan2(tgt.y - p.y, tgt.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let diff = want - cur;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          const sp = Math.hypot(p.vx, p.vy);
          const na = cur + Math.max(-3 * dt, Math.min(3 * dt, diff));
          p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      for (const e of this.fighters) {
        if (!e.alive || e.team === p.src.team) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) <= e.r + p.r) {
          this.dealDamage(p.src, e, p.dmg, true);
          if (p.slowMul) { e.slowT = p.slowDur; e.slowMul = p.slowMul; }
          p.t = 0;
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter(p =>
      p.t > 0 && p.x > -40 && p.x < W + 40 && p.y > -40 && p.y < H + 40);

    // hazards: one-shot damage when an enemy touches them
    for (const hz of this.hazards) {
      hz.ttl -= dt;
      hz.spin += dt * 1.5;
      if (hz.ttl <= 0) continue;
      for (const f of this.fighters) {
        if (!f.alive || f.team === hz.team) continue;
        if (Math.hypot(f.x - hz.x, f.y - hz.y) <= f.r + hz.r) {
          const hzType = hz.pstacks ? "poison" : "rock";
          let d = hz.dmg * typeMul(hzType, f.type) * f.defMul;
          if (this.t > SIM.suddenDeathT) d *= 1 + SIM.suddenDeathRamp * (this.t - SIM.suddenDeathT);
          f.hp -= d;
          if (hz.pstacks) {
            for (let i = 0; i < hz.pstacks; i++) f.poison.push(4.0);
            this.popup(f.x, f.y - f.r - 16, "Poisoned!", "#a040a0", false);
          } else {
            this.popup(f.x, f.y - f.r - 16, String(Math.round(d)), "#b8a038", false);
            this.popup(hz.x, hz.y - 22, "Rocks!", "#b8a038", false);
          }
          this.emit("hazard-hit");
          this.tryKill(f, null);
          hz.ttl = 0;
          break;
        }
      }
    }
    this.hazards = this.hazards.filter(h => h.ttl > 0);

    // corpses fade out
    for (const c of this.corpses) c.t -= dt;
    this.corpses = this.corpses.filter(c => c.t > 0);

    // popups/flashes
    for (const p of this.popups) { p.t -= dt; p.y -= 28 * dt; }
    this.popups = this.popups.filter(p => p.t > 0);
    for (const fl of this.flashes) fl.t -= dt;
    this.flashes = this.flashes.filter(fl => fl.t > 0);

    // end conditions
    const a0 = this.living(0), a1 = this.living(1);
    if (a0.length === 0 || a1.length === 0) {
      this.over = true;
      this.winner = a0.length === 0 ? (a1.length === 0 ? "draw" : 1) : 0;
    } else if (this.t >= SIM.timeout) {
      const frac = (team) => this.living(team).reduce((s, f) => s + f.hp / f.maxhp, 0);
      this.over = true;
      const f0 = frac(0), f1 = frac(1);
      this.winner = f0 === f1 ? "draw" : (f0 > f1 ? 0 : 1);
    }
  }
}

/* ==========================================================================
 * Renderer — medievalspheres flat-pastel look: sand bg, floor, stone border
 * ========================================================================== */
class BattleRenderer {
  constructor(canvas, sprites, itemSprites) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.sprites = sprites;           // {unitKey: Image}
    this.itemSprites = itemSprites || {};  // {itemKey: Image}
    this.shakeAmp = 0;                // screen shake (decays per frame)
    this.confetti = [];               // celebration particles
    this.lastFrame = 0;
  }

  shake(amp) { this.shakeAmp = Math.max(this.shakeAmp, amp); }

  startConfetti() {
    const colors = ["#ffcc2e", "#1fa7e0", "#f571b0", "#43c93e", "#ff9f1c"];
    for (let i = 0; i < 90; i++) {
      this.confetti.push({
        x: Math.random() * SIM.arenaW,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 90,
        vy: 140 + Math.random() * 160,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 9,
        w: 7 + Math.random() * 7, h: 5 + Math.random() * 5,
        color: colors[i % colors.length],
        t: 2.6,
      });
    }
  }

  /* five-point star path */
  starPath(cx, cy, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* jagged comic burst (for KOs) */
  burstPath(cx, cy, r, points) {
    const ctx = this.ctx;
    ctx.beginPath();
    const n = (points || 9) * 2;
    for (let i = 0; i < n; i++) {
      const rad = i % 2 === 0 ? r : r * 0.55;
      const a = (i * Math.PI * 2) / n - Math.PI / 2;
      const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /* rounded-rect path helper */
  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  drawField() {
    // Trozei play field: pale mint, faint teal grid, big swirl watermark,
    // dashed teal center line (refs: Bulbanews Trozei screenshots)
    const ctx = this.ctx, W = SIM.arenaW, H = SIM.arenaH;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ecfaf6";
    ctx.fillRect(0, 0, W, H);

    // swirl watermark bottom-left (concentric spiral arcs)
    ctx.strokeStyle = "rgba(18,161,146,0.10)";
    ctx.lineCap = "round";
    const sx = 90, sy = H - 70;
    [[34, 24, 0.2, 1.75], [86, 30, 0.55, 2.1], [148, 36, 0.9, 2.45], [214, 42, 1.25, 2.8]].forEach(([r, w, a0, a1]) => {
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(sx, sy, r, a0 * Math.PI, a1 * Math.PI); ctx.stroke();
    });

    // faint grid
    ctx.strokeStyle = "rgba(18,161,146,0.14)";
    ctx.lineWidth = 1.5;
    for (let x = 46; x < W; x += 46) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 46; y < H; y += 46) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // center line
    ctx.strokeStyle = "rgba(18,161,146,0.45)";
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 12]);
    ctx.beginPath(); ctx.moveTo(W / 2, 14); ctx.lineTo(W / 2, H - 14); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* trozei bubble text on canvas: thick white outline + colored fill */
  bubbleText(text, x, y, size, color, align) {
    const ctx = this.ctx;
    ctx.font = `700 ${size}px 'Lilita One', Poppins, sans-serif`;
    ctx.textAlign = align || "center";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(4, size * 0.28);
    ctx.strokeText(text, x, y);
    ctx.strokeStyle = "rgba(0,60,52,0.25)";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.textAlign = "left";
  }

  draw(battle, banner) {
    const ctx = this.ctx, W = SIM.arenaW, H = SIM.arenaH;
    const now = performance.now();
    const fdt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
    this.lastFrame = now;

    // screen shake wraps the whole frame
    ctx.save();
    if (this.shakeAmp > 0.3) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmp, (Math.random() - 0.5) * this.shakeAmp);
      this.shakeAmp *= 0.86;
    } else this.shakeAmp = 0;

    this.drawField();

    // hazards (stealth rocks): tumbling gray polygons with team tint ring
    for (const hz of battle.hazards) {
      ctx.save();
      ctx.translate(hz.x, hz.y);
      ctx.rotate(hz.spin);
      ctx.globalAlpha = Math.min(1, hz.ttl / 1.5);
      ctx.fillStyle = hz.pstacks ? "#a066b8" : "#9b968c";
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = hz.r * (0.75 + 0.35 * ((i * 37) % 10) / 10);
        i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hz.team === 0 ? "#43c93e" : "#f571b0";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // aoe rings
    for (const fl of battle.flashes) {
      if (fl.ring) {
        ctx.strokeStyle = fl.ring.color;
        ctx.globalAlpha = Math.max(0, fl.t / 0.35) * 0.7;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(fl.ring.x, fl.ring.y, fl.ring.r * (1 - fl.t / 0.35 + 0.15), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // KO'd mons: shrink, spin and fade instead of vanishing
    for (const c of battle.corpses) {
      const k = c.t / 0.5;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate((1 - k) * 2.6);
      ctx.globalAlpha = k * 0.9;
      const img = this.sprites[c.key];
      const s = c.r * 2 * (0.4 + 0.6 * k);
      if (img && img.complete) ctx.drawImage(img, -s / 2, -s / 2, s, s);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // fighters
    for (const f of battle.fighters) {
      if (!f.alive) continue;
      const teamCol = f.team === 0 ? "#43c93e" : "#f571b0";  // trozei green / pink

      // weapon (rounded blade line to orbiting tip)
      const tipX = f.x + Math.cos(f.wAngle) * (f.r + SIM.weaponLen);
      const tipY = f.y + Math.sin(f.wAngle) * (f.r + SIM.weaponLen);
      ctx.strokeStyle = "#0a6459";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(f.x + Math.cos(f.wAngle) * f.r * 0.7, f.y + Math.sin(f.wAngle) * f.r * 0.7);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = TYPE_COLORS[f.type];
      ctx.beginPath(); ctx.arc(tipX, tipY, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5; ctx.stroke();

      // trozei style: sprite sits bare on the grid; soft team shadow + thin ring
      ctx.fillStyle = f.team === 0 ? "rgba(67,201,62,0.28)" : "rgba(245,113,176,0.30)";
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + f.r * 0.82, f.r * 0.95, f.r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = teamCol;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 2, 0, Math.PI * 2); ctx.stroke();

      // sprite (or fallback circle)
      const img = this.sprites[f.spriteKey || f.key];
      if (img && img.complete) {
        const s = f.r * 2;
        if (f.sleepT > 0) ctx.globalAlpha = 0.55;
        ctx.drawImage(img, f.x - s / 2, f.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = TYPE_COLORS[f.type];
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }

      // status tints
      if (f.poison.length) {
        ctx.fillStyle = "rgba(160,64,160,0.30)";
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      if (f.burnT > 0) {
        ctx.fillStyle = "rgba(240,128,48,0.30)";
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }

      // charge-ready telegraph: pulsing gold ring = move is about to fire
      if (f.charge >= f.move.cost - 0.001 && f.move.kind !== "flail") {
        const pulse = 2 + Math.sin(now / 90) * 2;
        ctx.strokeStyle = "#ffcc2e";
        ctx.lineWidth = 3.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 7 + pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // star badge (drawn gold star)
      if (f.star > 1) {
        this.starPath(f.x + f.r - 6, f.y - f.r + 4, 9);
        ctx.fillStyle = "#ffcc2e"; ctx.fill();
        ctx.strokeStyle = "#8a6200"; ctx.lineWidth = 2; ctx.stroke();
      }
      // held item badge (real sprite)
      if (f.itemKey && this.itemSprites[f.itemKey] && this.itemSprites[f.itemKey].complete) {
        const iw = 20;
        ctx.drawImage(this.itemSprites[f.itemKey], f.x - f.r - 6, f.y - f.r - 4, iw, iw);
      }

      // HP bar above — width proportional to maxhp (Joel's layout), rounded
      const bw = Math.max(34, f.maxhp * 0.42);
      const bx = f.x - bw / 2, by = f.y - f.r - 15;
      ctx.fillStyle = "rgba(10,100,89,0.85)";
      this.rr(bx - 2, by - 2, bw + 4, 12, 6); ctx.fill();
      ctx.fillStyle = f.hp / f.maxhp > 0.45 ? "#43c93e" : (f.hp / f.maxhp > 0.2 ? "#ffcc2e" : "#f571b0");
      this.rr(bx, by, Math.max(4, bw * Math.max(0, f.hp / f.maxhp)), 5, 2.5); ctx.fill();
      // charge meter
      ctx.fillStyle = "#1fa7e0";
      this.rr(bx, by + 6, Math.max(0.01, bw * Math.min(1, f.charge / f.move.cost)), 3, 1.5); ctx.fill();

      // HP number below — trozei blue bubble numeral
      this.bubbleText(String(Math.max(0, Math.round(f.hp))), f.x, f.y + f.r + 19, 15, "#1fa7e0");
    }

    // projectiles — candy orbs with white outline
    for (const p of battle.projectiles) {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.32, 0, Math.PI * 2); ctx.fill();
    }

    // popups — trozei bubble text (blue dmg, orange super, pink KO)
    for (const p of battle.popups) {
      ctx.globalAlpha = Math.min(1, p.t * 2);
      let col = p.color;
      if (col === "#ffffff") col = "#1fa7e0";
      if (col === "#ff3b30") col = "#f571b0";
      if (col === "#9aa0b0") col = "#8fa8b5";
      if (p.burst) {
        // comic burst flash behind KO text
        const scale = 1 + (1.1 - p.t) * 0.5;
        this.burstPath(p.x, p.y - 6, 44 * scale, 9);
        ctx.fillStyle = "#ffcc2e"; ctx.fill();
        ctx.strokeStyle = "#f571b0"; ctx.lineWidth = 4; ctx.stroke();
      } else if (p.miniBurst) {
        // small gold sparkle behind super-effective numbers
        this.burstPath(p.x, p.y - 5, 20, 7);
        ctx.fillStyle = "rgba(255,204,46,0.85)"; ctx.fill();
      }
      this.bubbleText(p.text, p.x, p.y, p.big ? 23 : 16, col);
      ctx.globalAlpha = 1;
    }

    // move banners
    let bi = 0;
    for (const fl of battle.flashes) {
      if (!fl.text) continue;
      ctx.globalAlpha = Math.min(1, fl.t);
      this.bubbleText(fl.text, W / 2, 38 + bi * 27, 17, fl.team === 0 ? "#43c93e" : "#f571b0");
      ctx.globalAlpha = 1;
      bi++;
    }

    // timer / sudden death
    const sd = battle.t > SIM.suddenDeathT;
    const label = sd ? `SUDDEN DEATH ${battle.t.toFixed(0)}s` : `${battle.t.toFixed(0)}s`;
    this.bubbleText(label, W / 2, H - 18, 15, sd ? "#f571b0" : "#12a192");

    // live team HP totals — who's winning, at a glance
    const teamFrac = (team) => {
      const fs = battle.fighters.filter(f => f.team === team && !f.minion);
      if (!fs.length) return 0;
      return fs.reduce((s, f) => s + (f.alive ? f.hp / f.maxhp : 0), 0) / fs.length;
    };
    const barW = 240, barY = 10;
    const drawTeamBar = (frac, x, col, align) => {
      ctx.fillStyle = "rgba(10,100,89,0.75)";
      this.rr(x - 2, barY - 2, barW + 4, 14, 7); ctx.fill();
      const w = Math.max(3, barW * frac);
      ctx.fillStyle = col;
      this.rr(align === "right" ? x + barW - w : x, barY, w, 10, 5); ctx.fill();
    };
    drawTeamBar(teamFrac(0), 14, "#43c93e", "left");
    drawTeamBar(teamFrac(1), W - barW - 14, "#f571b0", "right");

    // end-of-battle banner + confetti (during the battle-ending hold)
    if (banner) {
      ctx.fillStyle = "rgba(10, 60, 54, 0.35)";
      ctx.fillRect(0, 0, W, H);
      this.bubbleText(banner.text, W / 2, H / 2 - 10, 52, banner.color);
      if (banner.sub) this.bubbleText(banner.sub, W / 2, H / 2 + 34, 20, "#ffffff");
    }
    if (this.confetti.length) {
      for (const c of this.confetti) {
        c.t -= fdt;
        c.x += c.vx * fdt; c.y += c.vy * fdt; c.rot += c.vrot * fdt;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.globalAlpha = Math.min(1, c.t);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      this.confetti = this.confetti.filter(c => c.t > 0 && c.y < H + 30);
    }

    ctx.restore();  // shake transform
  }

  /* small gold plaque (trozei "Remaining"-style) */
  goldPlaque(x, y, w, h) {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "#ffe372");
    grad.addColorStop(0.55, "#ffcc2e");
    grad.addColorStop(1, "#e0a616");
    ctx.fillStyle = grad;
    this.rr(x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = "#8a6200"; ctx.lineWidth = 3;
    this.rr(x, y, w, h, 10); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2;
    this.rr(x + 3, y + 3, w - 6, h - 6, 7); ctx.stroke();
  }

  /* small synergy chip row under a team header */
  drawSynergyChips(synergies, cx, y) {
    const ctx = this.ctx;
    const chips = synergies.slice(0, 5);
    const cw = 74, gap = 6;
    const total = chips.length * cw + (chips.length - 1) * gap;
    let x = cx - total / 2;
    for (const s of chips) {
      const lit = s.tier > 0;
      ctx.globalAlpha = lit ? 1 : 0.45;
      ctx.fillStyle = TYPE_COLORS[s.type];
      this.rr(x, y, cw, 22, 11); ctx.fill();
      if (lit) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5;
        this.rr(x, y, cw, 22, 11); ctx.stroke();
      }
      ctx.fillStyle = "#fff";
      ctx.font = "700 11px 'Lilita One', Poppins, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(`${s.type.toUpperCase()} ${s.count}`, x + cw / 2, y + 12);
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 1;
      x += cw + gap;
    }
  }

  /* Planning-phase preview: stage/trainer banner + synergy chips + rosters */
  drawPreview(playerUnits, enemyUnits, meta) {
    const ctx = this.ctx, W = SIM.arenaW, H = SIM.arenaH;
    this.drawField();
    meta = meta || {};

    // stage / trainer banner
    const title = meta.trainer ? `STAGE ${meta.stage} — ${meta.trainer}` : "GET READY!";
    this.goldPlaque(W / 2 - 220, 12, 440, 42);
    ctx.textBaseline = "middle";
    this.bubbleText(title, W / 2, 35, 19, meta.boss ? "#d24d8e" : "#0d6fb8");
    ctx.textBaseline = "alphabetic";

    // scouting tip: dominant enemy type + counters (teaches the type chart)
    if (meta.scout) {
      const s = meta.scout;
      const tip = `They lean ${s.domType.toUpperCase()} — ${s.counters.map(c => c.toUpperCase()).join(" / ")} hit${s.counters.length === 1 ? "s" : ""} it hard!`;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 12.5px Poppins, sans-serif";
      const tw = ctx.measureText(tip).width + 26;
      this.rr(W / 2 - tw / 2, 58, tw, 24, 12); ctx.fill();
      ctx.strokeStyle = TYPE_COLORS[s.domType]; ctx.lineWidth = 2.5;
      this.rr(W / 2 - tw / 2, 58, tw, 24, 12); ctx.stroke();
      ctx.fillStyle = "#0a6459";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(tip, W / 2, 71);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
    }

    const drawSide = (units, team) => {
      const cx = team === 0 ? W * 0.25 : W * 0.75;
      const col = team === 0 ? "#43c93e" : "#f571b0";
      // side header: bubble label + synergy chips
      ctx.textBaseline = "middle";
      this.bubbleText(team === 0 ? "YOUR TEAM" : "ENEMY TEAM", cx, 96, 16, team === 0 ? "#2e9e2a" : "#d24d8e");
      ctx.textBaseline = "alphabetic";
      const syn = team === 0 ? (meta.synA || []) : (meta.synB || []);
      this.drawSynergyChips(syn, cx, 110);

      // mons standing on the field at their battle spawn spots, idle-bobbing
      const now = performance.now();
      const fieldX = team === 0 ? W * 0.26 : W * 0.74;
      const n = units.length;
      units.forEach((u, i) => {
        const unit = UNITS[u.key];
        const r = Math.min(34, unit.r + (u.star > 1 ? 3 : 0));
        const y0 = 150 + ((H - 190) * (i + 1)) / (n + 1);
        const bob = Math.sin(now / 320 + i * 1.7) * 4;
        const x = fieldX + (team === 0 ? -1 : 1) * (i % 2) * 46;
        const y = y0 + bob;
        // soft team shadow (stays put while the mon bobs)
        ctx.fillStyle = team === 0 ? "rgba(67,201,62,0.28)" : "rgba(245,113,176,0.30)";
        ctx.beginPath(); ctx.ellipse(x, y0 + r * 0.85, r * 0.95, r * 0.32, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke();
        const img = this.sprites[u.key];
        if (img && img.complete) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
        // star + item badges
        if (u.star > 1) {
          this.starPath(x + r - 5, y - r + 4, 9);
          ctx.fillStyle = "#ffcc2e"; ctx.fill();
          ctx.strokeStyle = "#8a6200"; ctx.lineWidth = 2; ctx.stroke();
        }
        if (u.item && this.itemSprites[u.item] && this.itemSprites[u.item].complete) {
          ctx.drawImage(this.itemSprites[u.item], x - r - 8, y - r - 4, 20, 20);
        }
        // name + hp under the mon
        ctx.font = "700 13px 'Lilita One', Poppins, sans-serif";
        ctx.textAlign = "center";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 4;
        ctx.strokeText(unit.name, x, y0 + r + 20);
        ctx.fillStyle = "#0a6459";
        ctx.fillText(unit.name, x, y0 + r + 20);
        ctx.font = "700 10.5px Poppins, sans-serif";
        ctx.fillStyle = "#4c9a8f";
        ctx.fillText(`HP ${unit.hp}`, x, y0 + r + 33);
      });
      if (!units.length) {
        ctx.fillStyle = "#fff9e4";
        this.rr(cx - 130, 150, 260, 44, 12); ctx.fill();
        ctx.strokeStyle = "#12a192"; ctx.lineWidth = 2.5;
        this.rr(cx - 130, 150, 260, 44, 12); ctx.stroke();
        ctx.fillStyle = "#4c9a8f";
        ctx.font = "700 14px Poppins, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(team === 0 ? "no units — buy from the shop!" : "scouting...", cx, 177);
      }
    };
    drawSide(playerUnits, 0);
    drawSide(enemyUnits, 1);
    ctx.textAlign = "left";
  }
}
