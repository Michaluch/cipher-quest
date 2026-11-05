// store.js — сховище прогресу учнів.
// Якщо задано DATABASE_URL — PostgreSQL (дані переживають перезапуски й оновлення сервісу).
// Інакше — JSON-файл (зручно для локального запуску; на безкоштовних хостингах файл зникає під час перезапуску).
const fs = require("fs");
const path = require("path");

/* Спроба учня:
   { id, name, idx (поточне завдання, 0…29; 30 = завершено), errors, hints, hintShown,
     qErrors: [помилки на кожному завданні], startedAt, updatedAt, stageStartedAt, finishedAt } — час у мс */

function fileStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; }
  let timer = null;
  const flush = () => {
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".tmp", JSON.stringify(data));
      fs.renameSync(file + ".tmp", file); // атомарний запис: файл не зіпсується, якщо процес упаде посеред запису
    } catch (e) { console.error("Не вдалося зберегти прогрес:", e.message); }
  };
  const schedule = () => { if (!timer) timer = setTimeout(flush, 300); };
  process.on("SIGTERM", () => { if (timer) { clearTimeout(timer); flush(); } process.exit(0); });
  return {
    kind: "файл", durable: false,
    async init() {},
    async get(id) { return data[id] ? { ...data[id], qErrors: [...data[id].qErrors] } : null; },
    async save(a) { data[a.id] = { ...a, qErrors: [...a.qErrors] }; schedule(); },
    async list() { return Object.values(data); },
    async remove(id) { delete data[id]; schedule(); },
    async flush() { if (timer) { clearTimeout(timer); flush(); } },
  };
}

function pgStore(url) {
  const { Pool } = require("pg");
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local || process.env.PGSSL === "off" ? false : { rejectUnauthorized: false } });
  const toRow = (r) => r && ({
    id: r.id, name: r.name, idx: r.idx, errors: r.errors, hints: r.hints, hintShown: r.hint_shown,
    qErrors: r.q_errors, startedAt: Number(r.started_at), updatedAt: Number(r.updated_at),
    stageStartedAt: Number(r.stage_started_at), finishedAt: r.finished_at ? Number(r.finished_at) : 0,
  });
  return {
    kind: "PostgreSQL", durable: true,
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, idx INT NOT NULL, errors INT NOT NULL, hints INT NOT NULL,
        hint_shown BOOLEAN NOT NULL, q_errors JSONB NOT NULL, started_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        stage_started_at BIGINT NOT NULL, finished_at BIGINT)`);
    },
    async get(id) { const r = await pool.query("SELECT * FROM attempts WHERE id = $1", [id]); return toRow(r.rows[0]); },
    async save(a) {
      await pool.query(`INSERT INTO attempts (id,name,idx,errors,hints,hint_shown,q_errors,started_at,updated_at,stage_started_at,finished_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET idx=$3, errors=$4, hints=$5, hint_shown=$6, q_errors=$7, updated_at=$9, stage_started_at=$10, finished_at=$11`,
        [a.id, a.name, a.idx, a.errors, a.hints, a.hintShown, JSON.stringify(a.qErrors), a.startedAt, a.updatedAt, a.stageStartedAt, a.finishedAt || null]);
    },
    async list() { const r = await pool.query("SELECT * FROM attempts"); return r.rows.map(toRow); },
    async remove(id) { await pool.query("DELETE FROM attempts WHERE id = $1", [id]); },
    async flush() {},
  };
}

module.exports = function createStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return fileStore(process.env.PROGRESS_FILE || path.join(__dirname, "data", "progress.json"));
};
