/* ==========================================================================
 * Pokemon Sphere AutoChess — game data
 * Roster stats ported from ball-physics-shorts/pokemon_spheres.py
 * (BASE_DMG 3.0, type chart 1.2/0.85, speeds/hp/radii from ROSTER dict)
 * ========================================================================== */

const SUPER = 1.2, RESIST = 0.85;

const TYPE_CHART = {
  fire:     { grass: SUPER, bug: SUPER, steel: SUPER, ice: SUPER, water: RESIST, rock: RESIST, fire: RESIST },
  water:    { fire: SUPER, rock: SUPER, ground: SUPER, grass: RESIST, water: RESIST },
  grass:    { water: SUPER, rock: SUPER, ground: SUPER, fire: RESIST, bug: RESIST, poison: RESIST, grass: RESIST },
  electric: { water: SUPER, grass: RESIST, ground: RESIST, electric: RESIST },
  ghost:    { ghost: SUPER, psychic: SUPER, normal: RESIST },
  normal:   { ghost: RESIST, rock: RESIST },
  psychic:  { fighting: SUPER, poison: SUPER, psychic: RESIST, dark: RESIST },
  dark:     { psychic: SUPER, ghost: SUPER, fighting: RESIST, dark: RESIST, fairy: RESIST },
  fighting: { normal: SUPER, rock: SUPER, psychic: RESIST, ghost: RESIST, fairy: RESIST, poison: RESIST, bug: RESIST },
  rock:     { fire: SUPER, bug: SUPER, fighting: RESIST, ground: RESIST },
  ground:   { fire: SUPER, electric: SUPER, poison: SUPER, rock: SUPER, grass: RESIST, bug: RESIST },
  bug:      { grass: SUPER, psychic: SUPER, fire: RESIST, fighting: RESIST, ghost: RESIST, fairy: RESIST, poison: RESIST },
  poison:   { grass: SUPER, fairy: SUPER, poison: RESIST, ground: RESIST, rock: RESIST, ghost: RESIST },
  fairy:    { fighting: SUPER, dragon: SUPER, fire: RESIST, poison: RESIST, steel: RESIST },
  steel:    { ice: SUPER, rock: SUPER, fairy: SUPER, fire: RESIST, water: RESIST, electric: RESIST, steel: RESIST },
  ice:      { grass: SUPER, ground: SUPER, dragon: SUPER, fire: RESIST, water: RESIST, ice: RESIST, steel: RESIST },
  dragon:   { dragon: SUPER, steel: RESIST, fairy: RESIST },
};

const TYPE_COLORS = {
  fire: "#f08030", water: "#6890f0", grass: "#78c850", electric: "#f8d030",
  ghost: "#705898", normal: "#a8a878", psychic: "#f85888", fighting: "#c03028",
  rock: "#b8a038", ground: "#e0c068", bug: "#a8b820", poison: "#a040a0",
  fairy: "#ee99ac", steel: "#b8b8d0", ice: "#98d8d8", dragon: "#7038f8",
  dark: "#705848",
};

function typeMul(atk, def) {
  return (TYPE_CHART[atk] && TYPE_CHART[atk][def]) || 1.0;
}

/* --------------------------------------------------------------------------
 * Moves. kind: proj | dash | buff | heal | drain | poison | sleep | aoe |
 *              flail (passive) | harden (stacking defense)
 * cost = landed hits needed to charge the meter (MOVE_COST style, 3-6)
 * ------------------------------------------------------------------------ */
