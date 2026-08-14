# ⚔️ Pokémon Sphere AutoChess

A playable auto-chess / roguelike prototype built on the **sphere-battle engine**
from `ball-physics-shorts/pokemon_spheres.py`, inspired by
[keldaanCommunity/pokemonAutoChess](https://github.com/keldaanCommunity/pokemonAutoChess).
Dual purpose: a game AND a video-content generator (episodes of runs, viewer-vote wagers).

## Play

```
play.bat            # singleplayer: static server on :8787 + browser
play-mp.bat         # multiplayer: + Colyseus game server on :2567, opens the PVP lobby
```

or manually: `python -m http.server 8787` in this folder → http://localhost:8787/
(singleplayer) or http://localhost:8787/mp.html (PVP — also run `node server/index.js`).

URL params (singleplayer): `?seed=42` (deterministic run) · `&speed=8` (sim speed 1–16)

**Practice bot**: `node server/bot.js BotName` joins the PVP room as a real
player (greedy shopper, auto-readies). `--start` flag makes it start the match
when 2+ players are in — so you can play PVP alone against a bot.

## Multiplayer architecture

- `server/index.js` — authoritative Colyseus room (port 2567). Owns every
  player's gold/shop/units; validates buy/sell/reroll/equip/reorder; pairs
  alive players each round (odd player fights a "ghost" copy of a random
  rival's team, ghost owner takes no damage); runs the sim headlessly for
  results; applies income/HP/eliminations; last trainer standing wins.
- **Deterministic replay**: the server loads the SAME `js/data.js` +
  `js/engine.js` it serves to browsers (via `vm.runInThisContext`), sims each
  pairing with a seed, and sends clients `{teamA, teamB, seed}`. Clients
  re-run `new Battle(teamA, teamB, seed)` locally for the visuals — identical
  physics, identical result, zero per-frame networking.
- `js/mp.js` — MPAdapter: implements the exact surface the singleplayer UI
  expects (`window.game`), but every action is a room message and every
  server "view" patches the adapter. The whole Trozei UI is reused verbatim.
- Phases: LOBBY → PLAN (40s or all-ready) → BATTLE (client replays, ~22s)
  → RESULT (8s) / ITEMS (14s, after stages 2/4/6/8) → next stage.
  MVP/clutch/career stats compute client-side from the replay (same numbers
  the server saw, because same sim). Timers are env-tunable:
  `PLAN_SECONDS=6 BATTLE_SECONDS=6 RESULT_SECONDS=2 node index.js`.
- **Spectating** — eliminated players and late joiners watch the remaining
  trainers' battles live (server broadcasts every matchup; client replays
  the first one, with a "Watching: A VS B" toast).
- **Reconnection** — an unintentional disconnect keeps your seat for 60s
  (your team auto-fights meanwhile); the client auto-reconnects with retries.
- **Rematch** — at game over, PLAY AGAIN resets the room to the lobby with
  everyone's gold/HP/teams fresh; connected players stay seated.

## Playing with friends (LAN / internet)

1. Host runs `play-mp.bat` (or `node server/index.js` + any static server).
2. Friends open `http://<host-ip>:8787/mp.html?server=<host-ip>` —
   the `?server=` param points the game client at the host's Colyseus server
   (port 2567 assumed; pass `host:port` to override).
3. Windows will prompt to allow node/python through the firewall — allow on
   private networks. For internet play, port-forward 8787 + 2567 or deploy
   `server/` to any Node host (Colyseus Cloud, Railway, a VPS).

## The fun layer (TFT / Super Auto Pets DNA)

- **Type synergies** — 2/4 of a type on your battle team activates a real sim
  buff (Blaze +dmg, Torrent regen, Foresight dodge, Ambush execute, Toxic
  Touch poison-on-hit, ...). Duplicates count, so chasing a combine ramps you
  into the synergy. Enemy teams get them too. Chips in the team panel and
  battle preview show progress (dim until active).
- **Named trainer stages** — every stage is a themed opponent ("STAGE 3 —
  Swimmer Marina" runs water). Scout their synergies in the preview and
  counter-pick. Stage 10 is CHAMPION MEWTWO.
- **Pokédex inspect panel** — hover any shop card or team unit: stat bars,
  the move explained in plain words, its synergy + your current count, and
  the full evolution line (Magikarp's card shows exactly why you'd gamble).
- **Result storytelling** — MVP callout (most damage dealt + KOs), CLUTCH!
  flair for one-survivor low-HP wins, "vs <trainer>" framing.
- **Evolution toasts** + income preview ("next income +7 (2 interest)") keep
  power spikes celebrated and the economy legible.
- **Physics-native moves** — Onix's Stealth Rock scatters persistent rock
  hazards on the enemy half; Exeggcute/Exeggutor's Egg Barrage summons egg
  minions that swarm and jostle; Body Slam / Megahorn / Dynamic Punch LAUNCH
  victims across the arena (control-loss knockback, walls bounce them back).
- **Scouting loop** — the preview tells you what the trainer leans on and what
  counters it ("They lean POISON — PSYCHIC / GROUND hit it hard!"), and shop
  cards that counter the enemy's dominant type wear a COUNTER! badge.
- **Drag & drop** — drag items onto Pokémon (equippable rows glow), drag team
  rows to reorder the front line. Click flows still work.
- **RNG mercy** — sitting on 2 copies? After 2 dry shops the 3rd is guaranteed
  (pity timer). On a 2+ loss streak rerolls cost 1g.
- **Sound** — fully procedural WebAudio chiptune (no audio files): hit/KO/
  launch/summon/hazard SFX from a battle event stream, evolution jingle,
  victory & champion fanfares, buy/sell/reroll blips, and an original
  150bpm square+triangle battle loop. Mute button in the header (persists).
- **More arena weirdness** — Koffing's Toxic Spikes (poison field hazards),
  Ditto's Substitute (tanky decoy dolls that body-block), Wailord (tier 4:
  biggest ball in the game, Water Spout scales with its own HP).
- **Run Report** — victory/game-over screens show your record, gold earned,
  and career leaderboard: per-Pokémon total damage, KOs, and MVP counts
  across the whole run (minion damage credits the summoner).

## The loop

1. **PLAN** — buy units from a 5-slot shop (tier odds scale by round, TFT-style,
   tier-colored cost badges), reroll (2g), sell, equip held items (click item →
   glowing Pokémon), move units to the battle team. Shop cards show "n/3"
   combine progress and glow gold when a purchase completes a trio.
2. **BATTLE** — real-time sphere sim: billiard physics, seek steering, orbiting
   weapons, hit-charged move meters, type chart (1.2×/0.85×), sudden-death ramp.
3. **RESULT** — income (base + interest + streak + win bonus),
   player HP damage on loss. Item choice after stages 2/4/6/8.
4. Survive **10 stages** (stage 10 = Mewtwo boss team) → CHAMPION. HP 0 → game over.

## Mechanics ported from the video engine

- Roster stats/types/moves from `pokemon_spheres.py` ROSTER (28 shop mons + 18
  combine-only evolved forms; Trozei sprites as the balls)
- **3 copies combine**: base → evolution (Charmander×3 → Charmeleon, ×9 →
  Charizard; Magikarp×3 → Gyarados payoff; Eevee×3 → random eeveelution),
  no-evo mons → gold ★ (HP×1.8, DMG×1.6)
- **Held items** = Pokémon items on Fighter stats (Muscle Band, Leftovers,
  Shell Bell, Choice Scarf, Sacred Ash, Rocky Helmet, Berserk Gene, Black
  Belt, Assault Vest) with real item sprites from
  keldaanCommunity/pokemonAutoChess (`sprites/items/`); items carry through
  combines and render on fighters in battle
- Move families: projectiles (typed iconography colors), dashes, buffs, heals,
  poison/burn DoTs, sleep, slows, AoE rings, Alakazam teleport-dodge,
  Magikarp Flail joke arc
- Engine constants mirrored: SEEK_RATE 1.15, type chart 1.2/0.85, BASE_DMG 3.0,
  HP-bar-width-proportional-to-maxHP, HP number below the mon
- Balance lesson carried over: **all damage joins the sudden-death ramp** or
  heal/DoT matchups stall

## Files

## UI

Faithful **Pokémon Trozei (DS)** skin, built from the actual game references
(Bulbanews gameplay screenshots + spriters-resource text sheet):

- Deep **teal world with white swirl spirals** (SVG-tiled background + canvas
  watermark), like the DS side rails
- **Pale-mint play field with faint teal grid** — the puzzle field
- **Gold embossed plaques** with ornament tabs and cream faces for every panel
  and modal (the "Remaining 26" plaque style)
- **Bubble text**: blue with white outlines (Trozei "Clear!"), pink for
  negatives ("You Lost..."), used in HTML and canvas (damage numbers, KO!,
  banners, VS badge)
- Sprites sit **bare on the grid** like real Trozei tiles (team = soft
  green/pink ellipse shadow + thin ring)
- **Lilita One** chunky display type for headers/buttons/banners (bubble-font
  lookalike), Poppins for body text — both local in `fonts/`
- **No emoji anywhere**: real item sprites, HP/coin icons, drawn gold stars,
  comic-burst KO flashes, Pokéball logo — assets from
  keldaanCommunity/pokemonAutoChess
- Motion: staggered shop-card pop-ins, sprite idle bob, combine-ready glow,
  equip-mode pulse, modal bounce, drifting background swirls

No announcer by design — too many mons on screen. Wagering was cut (2026-08-14).

### Usability affordances
- Equip flow: select item chip → equippable Pokémon pulse blue, hint text
  appears, Escape or re-click cancels; item tooltips on hover
- Shop: "n/3" owned badges, gold combine-ready glow, tier-colored costs,
  reroll bar with cost + "refreshes free each stage" note, disabled-reroll
  tooltip explains why
- Team: explicit BATTLE TEAM n/cap and BENCH sections, ▲ move-to-front,
  sell buttons show gold value with coin icon

| File | What |
|---|---|
| `index.html` / `css/style.css` | UI shell (Trozei bubble aesthetic) |
| `js/data.js` | Roster, type chart, moves, items, economy + enemy scaling tables |
| `js/engine.js` | Battle sim (deterministic, seeded) + canvas renderer |
| `js/game.js` | Game state machine, shop/economy/wager, DOM UI |
| `sprites/` | 47 Trozei sprites copied from ball-physics-shorts |

## Testing

Everything is driveable headlessly (Playwright): stable `data-testid` attributes
on all interactive elements, `window.game.state()` snapshot API, `?seed=` for
deterministic runs, `?speed=16` for fast sims. A full 10-round playthrough,
combine/evolution/star-up, item equipping, both wager sides, victory and
game-over paths were verified end-to-end via Playwright MCP.

## Scale-up path (multiplayer)

The reference project uses Node/TypeScript + Colyseus rooms + MongoDB +
Firebase auth. This prototype keeps sim/data/UI in separate modules so
`engine.js` + `data.js` can move server-side into a Colyseus room with the
browser as a render client. Wagering stays in-game currency only.

## Prototype simplifications (vs. the video engine)

- No evolution cutscene / announcer / music yet (all exist in the video engine
  and can port over)
- Weapon rendering is a simple blade+tip (not per-mon procedural polygons)
- No PMD reactive portraits panel
- Positioning is front-line-order only (no 2D board placement)
