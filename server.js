// server.js — «Шифрувальний квест»: Express-сервер.
// Відповіді перевіряються лише на сервері. Прогрес учня зберігається в підписаному токені (HMAC),
// тож сервер не має стану й працює на будь-якому хостингу, навіть з кількома екземплярами.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { QUESTIONS, isCorrect, publicView, ABC, POLY } = require("./questions");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.QUIZ_SECRET || crypto.randomBytes(32).toString("hex");
const TEACHER_KEY = process.env.TEACHER_KEY || "";
const RESULTS_FILE = process.env.RESULTS_FILE || path.join(__dirname, "data", "results.json");
if (!process.env.QUIZ_SECRET) console.warn("⚠ QUIZ_SECRET не задано: після перезапуску сервера незавершені спроби учнів скинуться.");
if (!TEACHER_KEY) console.warn("⚠ TEACHER_KEY не задано: сторінка результатів /teacher вимкнена.");

/* ---------- токен прогресу ---------- */
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
function makeToken(st) { const d = b64(JSON.stringify(st)); return `${d}.${sign(d)}`; }
function readToken(t) {
  if (typeof t !== "string" || !t.includes(".")) return null;
  const [d, s] = t.split(".");
  const good = sign(d);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { return JSON.parse(Buffer.from(d, "base64url").toString()); } catch { return null; }
}

/* ---------- результати ---------- */
let results = [];
try { results = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")); } catch { results = []; }
function saveResult(r) {
  if (results.some((x) => x.id === r.id)) return; // одна спроба — один запис
  results.push(r);
  try { fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true }); fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 1)); }
  catch (e) { console.error("Не вдалося зберегти результати:", e.message); }
}

/* ---------- простий обмежувач частоти (захист від перебору відповідей) ----------
   Ліміт рахується для кожної спроби учня окремо (за id у токені), а не для IP:
   увесь клас зазвичай виходить в інтернет з однієї шкільної адреси. */
const hits = new Map();
const LIMIT_PER_ATTEMPT = Number(process.env.LIMIT_PER_ATTEMPT) || 20;// відповідей за хвилину від одного учня
const LIMIT_PER_IP = 1500;      // загальний запобіжник на одну адресу
function bump(k, limit) {
  const now = Date.now();
  const h = (hits.get(k) || []).filter((t) => now - t < 60_000); h.push(now); hits.set(k, h);
  return h.length > limit;
}
function rateLimit(req, res, next) {
  const id = readToken(req.body?.token)?.id;
  if ((id && bump("a:" + id, LIMIT_PER_ATTEMPT)) || bump("ip:" + req.ip, LIMIT_PER_IP))
    return res.status(429).json({ error: "Забагато спроб. Зачекайте хвилину." });
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (!h.some((t) => now - t < 60_000)) hits.delete(k); }, 300_000).unref();

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const state = (st) => ({ token: makeToken(st), errors: st.e, hints: st.h, hintShown: !!st.hs });
const finishedView = (st) => ({ finished: true, name: st.n, total: QUESTIONS.length, timeMs: st.f - st.s, errors: st.e, hints: st.h });

app.get("/api/reference", (_req, res) => res.json({ abc: ABC, poly: POLY }));

app.post("/api/start", rateLimit, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Введіть прізвище та ім’я." });
  const st = { id: crypto.randomUUID(), n: name, i: 0, e: 0, h: 0, hs: 0, s: Date.now(), f: 0 };
  res.json({ ...state(st), question: publicView(QUESTIONS[0], 0) });
});

app.post("/api/resume", (req, res) => {
  const st = readToken(req.body?.token);
  if (!st) return res.status(400).json({ error: "Спробу не знайдено. Почніть заново." });
  if (st.f) return res.json({ ...state(st), ...finishedView(st) });
  res.json({ ...state(st), question: publicView(QUESTIONS[st.i], st.i), hint: st.hs ? QUESTIONS[st.i].hint : null });
});