const MOVES = {
  "Splash":        { cost: 3, kind: "flail",  note: "...nothing happened! (+80% DMG below 40% HP)" },
  "Ember":         { cost: 3, kind: "proj", count: 3, dmg: 5, pspeed: 420 },
  "Water Gun":     { cost: 3, kind: "proj", count: 3, dmg: 5, pspeed: 420 },
  "Thunderbolt":   { cost: 4, kind: "proj", count: 3, dmg: 7, pspeed: 500 },
  "Swift":         { cost: 3, kind: "proj", count: 4, dmg: 4, pspeed: 460, sure: true },
  "Bonemerang":    { cost: 3, kind: "proj", count: 2, dmg: 8, pspeed: 380 },
  "String Shot":   { cost: 3, kind: "slow", mul: 0.55, dur: 3.0 },
  "Leech Seed":    { cost: 4, kind: "drain", dmg: 10, healMul: 1.0 },
  "Shadow Ball":   { cost: 4, kind: "proj", count: 2, dmg: 9, pspeed: 400 },
  "Dynamic Punch": { cost: 4, kind: "dash", dmg: 14, confuse: 1.2, kb: 420 },
  "Fury Cutter":   { cost: 3, kind: "grow", dmgAdd: 0.8 },
  "Poison Gas":    { cost: 4, kind: "poison", stacks: 3 },
  "Sing":          { cost: 5, kind: "sleep", dur: 2.2 },
  "Dragon Claw":   { cost: 4, kind: "buff", dmgMul: 1.5, speedMul: 1.1, dur: 4 },
  "Dragon Breath": { cost: 4, kind: "proj", count: 2, dmg: 8, pspeed: 420 },
  "Bullet Punch":  { cost: 3, kind: "dash", dmg: 11, kb: 260 },
  "Body Slam":     { cost: 4, kind: "dash", dmg: 16, kb: 780 },
  "Aura Sphere":   { cost: 4, kind: "proj", count: 2, dmg: 9, pspeed: 340, homing: true },
  "Ice Beam":      { cost: 4, kind: "proj", count: 3, dmg: 7, pspeed: 440, slowMul: 0.6, slowDur: 2.0 },
  "Megahorn":      { cost: 4, kind: "dash", dmg: 15, kb: 520 },
  "Psychic":       { cost: 4, kind: "proj", count: 2, dmg: 10, pspeed: 420 },
  "Rock Throw":    { cost: 4, kind: "aoe", dmg: 9, radius: 180 },
  "Stealth Rock":  { cost: 4, kind: "hazard", count: 3, dmg: 9, ttl: 9 },
  "Toxic Spikes":  { cost: 4, kind: "hazard", count: 3, dmg: 3, pstacks: 2, ttl: 9 },
  "Egg Barrage":   { cost: 4, kind: "summon", count: 2, cap: 4, minion: { hp: 26, dmg: 1.8, speed: 1.05, r: 14, sprite: "exeggcute", name: "Egg" } },
  "Substitute":    { cost: 4, kind: "summon", count: 1, cap: 2, minion: { hp: 70, dmg: 0.6, speed: 0.9, r: 20, sprite: "ditto", name: "Doll" } },
  "Water Spout":   { cost: 5, kind: "aoe", dmg: 6, radius: 999, hpScale: 8 },
  "Hyper Beam":    { cost: 5, kind: "proj", count: 1, dmg: 26, pspeed: 560, recharge: 1.2 },
  "Sandstorm":     { cost: 5, kind: "aoe", dmg: 8, radius: 999, buffDef: 0.85, dur: 5 },
  "Meteor Mash":   { cost: 4, kind: "dash", dmg: 15, armor: 0.85 },
  "Psywave":       { cost: 4, kind: "aoe", dmg: 11, radius: 240 },
  "Psystrike":     { cost: 4, kind: "proj", count: 2, dmg: 13, pspeed: 480 },
  "Origin Pulse":  { cost: 5, kind: "aoe", dmg: 12, radius: 999 },
  "Lava Plume":    { cost: 5, kind: "aoe", dmg: 10, radius: 260, burn: 3 },
  "Hydro Pump":    { cost: 4, kind: "proj", count: 3, dmg: 9, pspeed: 460 },
  "Flamethrower":  { cost: 4, kind: "proj", count: 4, dmg: 7, pspeed: 440 },
  "Harden":        { cost: 3, kind: "harden", defMul: 0.8 },
  "Sleep Powder":  { cost: 4, kind: "sleep", dur: 2.0 },
  "Moonlight":     { cost: 4, kind: "heal", amount: 26 },
  "Aqua Ring":     { cost: 4, kind: "heal", amount: 22 },
  "Thrash":        { cost: 4, kind: "buff", dmgMul: 1.7, speedMul: 1.25, dur: 3 },
};

/* --------------------------------------------------------------------------
 * Units. Base stats from pokemon_spheres ROSTER; dmg = BASE_DMG(3.0) scaled
 * lightly by tier so shop cost means something. Evolved forms are shop-
 * unavailable (pool:false) and only reachable by combining 3 copies.
 * ------------------------------------------------------------------------ */
