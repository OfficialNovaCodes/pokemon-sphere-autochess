/* ==========================================================================
 * Persistence — Postgres when DATABASE_URL is set (Heroku), otherwise an
 * in-memory fallback so local dev works with zero setup.
 * Stores: player ratings (Elo survives dyno restarts) + daily scores.
 * ========================================================================== */

let pool = null;
const mem = { players: new Map(), daily: new Map() };  // fallback

async function init() {
  if (!process.env.DATABASE_URL) {
    console.log("[db] no DATABASE_URL — using in-memory store");
    return;
  }
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      name    TEXT PRIMARY KEY,
      rating  INT NOT NULL DEFAULT 1000,
      games   INT NOT NULL DEFAULT 0,
      wins    INT NOT NULL DEFAULT 0,
      updated TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS daily_scores (
      day   TEXT NOT NULL,
      name  TEXT NOT NULL,
      score INT NOT NULL,
      ts    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (day, name)
    );
  `);
  console.log("[db] postgres ready");
}

async function getRating(name) {
  if (pool) {
    const r = await pool.query("SELECT rating FROM players WHERE name = $1", [name]);
    return r.rows.length ? r.rows[0].rating : null;
  }
  return mem.players.has(name) ? mem.players.get(name).rating : null;
}

async function saveResult(name, rating, won) {
  if (pool) {
    await pool.query(`
      INSERT INTO players (name, rating, games, wins, updated)
      VALUES ($1, $2, 1, $3, now())
      ON CONFLICT (name) DO UPDATE SET
        rating = $2, games = players.games + 1,
        wins = players.wins + $3, updated = now()
    `, [name, rating, won ? 1 : 0]);
  } else {
    const p = mem.players.get(name) || { rating: 1000, games: 0, wins: 0 };
    p.rating = rating; p.games += 1; p.wins += won ? 1 : 0;
    mem.players.set(name, p);
  }
}

async function topPlayers(limit = 20) {
  if (pool) {
    const r = await pool.query(
      "SELECT name, rating, games, wins FROM players ORDER BY rating DESC LIMIT $1", [limit]);
    return r.rows;
  }
  return [...mem.players.entries()]
    .map(([name, p]) => ({ name, ...p }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit);
}

async function submitDaily(day, name, score) {
  if (pool) {
    await pool.query(`
      INSERT INTO daily_scores (day, name, score, ts) VALUES ($1, $2, $3, now())
      ON CONFLICT (day, name) DO UPDATE SET
        score = GREATEST(daily_scores.score, $3), ts = now()
    `, [day, name, score]);
  } else {
    const key = day + "|" + name;
    mem.daily.set(key, Math.max(mem.daily.get(key) || 0, score));
  }
}

async function topDaily(day, limit = 20) {
  if (pool) {
    const r = await pool.query(
      "SELECT name, score FROM daily_scores WHERE day = $1 ORDER BY score DESC LIMIT $2",
      [day, limit]);
    return r.rows;
  }
  return [...mem.daily.entries()]
    .filter(([k]) => k.startsWith(day + "|"))
    .map(([k, score]) => ({ name: k.split("|")[1], score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { init, getRating, saveResult, topPlayers, submitDaily, topDaily };
