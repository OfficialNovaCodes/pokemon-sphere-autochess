/* ==========================================================================
 * Procedural WebAudio sound engine — no audio files, everything synthesized.
 * Chiptune voices (square/triangle/noise) in the spirit of the ball-physics
 * project's SFX kit. AudioContext starts lazily on first user gesture.
 * ========================================================================== */

const SND = {
  ctx: null,
  master: null,
  musicGain: null,
  muted: localStorage.getItem("psac-muted") === "1",
  lastHit: 0,
  musicTimer: null,
  musicStep: 0,

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      return true;
    } catch (e) {
      return false;
    }
  },

  setMuted(m) {
    this.muted = m;
    localStorage.setItem("psac-muted", m ? "1" : "0");
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },
  toggle() { this.setMuted(!this.muted); return this.muted; },

  /* one oscillator blip */
  tone(freq, dur, type, vol, when, slideTo, dest) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (when || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  /* short noise burst (percussion/impacts) */
  noise(dur, vol, when, hp) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (when || 0);
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol || 0.15;
    let node = src;
    if (hp) {
      const f = this.ctx.createBiquadFilter();
      f.type = "highpass"; f.frequency.value = hp;
      src.connect(f); node = f;
    }
    node.connect(g); g.connect(this.master);
    src.start(t0);
  },

  /* ---------------- named SFX ---------------- */
  play(name) {
    if (this.muted || !this.ensure()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const now = performance.now();
    switch (name) {
      case "hit":       // throttled — battles produce many
        if (now - this.lastHit < 85) return;
        this.lastHit = now;
        this.tone(160 + Math.random() * 120, 0.07, "square", 0.10, 0, 90);
        this.noise(0.04, 0.10, 0, 1200);
        break;
      case "clang":
        this.tone(700 + Math.random() * 300, 0.05, "triangle", 0.06);
        break;
      case "ko":        // crack + falling pitch + thump (video engine's KO)
        this.noise(0.08, 0.3, 0, 400);
        this.tone(220, 0.35, "square", 0.22, 0.02, 30);
        this.noise(0.1, 0.25, 0.22);
        break;
      case "minion-ko":
        this.tone(500, 0.1, "square", 0.1, 0, 200);
        break;
      case "cast":
        this.tone(520, 0.06, "square", 0.1);
        this.tone(780, 0.08, "square", 0.1, 0.06);
        break;
      case "launch":
        this.tone(200, 0.28, "sawtooth", 0.14, 0, 900);
        break;
      case "summon":
        this.tone(660, 0.07, "triangle", 0.12);
        this.tone(880, 0.07, "triangle", 0.12, 0.07);
        this.tone(1100, 0.1, "triangle", 0.12, 0.14);
        break;
      case "hazard":
        this.noise(0.12, 0.15, 0, 300);
        this.tone(120, 0.12, "triangle", 0.12, 0.02, 70);
        break;
      case "hazard-hit":
        this.noise(0.06, 0.18, 0, 800);
        break;
      case "dodge":
        this.tone(900, 0.09, "sine", 0.09, 0, 1500);
        break;
      case "buy":
        this.tone(880, 0.06, "square", 0.14);
        this.tone(1320, 0.09, "square", 0.14, 0.05);
        break;
      case "sell":
        this.tone(660, 0.06, "square", 0.12);
        this.tone(440, 0.09, "square", 0.12, 0.05);
        break;
      case "reroll":
        this.noise(0.05, 0.12, 0, 2000);
        this.tone(500, 0.05, "triangle", 0.1, 0.03, 700);
        break;
      case "equip":
        this.tone(700, 0.07, "triangle", 0.13);
        this.tone(1050, 0.1, "triangle", 0.13, 0.06);
        break;
      case "evolve": {  // ascending sparkle jingle
        const seq = [523, 659, 784, 1047, 1319];
        seq.forEach((f, i) => this.tone(f, 0.14, "square", 0.14, i * 0.08));
        this.tone(1568, 0.3, "square", 0.14, seq.length * 0.08);
        break;
      }
      case "item":
        this.tone(784, 0.08, "triangle", 0.13);
        this.tone(988, 0.08, "triangle", 0.13, 0.07);
        this.tone(1175, 0.12, "triangle", 0.13, 0.14);
        break;
      case "battle-start":
        this.tone(392, 0.09, "square", 0.16);
        this.tone(523, 0.09, "square", 0.16, 0.09);
        this.tone(659, 0.16, "square", 0.16, 0.18);
        break;
      case "win": {     // little victory fanfare
        const seq = [[523, 0], [523, 0.12], [523, 0.24], [659, 0.36], [784, 0.6]];
        seq.forEach(([f, w]) => this.tone(f, 0.18, "square", 0.16, w));
        this.tone(1047, 0.5, "square", 0.16, 0.78);
        break;
      }
      case "lose":
        this.tone(392, 0.3, "square", 0.14);
        this.tone(330, 0.3, "square", 0.14, 0.28);
        this.tone(262, 0.55, "square", 0.14, 0.56);
        break;
      case "champion": {
        const seq = [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.52], [1047, 0.64], [1319, 0.8]];
        seq.forEach(([f, w]) => this.tone(f, 0.2, "square", 0.17, w));
        this.tone(1568, 0.8, "square", 0.16, 1.0);
        break;
      }
      case "click":
        this.tone(600, 0.04, "square", 0.07);
        break;
    }
  },

  /* --------------- battle music: original 8-bar chiptune loop ------------ */
  /* two channels: square lead + triangle bass, 150bpm 16ths                 */
  LEAD: [
    659, 0, 784, 659, 587, 0, 659, 0, 523, 0, 587, 523, 494, 0, 523, 0,
    659, 0, 784, 880, 988, 0, 880, 784, 659, 0, 587, 0, 523, 0, 0, 0,
    659, 0, 784, 659, 587, 0, 659, 0, 523, 0, 587, 523, 494, 0, 523, 0,
    440, 0, 494, 523, 587, 659, 587, 523, 494, 0, 440, 0, 392, 0, 0, 0,
  ],
  BASS: [
    131, 0, 131, 0, 98, 0, 98, 0, 110, 0, 110, 0, 123, 0, 123, 0,
    131, 0, 131, 0, 98, 0, 98, 0, 110, 0, 123, 0, 131, 0, 131, 0,
    131, 0, 131, 0, 98, 0, 98, 0, 110, 0, 110, 0, 123, 0, 123, 0,
    87, 0, 87, 0, 98, 0, 98, 0, 110, 0, 110, 0, 98, 0, 98, 0,
  ],

  /* mellow shop theme: sparse triangle arps, 96bpm, very quiet */
  PLAN_LEAD: [
    523, 0, 0, 659, 0, 0, 784, 0, 0, 0, 659, 0, 0, 0, 0, 0,
    494, 0, 0, 587, 0, 0, 740, 0, 0, 0, 587, 0, 0, 0, 0, 0,
    523, 0, 0, 659, 0, 0, 784, 0, 0, 0, 880, 0, 0, 784, 0, 0,
    659, 0, 0, 587, 0, 0, 523, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  PLAN_BASS: [
    131, 0, 0, 0, 0, 0, 0, 0, 98, 0, 0, 0, 0, 0, 0, 0,
    123, 0, 0, 0, 0, 0, 0, 0, 98, 0, 0, 0, 0, 0, 0, 0,
    131, 0, 0, 0, 0, 0, 0, 0, 110, 0, 0, 0, 0, 0, 0, 0,
    98, 0, 0, 0, 0, 0, 0, 0, 87, 0, 0, 0, 0, 0, 0, 0,
  ],

  startMusic(kind) {
    kind = kind || "battle";
    if (this.musicKind === kind && this.musicTimer) return;
    this.stopMusic();
    if (this.muted || !this.ensure()) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.musicKind = kind;
    this.musicStep = 0;
    const battle = kind === "battle";
    const lead = battle ? this.LEAD : this.PLAN_LEAD;
    const bass = battle ? this.BASS : this.PLAN_BASS;
    const stepDur = 60 / (battle ? 150 : 96) / 4;
    this.musicGain.gain.value = battle ? 0.16 : 0.07;
    this.musicTimer = setInterval(() => {
      const i = this.musicStep % lead.length;
      if (lead[i]) this.tone(lead[i], stepDur * (battle ? 0.9 : 2.2), battle ? "square" : "triangle", battle ? 0.55 : 0.5, 0, null, this.musicGain);
      if (bass[i]) this.tone(bass[i], stepDur * (battle ? 1.8 : 3.5), "triangle", 0.8, 0, null, this.musicGain);
      if (battle && i % 4 === 0) this.noise(0.02, 0.04, 0, 4000);   // hat tick
      this.musicStep++;
    }, stepDur * 1000);
  },

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.musicKind = null;
  },
};

/* first user gesture unlocks audio (browser autoplay policy) */
window.addEventListener("pointerdown", () => { SND.ensure(); }, { once: true });