const UNITS = {
  /* ------ tier 1 (all base forms — evolve by combining 3) ------ */
  magikarp:   { name: "Magikarp",  cost: 1, type: "water",    hp: 110, dmg: 2.2, speed: 0.95, r: 27, move: "Splash",       evolvesTo: "gyarados" },
  caterpie:   { name: "Caterpie",  cost: 1, type: "bug",      hp: 105, dmg: 2.6, speed: 0.95, r: 26, move: "String Shot",  evolvesTo: "metapod" },
  charmander: { name: "Charmander",cost: 1, type: "fire",     hp: 100, dmg: 3.0, speed: 1.02, r: 26, move: "Ember",        evolvesTo: "charmeleon" },
  squirtle:   { name: "Squirtle",  cost: 1, type: "water",    hp: 105, dmg: 3.0, speed: 1.00, r: 26, move: "Water Gun",    evolvesTo: "wartortle" },
  bulbasaur:  { name: "Bulbasaur", cost: 1, type: "grass",    hp: 100, dmg: 3.0, speed: 1.00, r: 26, move: "Leech Seed",   evolvesTo: "ivysaur" },
  eevee:      { name: "Eevee",     cost: 1, type: "normal",   hp: 100, dmg: 3.0, speed: 1.04, r: 26, move: "Swift",        evolvesTo: "@eeveelution" },
  pikachu:    { name: "Pikachu",   cost: 1, type: "electric", hp: 95,  dmg: 3.2, speed: 1.12, r: 26, move: "Thunderbolt",  evolvesTo: "raichu" },
  cubone:     { name: "Cubone",    cost: 1, type: "ground",   hp: 105, dmg: 3.0, speed: 1.00, r: 26, move: "Bonemerang",   evolvesTo: "marowak" },
  machop:     { name: "Machop",    cost: 1, type: "fighting", hp: 105, dmg: 2.8, speed: 0.98, r: 26, move: "Dynamic Punch", evolvesTo: "machoke" },
  gastly:     { name: "Gastly",    cost: 1, type: "ghost",    hp: 85,  dmg: 3.0, speed: 1.10, r: 25, move: "Shadow Ball",  evolvesTo: "haunter" },
  abra:       { name: "Abra",      cost: 1, type: "psychic",  hp: 80,  dmg: 3.0, speed: 1.10, r: 25, move: "Psychic", dodge: 0.12, evolvesTo: "kadabra" },
  /* ------ tier 2 ------ */
  growlithe:  { name: "Growlithe", cost: 2, type: "fire",     hp: 100, dmg: 3.4, speed: 1.08, r: 26, move: "Ember",        evolvesTo: "arcanine" },
  gible:      { name: "Gible",     cost: 2, type: "dragon",   hp: 105, dmg: 3.4, speed: 1.00, r: 27, move: "Dragon Claw",  evolvesTo: "gabite" },
  scyther:    { name: "Scyther",   cost: 2, type: "bug",      hp: 95,  dmg: 3.4, speed: 1.10, r: 26, move: "Fury Cutter",  evolvesTo: "scizor" },
  koffing:    { name: "Koffing",   cost: 2, type: "poison",   hp: 105, dmg: 3.2, speed: 0.96, r: 26, move: "Toxic Spikes", evolvesTo: "weezing" },
  ditto:      { name: "Ditto",     cost: 2, type: "normal",   hp: 110, dmg: 2.6, speed: 1.00, r: 26, move: "Substitute" },
  jigglypuff: { name: "Jigglypuff",cost: 2, type: "fairy",    hp: 100, dmg: 3.2, speed: 1.00, r: 26, move: "Sing",         evolvesTo: "wigglytuff" },
  exeggcute:  { name: "Exeggcute", cost: 2, type: "grass",    hp: 105, dmg: 2.8, speed: 0.95, r: 27, move: "Egg Barrage",  evolvesTo: "exeggutor" },
  riolu:      { name: "Riolu",     cost: 2, type: "fighting", hp: 95,  dmg: 3.4, speed: 1.12, r: 26, move: "Aura Sphere",  evolvesTo: "lucario" },
  munchlax:   { name: "Munchlax",  cost: 2, type: "normal",   hp: 140, dmg: 3.0, speed: 0.85, r: 29, move: "Body Slam",    evolvesTo: "snorlax" },
  /* ------ tier 3 ------ */
  lapras:     { name: "Lapras",    cost: 3, type: "ice",      hp: 140, dmg: 3.8, speed: 0.90, r: 32, move: "Ice Beam" },
  heracross:  { name: "Heracross", cost: 3, type: "bug",      hp: 120, dmg: 4.2, speed: 1.02, r: 28, move: "Megahorn" },
  onix:       { name: "Onix",      cost: 3, type: "rock",     hp: 165, dmg: 3.6, speed: 0.78, r: 34, move: "Stealth Rock", evolvesTo: "steelix" },
  wailmer:    { name: "Wailmer",   cost: 3, type: "water",    hp: 150, dmg: 3.2, speed: 0.85, r: 31, move: "Water Gun",    evolvesTo: "wailord" },
  dratini:    { name: "Dratini",   cost: 3, type: "dragon",   hp: 110, dmg: 3.8, speed: 1.02, r: 26, move: "Dragon Breath", evolvesTo: "dragonair" },
  ralts:      { name: "Ralts",     cost: 3, type: "psychic",  hp: 95,  dmg: 3.8, speed: 1.02, r: 25, move: "Psychic",      evolvesTo: "kirlia" },
  /* ------ tier 4 ------ */
  larvitar:   { name: "Larvitar",  cost: 4, type: "rock",     hp: 130, dmg: 3.8, speed: 0.92, r: 27, move: "Rock Throw",   evolvesTo: "pupitar" },
  beldum:     { name: "Beldum",    cost: 4, type: "steel",    hp: 125, dmg: 3.8, speed: 0.90, r: 27, move: "Meteor Mash",  evolvesTo: "metang" },
  /* ------ tier 5 (legendaries — no lines, gold-star on 3) ------ */
  mewtwo:     { name: "Mewtwo",    cost: 5, type: "psychic",  hp: 150, dmg: 5.6, speed: 1.06, r: 30, move: "Psystrike" },
  rayquaza:   { name: "Rayquaza",  cost: 5, type: "dragon",   hp: 160, dmg: 5.4, speed: 1.05, r: 32, move: "Hyper Beam" },
  kyogre:     { name: "Kyogre",    cost: 5, type: "water",    hp: 165, dmg: 5.0, speed: 0.95, r: 33, move: "Origin Pulse" },
  groudon:    { name: "Groudon",   cost: 5, type: "ground",   hp: 165, dmg: 5.0, speed: 0.92, r: 33, move: "Lava Plume" },
  /* ------ evolved forms of the new lines (combine-only) ------ */
  raichu:     { name: "Raichu",    cost: 1, type: "electric", hp: 175, dmg: 6.4, speed: 1.15, r: 30, move: "Thunderbolt",  pool: false },
  marowak:    { name: "Marowak",   cost: 1, type: "ground",   hp: 185, dmg: 6.2, speed: 1.00, r: 30, move: "Bonemerang",   pool: false },
  machoke:    { name: "Machoke",   cost: 1, type: "fighting", hp: 150, dmg: 4.6, speed: 1.00, r: 28, move: "Dynamic Punch", pool: false, evolvesTo: "machamp" },
  machamp:    { name: "Machamp",   cost: 1, type: "fighting", hp: 205, dmg: 6.8, speed: 1.02, r: 32, move: "Dynamic Punch", pool: false },
  haunter:    { name: "Haunter",   cost: 1, type: "ghost",    hp: 130, dmg: 4.8, speed: 1.12, r: 27, move: "Shadow Ball",  pool: false, evolvesTo: "gengar" },
  gengar:     { name: "Gengar",    cost: 1, type: "ghost",    hp: 180, dmg: 7.0, speed: 1.15, r: 30, move: "Shadow Ball",  pool: false },
  kadabra:    { name: "Kadabra",   cost: 1, type: "psychic",  hp: 115, dmg: 4.8, speed: 1.12, r: 26, move: "Psychic", dodge: 0.18, pool: false, evolvesTo: "alakazam" },
  alakazam:   { name: "Alakazam",  cost: 1, type: "psychic",  hp: 160, dmg: 7.0, speed: 1.15, r: 29, move: "Psychic", dodge: 0.25, pool: false },
  scizor:     { name: "Scizor",    cost: 2, type: "steel",    hp: 195, dmg: 6.8, speed: 1.12, r: 30, move: "Bullet Punch", pool: false },
  weezing:    { name: "Weezing",   cost: 2, type: "poison",   hp: 200, dmg: 5.8, speed: 0.95, r: 31, move: "Toxic Spikes", pool: false },
  wigglytuff: { name: "Wigglytuff",cost: 2, type: "fairy",    hp: 210, dmg: 5.6, speed: 1.00, r: 31, move: "Sing",         pool: false },
  lucario:    { name: "Lucario",   cost: 2, type: "fighting", hp: 205, dmg: 7.4, speed: 1.15, r: 30, move: "Aura Sphere",  pool: false },
  snorlax:    { name: "Snorlax",   cost: 2, type: "normal",   hp: 290, dmg: 6.2, speed: 0.82, r: 37, move: "Body Slam",    pool: false },
  exeggutor:  { name: "Exeggutor", cost: 2, type: "grass",    hp: 200, dmg: 5.6, speed: 0.95, r: 33, move: "Egg Barrage",  pool: false },
  steelix:    { name: "Steelix",   cost: 3, type: "steel",    hp: 300, dmg: 6.0, speed: 0.78, r: 39, move: "Stealth Rock", pool: false },
  wailord:    { name: "Wailord",   cost: 3, type: "water",    hp: 320, dmg: 5.2, speed: 0.80, r: 42, move: "Water Spout",  pool: false },
  dragonair:  { name: "Dragonair", cost: 3, type: "dragon",   hp: 165, dmg: 5.6, speed: 1.05, r: 29, move: "Dragon Breath", pool: false, evolvesTo: "dragonite" },
  dragonite:  { name: "Dragonite", cost: 3, type: "dragon",   hp: 265, dmg: 9.0, speed: 1.08, r: 35, move: "Hyper Beam",   pool: false },
  kirlia:     { name: "Kirlia",    cost: 3, type: "psychic",  hp: 140, dmg: 5.4, speed: 1.05, r: 27, move: "Psychic",      pool: false, evolvesTo: "gardevoir" },
  gardevoir:  { name: "Gardevoir", cost: 3, type: "psychic",  hp: 235, dmg: 8.6, speed: 1.06, r: 32, move: "Psywave",      pool: false },
  pupitar:    { name: "Pupitar",   cost: 4, type: "rock",     hp: 190, dmg: 5.4, speed: 0.90, r: 30, move: "Rock Throw",   pool: false, evolvesTo: "tyranitar" },
  tyranitar:  { name: "Tyranitar", cost: 4, type: "rock",     hp: 310, dmg: 9.6, speed: 0.92, r: 37, move: "Sandstorm",    pool: false },
  metang:     { name: "Metang",    cost: 4, type: "steel",    hp: 185, dmg: 5.4, speed: 0.90, r: 30, move: "Meteor Mash",  pool: false, evolvesTo: "metagross" },
  metagross:  { name: "Metagross", cost: 4, type: "steel",    hp: 300, dmg: 9.2, speed: 0.92, r: 37, move: "Meteor Mash",  pool: false },
  /* ------ evolved forms (combine-only) ------ */
  gyarados:   { name: "Gyarados",  cost: 1, type: "water",    hp: 210, dmg: 7.0, speed: 1.05, r: 36, move: "Hydro Pump",   pool: false },
  metapod:    { name: "Metapod",   cost: 1, type: "bug",      hp: 150, dmg: 1.6, speed: 0.85, r: 26, move: "Harden",       pool: false, evolvesTo: "butterfree" },
  butterfree: { name: "Butterfree",cost: 1, type: "bug",      hp: 175, dmg: 6.4, speed: 1.12, r: 30, move: "Sleep Powder", pool: false },
  charmeleon: { name: "Charmeleon",cost: 1, type: "fire",     hp: 150, dmg: 5.0, speed: 1.05, r: 29, move: "Ember",        pool: false, evolvesTo: "charizard" },
  charizard:  { name: "Charizard", cost: 1, type: "fire",     hp: 205, dmg: 7.6, speed: 1.08, r: 34, move: "Flamethrower", pool: false },
  wartortle:  { name: "Wartortle", cost: 1, type: "water",    hp: 155, dmg: 5.0, speed: 1.02, r: 29, move: "Water Gun",    pool: false, evolvesTo: "blastoise" },
  blastoise:  { name: "Blastoise", cost: 1, type: "water",    hp: 210, dmg: 7.2, speed: 1.00, r: 34, move: "Hydro Pump",   pool: false },
  ivysaur:    { name: "Ivysaur",   cost: 1, type: "grass",    hp: 155, dmg: 5.0, speed: 1.00, r: 29, move: "Leech Seed",   pool: false, evolvesTo: "venusaur" },
  venusaur:   { name: "Venusaur",  cost: 1, type: "grass",    hp: 210, dmg: 7.0, speed: 0.98, r: 34, move: "Leech Seed",   pool: false },
  arcanine:   { name: "Arcanine",  cost: 2, type: "fire",     hp: 190, dmg: 6.6, speed: 1.10, r: 32, move: "Flamethrower", pool: false },
  gabite:     { name: "Gabite",    cost: 2, type: "dragon",   hp: 165, dmg: 5.6, speed: 1.05, r: 29, move: "Dragon Claw",  pool: false, evolvesTo: "garchomp" },
  garchomp:   { name: "Garchomp",  cost: 2, type: "dragon",   hp: 225, dmg: 8.2, speed: 1.10, r: 35, move: "Dragon Claw",  pool: false },
  vaporeon:   { name: "Vaporeon",  cost: 1, type: "water",    hp: 195, dmg: 5.6, speed: 1.02, r: 30, move: "Aqua Ring",    pool: false },
  jolteon:    { name: "Jolteon",   cost: 1, type: "electric", hp: 160, dmg: 6.2, speed: 1.25, r: 28, move: "Thunderbolt",  pool: false },
  flareon:    { name: "Flareon",   cost: 1, type: "fire",     hp: 165, dmg: 6.8, speed: 1.08, r: 29, move: "Flamethrower", pool: false },
  espeon:     { name: "Espeon",    cost: 1, type: "psychic",  hp: 165, dmg: 6.0, speed: 1.15, r: 28, move: "Psychic",      pool: false },
  umbreon:    { name: "Umbreon",   cost: 1, type: "dark",     hp: 190, dmg: 5.4, speed: 1.05, r: 28, move: "Moonlight",    pool: false },
  sylveon:    { name: "Sylveon",   cost: 1, type: "fairy",    hp: 180, dmg: 5.8, speed: 1.05, r: 28, move: "Moonlight",    pool: false },
};
const EEVEELUTIONS = ["vaporeon", "jolteon", "flareon", "espeon", "umbreon", "sylveon"];

