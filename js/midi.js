/* ==========================================================================
 * Tiny MIDI player — parses .mid files and performs them through SND's
 * WebAudio voices as a chiptune cover (square lead, triangle bass, hat
 * percussion), the same copyright posture as the video engine's covers.
 * Battle music rotates through the songs/ library.
 * ========================================================================== */

const MIDI = {
  TRACKS: [
    "songs/pkmn_gen1_trainer.mid", "songs/pkmn_gen1_wild.mid",
    "songs/pkmn_gen1_champion.mid", "songs/pkmn_gen1_rival.mid",
    "songs/pkmn_gen1_gymleader.mid", "songs/pkmn_gen2_trainer.mid",
    "songs/pkmn_gen2_wild.mid", "songs/pkmn_gen3_trainer.mid",
    "songs/pkmn_gen3_wild.mid", "songs/pkmn_gen4_trainer.mid",
    "songs/pkmn_gen5_trainer.mid", "songs/pkmn_legendary.mid",
  ],
  cache: {},          // url -> parsed song {notes:[{t,dur,note,ch,vel}], length}
  playing: null,      // {song, timer, startCtxTime, idx}
  lastTrack: -1,

  /* ---------------- parsing ---------------- */
  async load(url) {
    if (this.cache[url]) return this.cache[url];
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const song = this.parse(buf);
    this.cache[url] = song;
    return song;
  },

  parse(d) {
    let pos = 0;
    const u32 = () => (d[pos++] << 24) | (d[pos++] << 16) | (d[pos++] << 8) | d[pos++];
    const u16 = () => (d[pos++] << 8) | d[pos++];
    if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== "MThd") throw new Error("not midi");
    pos = 8;
    const format = u16(), ntracks = u16(), division = u16();
    const tempos = [{ tick: 0, usPerBeat: 500000 }];
    const rawNotes = [];   // {tick, note, ch, vel, off?}

    for (let tr = 0; tr < ntracks; tr++) {
      while (pos < d.length && String.fromCharCode(d[pos], d[pos + 1], d[pos + 2], d[pos + 3]) !== "MTrk") pos++;
      if (pos >= d.length) break;
      pos += 4;
      const len = u32();
      const end = pos + len;
      let tick = 0, running = 0;
      const on = {};       // "ch:note" -> {tick, vel}
      while (pos < end) {
        // variable-length delta
        let delta = 0, b;
        do { b = d[pos++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
        tick += delta;
        let status = d[pos];
        if (status & 0x80) { pos++; running = status; } else status = running;
        const type = status & 0xf0, ch = status & 0x0f;
        if (type === 0x90 || type === 0x80) {
          const note = d[pos++], vel = d[pos++];
          const key = ch + ":" + note;
          if (type === 0x90 && vel > 0) {
            on[key] = { tick, vel };
          } else if (on[key]) {
            rawNotes.push({ tick: on[key].tick, endTick: tick, note, ch, vel: on[key].vel });
            delete on[key];
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) { pos += 2; }
        else if (type === 0xc0 || type === 0xd0) { pos += 1; }
        else if (status === 0xff) {
          const meta = d[pos++];
          let mlen = 0;
          do { b = d[pos++]; mlen = (mlen << 7) | (b & 0x7f); } while (b & 0x80);
          if (meta === 0x51 && mlen === 3) {
            tempos.push({ tick, usPerBeat: (d[pos] << 16) | (d[pos + 1] << 8) | d[pos + 2] });
          }
          pos += mlen;
        } else if (status === 0xf0 || status === 0xf7) {
          let slen = 0;
          do { b = d[pos++]; slen = (slen << 7) | (b & 0x7f); } while (b & 0x80);
          pos += slen;
        }
      }
      pos = end;
    }

    // ticks -> seconds through the tempo map
    tempos.sort((a, b) => a.tick - b.tick);
    const toSec = (tick) => {
      let sec = 0, lastTick = 0, us = 500000;
      for (const t of tempos) {
        if (t.tick >= tick) break;
        sec += ((t.tick - lastTick) / division) * (us / 1e6);
        lastTick = t.tick; us = t.usPerBeat;
      }
      return sec + ((tick - lastTick) / division) * (us / 1e6);
    };
    const notes = rawNotes
      .map(n => ({ t: toSec(n.tick), dur: Math.max(0.05, toSec(n.endTick) - toSec(n.tick)), note: n.note, ch: n.ch, vel: n.vel }))
      .sort((a, b) => a.t - b.t);
    const length = notes.length ? Math.max(...notes.map(n => n.t + n.dur)) + 0.8 : 1;
    return { notes, length };
  },

  /* ---------------- playback (chiptune voices via SND) ---------------- */
  async playRandom() {
    if (SND.muted || !SND.ensure()) return;
    let i;
    do { i = Math.floor(Math.random() * this.TRACKS.length); }
    while (this.TRACKS.length > 1 && i === this.lastTrack);
    this.lastTrack = i;
    try {
      const song = await this.load(this.TRACKS[i]);
      this.playSong(song);
    } catch (e) { /* fall back to the procedural loop */ this._fallback(); }
  },

  playSong(song) {
    this.stop();
    if (!song.notes.length) { this._fallback(); return; }
    const state = { song, idx: 0, offset: 0 };
    this.playing = state;
    const LOOKAHEAD = 0.35;
    const step = () => {
      if (this.playing !== state || SND.muted || !SND.ctx) return;
      const now = SND.ctx.currentTime;
      if (!state.t0) state.t0 = now + 0.1;
      // schedule everything due in the next window
      while (state.idx < song.notes.length) {
        const n = song.notes[state.idx];
        const when = state.t0 + n.t - now;
        if (when > LOOKAHEAD) break;
        state.idx++;
        if (n.ch === 9) {  // percussion -> hat/kick ticks
          if (n.note >= 42) SND.noise(0.02, 0.035, Math.max(0, when), 5000);
          else SND.noise(0.05, 0.07, Math.max(0, when), 300);
          continue;
        }
        const freq = 440 * Math.pow(2, (n.note - 69) / 12);
        const bass = n.note < 52;
        const vol = (bass ? 0.55 : 0.34) * Math.min(1, n.vel / 100 + 0.25);
        SND.tone(freq, Math.min(n.dur, 1.6), bass ? "triangle" : "square",
                 vol, Math.max(0, when), null, SND.musicGain);
      }
      if (state.idx >= song.notes.length) {  // loop
        state.idx = 0;
        state.t0 = state.t0 + song.length;
      }
      state.timer = setTimeout(step, 120);
    };
    SND.musicGain.gain.value = 0.11;
    step();
  },

  stop() {
    if (this.playing) {
      clearTimeout(this.playing.timer);
      this.playing = null;
    }
  },
};

/* reroute SND's music API: battles play a rotating MIDI cover, the plan
 * phase keeps the quiet procedural loop, stops stop everything. */
(function () {
  const origStart = SND.startMusic.bind(SND);
  const origStop = SND.stopMusic.bind(SND);
  MIDI._fallback = () => origStart("battle");
  SND.startMusic = function (kind) {
    if (kind === "battle" || !kind) {
      origStop();
      MIDI.playRandom();
      return;
    }
    MIDI.stop();
    origStart(kind);
  };
  SND.stopMusic = function () {
    MIDI.stop();
    origStop();
  };
})();