app.post("/api/answer", rateLimit, (req, res) => {
  const st = readToken(req.body?.token);
  if (!st || st.f) return res.status(400).json({ error: "Спробу не знайдено. Почніть заново." });
  const q = QUESTIONS[st.i];
  if (!isCorrect(q, req.body?.answer)) {
    st.e++;
    return res.json({ correct: false, ...state(st) });
  }
  st.i++; st.hs = 0;
  if (st.i >= QUESTIONS.length) {
    st.f = Date.now();
    saveResult({ id: st.id, name: st.n, finishedAt: new Date(st.f).toISOString(), timeMs: st.f - st.s, errors: st.e, hints: st.h });
    return res.json({ correct: true, ...state(st), ...finishedView(st) });
  }
  res.json({ correct: true, ...state(st), question: publicView(QUESTIONS[st.i], st.i) });
});

app.post("/api/hint", (req, res) => {
  const st = readToken(req.body?.token);
  if (!st || st.f) return res.status(400).json({ error: "Спробу не знайдено. Почніть заново." });
  if (!st.hs) { st.hs = 1; st.h++; }
  res.json({ hint: QUESTIONS[st.i].hint, ...state(st) });
});

/* ---------- сторінка вчителя ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function teacherAuth(req, res) {
  if (!TEACHER_KEY) { res.status(404).send("Сторінку результатів вимкнено: задайте змінну TEACHER_KEY."); return false; }
  if (req.query.key !== TEACHER_KEY) { res.status(403).send("Невірний ключ учителя."); return false; }
  return true;
}
app.get("/teacher", (req, res) => {
  if (!teacherAuth(req, res)) return;
  const rows = [...results].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).map((r) =>
    `<tr><td>${esc(r.name)}</td><td>${new Date(r.finishedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}</td><td>${mmss(r.timeMs)}</td><td>${r.errors}</td><td>${r.hints}</td></tr>`).join("");
  const key = encodeURIComponent(req.query.key);
  res.send(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Результати квесту</title><link rel="stylesheet" href="/style.css"></head><body><main class="wrap">
<header><div><h1>Результати <span>квесту</span></h1><div class="sub">Завершили: ${results.length} · запитань у квесті: ${QUESTIONS.length}</div></div>
<div class="row"><a class="ghost btn" href="/teacher.csv?key=${key}">Завантажити CSV</a><a class="ghost btn" href="/teacher/answers?key=${key}">Ключі</a></div></header>
<section class="card"><div class="tbl"><table class="results"><thead><tr><th>Учень</th><th>Завершено</th><th>Час</th><th>Помилок</th><th>Підказок</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">Поки що ніхто не завершив квест.</td></tr>'}</tbody></table></div></section></main></body></html>`);
});
app.get("/teacher.csv", (req, res) => {
  if (!teacherAuth(req, res)) return;
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = ["Учень;Завершено;Час (хв:с);Помилок;Підказок",
    ...results.map((r) => [q(r.name), q(r.finishedAt), q(mmss(r.timeMs)), r.errors, r.hints].join(";"))].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="results.csv"');
  res.send("﻿" + csv);
});
app.get("/teacher/answers", (req, res) => {
  if (!teacherAuth(req, res)) return;
  const rows = QUESTIONS.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.section)}</td><td>${esc(x.title)}</td><td class="mono">${esc(x.show)}</td><td class="mono"><b>${esc(x.answer)}</b> ${esc(x.unit || "")}</td></tr>`).join("");
  res.send(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ключі квесту</title><link rel="stylesheet" href="/style.css"></head><body><main class="wrap">
<header><div><h1>Ключі <span>квесту</span></h1><div class="sub">Лише для вчителя</div></div><a class="ghost btn" href="/teacher?key=${encodeURIComponent(req.query.key)}">← Результати</a></header>
<section class="card"><div class="tbl"><table class="results"><thead><tr><th>№</th><th>Розділ</th><th>Завдання</th><th>Умова</th><th>Відповідь</th></tr></thead><tbody>${rows}</tbody></table></div></section></main></body></html>`);
});

app.get("/healthz", (_req, res) => res.send("ok"));

if (require.main === module) app.listen(PORT, () => console.log(`Шифрувальний квест: http://localhost:${PORT}`));
module.exports = app;