/* Star-up for mons with no evolution line: 3 copies -> gold-star form. */
const STAR_HP_MUL = 1.8, STAR_DMG_MUL = 1.6;

/* --------------------------------------------------------------------------
 * Held items (one per unit) — Pokémon items mapped onto Fighter stats.
 * Sprites from keldaanCommunity/pokemonAutoChess (sprites/items/*.png).
 * ------------------------------------------------------------------------ */
const ITEMS = {
  muscle_band:  { name: "Muscle Band",  sprite: "sprites/items/MUSCLE_BAND.png",  desc: "+40% damage",                      dmgMul: 1.4 },
  leftovers:    { name: "Leftovers",    sprite: "sprites/items/LEFTOVERS.png",    desc: "Regen 1.5 HP/s",                   regen: 1.5 },
  shell_bell:   { name: "Shell Bell",   sprite: "sprites/items/SHELL_BELL.png",   desc: "Heal 30% of damage dealt",         lifesteal: 0.3 },
  choice_scarf: { name: "Choice Scarf", sprite: "sprites/items/CHOICE_SCARF.png", desc: "+15% speed, 20% faster attacks",   speedMul: 1.15, cdMul: 0.8 },
  sacred_ash:   { name: "Sacred Ash",   sprite: "sprites/items/SACRED_ASH.png",   desc: "Survive first lethal hit at 1 HP", sash: true },
  rocky_helmet: { name: "Rocky Helmet", sprite: "sprites/items/ROCKY_HELMET.png", desc: "Attackers take 2 recoil",          thorns: 2 },
  berserk_gene: { name: "Berserk Gene", sprite: "sprites/items/BERSERK_GENE.png", desc: "+60% damage, lose 1 HP/s",         dmgMul: 1.6, selfDrain: 1 },
  black_belt:   { name: "Black Belt",   sprite: "sprites/items/BLACK_BELT.png",   desc: "Super-effective hits deal 1.5x",   expertBelt: true },
  assault_vest: { name: "Assault Vest", sprite: "sprites/items/ASSAULT_VEST.png", desc: "Take 25% less damage",             defMul: 0.75 },
  /* ---- crafted items (combine two held components on one Pokémon) ---- */
  choice_specs:   { name: "Choice Specs",   sprite: "sprites/items/CHOICE_SPECS.png",   desc: "+100% damage",                                   dmgMul: 2.0, crafted: true },
  kings_rock:     { name: "King's Rock",    sprite: "sprites/items/KINGS_ROCK.png",     desc: "+40% dmg, +15% speed, hits can LAUNCH foes",     dmgMul: 1.4, speedMul: 1.15, kbOnHit: 0.2, crafted: true },
  shiny_charm:    { name: "Shiny Charm",    sprite: "sprites/items/SHINY_CHARM.png",    desc: "Regen 4 HP/s",                                   regen: 4, crafted: true },
  soul_dew:       { name: "Soul Dew",       sprite: "sprites/items/SOUL_DEW.png",       desc: "Take 35% less damage, regen 2 HP/s",             defMul: 0.65, regen: 2, crafted: true },
  light_ball:     { name: "Light Ball",     sprite: "sprites/items/LIGHT_BALL.png",     desc: "+60% damage, heal 40% of damage dealt",          dmgMul: 1.6, lifesteal: 0.4, crafted: true },
  protector:      { name: "Protector",      sprite: "sprites/items/PROTECTOR.png",      desc: "Attackers take 5 recoil, take 30% less damage",  thorns: 5, defMul: 0.7, crafted: true },
  max_revive:     { name: "Max Revive",     sprite: "sprites/items/MAX_REVIVE.png",     desc: "Survive TWO lethal hits at 1 HP, regen 1.5",     sash: true, sashCharges: 2, regen: 1.5, crafted: true },
  dynamax_band:   { name: "Dynamax Band",   sprite: "sprites/items/DYNAMAX_BAND.png",   desc: "+50% max HP, +20% damage",                       hpMul: 1.5, dmgMul: 1.2, crafted: true },
  explosive_band: { name: "Explosive Band", sprite: "sprites/items/EXPLOSIVE_BAND.png", desc: "+120% damage, lose 2.5 HP/s",                    dmgMul: 2.2, selfDrain: 2.5, crafted: true },
};

/* crafting recipes: two held components -> a crafted item (order-free) */
const RECIPES = {
  "muscle_band+muscle_band":   "choice_specs",
  "choice_scarf+muscle_band":  "kings_rock",
  "leftovers+leftovers":       "shiny_charm",
  "assault_vest+leftovers":    "soul_dew",
  "muscle_band+shell_bell":    "light_ball",
  "assault_vest+rocky_helmet": "protector",
  "leftovers+sacred_ash":      "max_revive",
  "black_belt+choice_scarf":   "dynamax_band",
  "berserk_gene+berserk_gene": "explosive_band",
};
function craftFor(a, b) {
  return RECIPES[[a, b].sort().join("+")] || null;
}
/* only components drop; crafted items come from combining */
const BASIC_ITEMS = Object.keys(ITEMS).filter(k => !ITEMS[k].crafted);

/* --------------------------------------------------------------------------
 * Projectile artwork — ported from the video engine's iconography
 * (flames w/ flicker cores, droplets w/ shine, spark orbs, wisp trails...)
 * ------------------------------------------------------------------------ */
const ART_BY_MOVE = {
  "Dragon Breath": "dragon",
  "Ember": "fire", "Flamethrower": "fire",
  "Water Gun": "water", "Hydro Pump": "water",
  "Thunderbolt": "zap", "Zap Cannon": "zap",
  "Ice Beam": "hail",
  "Aura Sphere": "aura",
  "Swift": "star",
  "Bonemerang": "bone",
  "Shadow Ball": "wisp",
  "Psychic": "psy", "Psystrike": "psy",
  "Hyper Beam": "dragon",
};
const ART_BY_TYPE = {
  fire: "fire", water: "water", electric: "zap", ice: "hail",
  fighting: "aura", ghost: "wisp", dark: "wisp", poison: "wisp",
  psychic: "psy", fairy: "psy", dragon: "dragon",
  rock: "rock", ground: "rock", steel: "star", normal: "star",
  bug: "star", grass: "leaf",
};
function projArtFor(moveName, type) {
  return ART_BY_MOVE[moveName] || ART_BY_TYPE[type] || "star";
}

/* --------------------------------------------------------------------------
 * Type synergies — 2/4 of a type on your battle team buff the whole team.
 * Duplicates count (pre-combine trios ramp you into the synergy).
 * Mods share the item-mod vocabulary + a few sim-specific extras.
 * ------------------------------------------------------------------------ */
const SYNERGY = {
  fire:     { label: "Blaze",     desc: "+20% / +40% damage",                      2: { dmgMul: 1.2 },                 4: { dmgMul: 1.4 } },
  water:    { label: "Torrent",   desc: "Regen 2.2 / 4.5 HP/s",                    2: { regen: 2.2 },                  4: { regen: 4.5 } },
  grass:    { label: "Overgrow",  desc: "+25% / +50% max HP",                      2: { hpMul: 1.25 },                 4: { hpMul: 1.5 } },
  electric: { label: "Static",    desc: "+12% / +24% speed & attack rate",         2: { speedMul: 1.12, cdMul: 0.88 }, 4: { speedMul: 1.24, cdMul: 0.76 } },
  psychic:  { label: "Foresight", desc: "12% / 25% dodge",                         2: { dodge: 0.12 },                 4: { dodge: 0.25 } },
  fighting: { label: "Guts",      desc: "+35% / +70% move charge rate",            2: { chargeMul: 1.35 },             4: { chargeMul: 1.7 } },
  rock:     { label: "Sturdy",    desc: "Take 15% / 30% less damage",              2: { defMul: 0.85 },                4: { defMul: 0.7 } },
  steel:    { label: "Iron Barbs",desc: "Attackers take 2 / 4 recoil",             2: { thorns: 2 },                   4: { thorns: 4 } },
  normal:   { label: "Adaptable", desc: "+14% / +28% HP and damage",               2: { hpMul: 1.14, dmgMul: 1.14 },   4: { hpMul: 1.28, dmgMul: 1.28 } },
  ghost:    { label: "Cursed Body", desc: "Heal 20% / 38% of damage dealt",        2: { lifesteal: 0.2 },              4: { lifesteal: 0.38 } },
  poison:   { label: "Toxic Touch", desc: "28% / 55% chance to poison on hit",     2: { poisonOnHit: 0.28 },           4: { poisonOnHit: 0.55 } },
  bug:      { label: "Swarm",     desc: "+12% / +22% speed and damage",            2: { speedMul: 1.12, dmgMul: 1.12 }, 4: { speedMul: 1.22, dmgMul: 1.22 } },
  dragon:   { label: "Dragon Force", desc: "+35% / +70% move damage",              2: { moveDmgMul: 1.35 },            4: { moveDmgMul: 1.7 } },
  ice:      { label: "Frostbite", desc: "25% / 48% chance to chill on hit",        2: { slowOnHit: 0.25 },             4: { slowOnHit: 0.48 } },
  fairy:    { label: "Pixie Aura", desc: "+40% / +85% healing received",           2: { healMul: 1.4 },                4: { healMul: 1.85 } },
  dark:     { label: "Ambush",    desc: "+40% / +80% damage to weakened foes",     2: { executeMul: 1.4 },             4: { executeMul: 1.8 } },
  ground:   { label: "Bedrock",   desc: "Take 12% / 24% less, deal 10% / 20% more", 2: { defMul: 0.88, dmgMul: 1.1 },  4: { defMul: 0.76, dmgMul: 1.2 } },
};
const SYN_THRESHOLDS = [2, 4];

/* count team types -> {type: count}; duplicates count */
function countTypes(unitList) {
  const counts = {};
  for (const u of unitList) {
    const t = UNITS[u.key].type;
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
}

/* -> [{type, count, tier(0|2|4), mods}] for every type present */
function computeSynergies(unitList) {
  const counts = countTypes(unitList);
  const out = [];
  for (const t in counts) {
    const spec = SYNERGY[t];
    if (!spec) continue;
    const tier = counts[t] >= 4 ? 4 : (counts[t] >= 2 ? 2 : 0);
    out.push({ type: t, count: counts[t], tier, mods: tier ? spec[tier] : null });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/* merge active synergy mods into one team-mod object */
function teamModsFrom(synergies) {
  const m = { dmgMul: 1, speedMul: 1, cdMul: 1, hpMul: 1, defMul: 1, regen: 0,
              dodge: 0, chargeMul: 1, lifesteal: 0, thorns: 0, moveDmgMul: 1,
              executeMul: 1, healMul: 1, poisonOnHit: 0, slowOnHit: 0 };
  for (const s of synergies) {
    if (!s.mods) continue;
    for (const k in s.mods) {
      if (k === "regen" || k === "dodge" || k === "lifesteal" || k === "thorns" ||
          k === "poisonOnHit" || k === "slowOnHit") m[k] += s.mods[k];
      else m[k] *= s.mods[k];
    }
  }
  return m;
}

/* --------------------------------------------------------------------------
 * Stage trainers — each stage is a named opponent with a themed team.
 * Scouting their theme (shown in the preview) is the counter-pick game.
 * ------------------------------------------------------------------------ */
const TRAINERS = [
  { name: "Youngster Joel",    types: ["normal", "electric"] },
  { name: "Bug Catcher Wade",  types: ["bug", "grass"] },
  { name: "Swimmer Marina",    types: ["water"] },
  { name: "Black Belt Koichi", types: ["fighting", "fire"] },
  { name: "Hiker Cliff",       types: ["rock", "ground", "steel"] },
  { name: "Channeler Mona",    types: ["ghost", "poison"] },
  { name: "Psychic Nova",      types: ["psychic", "fairy"] },
  { name: "Skier Aurora",      types: ["ice", "water"] },
  { name: "Dragon Tamer Rex",  types: ["dragon"] },
  { name: "CHAMPION MEWTWO",   types: ["psychic", "dragon"], boss: true },
];

/* --------------------------------------------------------------------------
 * Economy / progression tuning
 * ------------------------------------------------------------------------ */
const ECON = {
  startGold: 12,
  startHP: 100,
  baseIncome: 5,
  interestPer: 10,   // +1 gold per 10 held
  interestCap: 5,
  winBonus: 1,
  streakBonus: [0, 0, 1, 2, 3],  // by streak length (cap)
  rerollCost: 2,
  maxRounds: 10,
  shopSlots: 5,
  itemRounds: [2, 4, 6, 8],      // item choice after these rounds
  lossDamage: (round, survivors) => 4 + 2 * survivors + Math.floor(round / 2),
  teamCap: (round) => Math.min(2 + Math.floor((round - 1) / 2), 6),
  benchCap: 8,
};

/* Shop tier odds by round (index 0 = tier1 ... 4 = tier5), TFT-style. */
const SHOP_ODDS = [
  [100, 0, 0, 0, 0],     // r1
  [80, 20, 0, 0, 0],     // r2
  [65, 30, 5, 0, 0],     // r3
  [50, 35, 15, 0, 0],    // r4
  [40, 35, 20, 5, 0],    // r5
  [30, 35, 25, 10, 0],   // r6
  [25, 30, 30, 12, 3],   // r7
  [20, 25, 30, 18, 7],   // r8
  [15, 22, 30, 22, 11],  // r9
  [10, 20, 28, 27, 15],  // r10
];

/* Enemy team budgets per round (unit "power points" = cost incl. stars). */
const ENEMY_PLAN = [
  { budget: 3,  maxTier: 1, units: 2 },  // r1
  { budget: 4,  maxTier: 1, units: 2 },  // r2
  { budget: 7,  maxTier: 2, units: 3 },  // r3
  { budget: 9,  maxTier: 2, units: 3 },  // r4
  { budget: 13, maxTier: 3, units: 4 },  // r5
  { budget: 17, maxTier: 3, units: 4 },  // r6
  { budget: 22, maxTier: 4, units: 5 },  // r7
  { budget: 27, maxTier: 4, units: 5 },  // r8
  { budget: 34, maxTier: 5, units: 6 },  // r9
  { budget: 42, maxTier: 5, units: 6, boss: true },  // r10 boss
];

/* --------------------------------------------------------------------------
 * Arena themes — pale palettes (sprites must stay readable), picked per
 * stage from the trainer's types (video engine's 5-arena system).
 * ------------------------------------------------------------------------ */
const ARENA_THEMES = {
  meadow: { field: "#ecfaf6", tint: [18, 161, 146] },
  beach:  { field: "#fdf6e1", tint: [214, 158, 60] },
  snow:   { field: "#eff6fd", tint: [110, 160, 220] },
  cave:   { field: "#f2eef9", tint: [138, 112, 190] },
  desert: { field: "#faf0dc", tint: [196, 124, 72] },
};
function themeForTypes(types) {
  for (const t of types || []) {
    if (["water"].includes(t)) return "beach";
    if (["ice"].includes(t)) return "snow";
    if (["ghost", "poison", "dark", "psychic"].includes(t)) return "cave";
    if (["rock", "ground", "steel", "fire", "fighting"].includes(t)) return "desert";
  }
  return "meadow";
}

/* Battle sim tuning — mirrors pokemon_spheres.py constants */
const SIM = {
  arenaW: 920, arenaH: 540,
  baseVel: 245,          // px/s at speed 1.0
  seekRate: 1.7,         // rad/s steering toward nearest enemy (team fights need
                         // stronger homing than the 1v1 engine's 1.15)
  hitCooldown: 0.42,     // per-attacker melee cooldown (team fights: slower than 1v1's 0.26)
  weaponOmega: 3.4,      // weapon orbit rad/s
  weaponLen: 30,         // tip distance beyond ball radius
  tipR: 13,              // weapon tip hit radius
  chargeOnHit: 1.0,
  chargeOnTaken: 0.5,
  suddenDeathT: 20,      // team fights run a bit longer than 1v1's 21s
  suddenDeathRamp: 0.28, // +28% dmg per second past SD (DoTs/heals must not stall)
  timeout: 45,
  dt: 1 / 60,
};
