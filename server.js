// server.js — «Шифрувальний квест»: Express-сервер.
// Відповіді перевіряються лише на сервері. Прогрес кожного учня (етап, помилки, підказки, час)
// зберігається в сховищі (PostgreSQL або JSON-файл, див. store.js) і показується вчителю на /teacher.
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { QUESTIONS, isCorrect, publicView, ABC, POLY } = require("./questions");
const store = require("./store")();

const PORT = process.env.PORT || 3000;
const SECRET = process.env.QUIZ_SECRET || crypto.randomBytes(32).toString("hex");
// Ключ очищуємо від пробілів і лапок, які часто потрапляють у змінні середовища на хостингах
const cleanKey = (v) => String(v || "").normalize("NFC").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
const TEACHER_KEY = cleanKey(process.env.TEACHER_KEY);
const TOTAL = QUESTIONS.length;
if (!process.env.QUIZ_SECRET) console.warn("⚠ QUIZ_SECRET не задано: після перезапуску сервера учні не зможуть продовжити розпочаті спроби.");
if (!TEACHER_KEY) console.warn("⚠ TEACHER_KEY не задано: сторінка вчителя /teacher вимкнена.");
else console.log(`TEACHER_KEY задано (${[...TEACHER_KEY].length} символів).`);

/* ---------- токен: підписаний id спроби (сам прогрес — у сховищі) ---------- */
const sign = (data) => crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
const makeToken = (id) => `${id}.${sign(id)}`;
function tokenId(t) {
  if (typeof t !== "string" || !t.includes(".")) return null;
  const [id, s] = t.split(".");
  const good = sign(id);
  if (!s || s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  return id;
}

/* ---------- черга на кожну спробу: два швидкі натискання не зіпсують лічильники ---------- */
const locks = new Map();
function withLock(id, fn) {
  const prev = locks.get(id) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}

/* ---------- обмежувач частоти: на учня окремо, а не на IP (клас виходить з однієї адреси) ---------- */
const hits = new Map();
const LIMIT_PER_ATTEMPT = Number(process.env.LIMIT_PER_ATTEMPT) || 20; // відповідей за хвилину від одного учня
const LIMIT_PER_IP = 1500;
function bump(k, limit) {
  const now = Date.now();
  const h = (hits.get(k) || []).filter((t) => now - t < 60_000); h.push(now); hits.set(k, h);
  return h.length > limit;
}
function rateLimit(req, res, next) {
  const id = tokenId(req.body?.token);
  if ((id && bump("a:" + id, LIMIT_PER_ATTEMPT)) || bump("ip:" + req.ip, LIMIT_PER_IP))
    return res.status(429).json({ error: "Забагато спроб. Зачекайте хвилину." });
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (!h.some((t) => now - t < 60_000)) hits.delete(k); }, 300_000).unref();

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: "Помилка сервера. Спробуйте ще раз." }); });
const NOT_FOUND = { error: "Спробу не знайдено. Почніть заново." };
const stateOf = (a) => ({ token: makeToken(a.id), errors: a.errors, hints: a.hints, hintShown: a.hintShown });
const finishedView = (a) => ({ finished: true, name: a.name, total: TOTAL, timeMs: a.finishedAt - a.startedAt, errors: a.errors, hints: a.hints });
async function attemptFrom(req) { const id = tokenId(req.body?.token); return id ? store.get(id) : null; }

app.get("/api/reference", (_req, res) => res.json({ abc: ABC, poly: POLY }));

app.post("/api/start", rateLimit, wrap(async (req, res) => {
  const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "Введіть прізвище та ім’я." });
  const now = Date.now();
  const a = { id: crypto.randomUUID(), name, idx: 0, errors: 0, hints: 0, hintShown: false, qErrors: Array(TOTAL).fill(0),
    startedAt: now, updatedAt: now, stageStartedAt: now, finishedAt: 0 };
  await store.save(a);
  res.json({ ...stateOf(a), question: publicView(QUESTIONS[0], 0) });
}));

app.post("/api/resume", wrap(async (req, res) => {
  const a = await attemptFrom(req);
  if (!a) return res.status(400).json(NOT_FOUND);
  if (a.finishedAt) return res.json({ ...stateOf(a), ...finishedView(a) });
  res.json({ ...stateOf(a), question: publicView(QUESTIONS[a.idx], a.idx), hint: a.hintShown ? QUESTIONS[a.idx].hint : null });
}));

app.post("/api/answer", rateLimit, wrap(async (req, res) => {
  const id = tokenId(req.body?.token);
  if (!id) return res.status(400).json(NOT_FOUND);
  const out = await withLock(id, async () => {
    const a = await store.get(id);
    if (!a || a.finishedAt) return { status: 400, body: NOT_FOUND };
    const now = Date.now(); a.updatedAt = now;
    if (!isCorrect(QUESTIONS[a.idx], req.body?.answer)) {
      a.errors++; a.qErrors[a.idx]++;
      await store.save(a);
      return { body: { correct: false, ...stateOf(a) } };
    }
    a.idx++; a.hintShown = false; a.stageStartedAt = now;
    if (a.idx >= TOTAL) { a.finishedAt = now; await store.save(a); return { body: { correct: true, ...stateOf(a), ...finishedView(a) } }; }
    await store.save(a);
    return { body: { correct: true, ...stateOf(a), question: publicView(QUESTIONS[a.idx], a.idx) } };
  });
  res.status(out.status || 200).json(out.body);
}));

app.post("/api/hint", wrap(async (req, res) => {
  const id = tokenId(req.body?.token);
  if (!id) return res.status(400).json(NOT_FOUND);
  const out = await withLock(id, async () => {
    const a = await store.get(id);
    if (!a || a.finishedAt) return { status: 400, body: NOT_FOUND };
    if (!a.hintShown) { a.hintShown = true; a.hints++; a.updatedAt = Date.now(); await store.save(a); }
    return { body: { hint: QUESTIONS[a.idx].hint, ...stateOf(a) } };
  });
  res.status(out.status || 200).json(out.body);
}));

/* ================= сторінки вчителя ================= */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const kyiv = (ms) => new Date(ms).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const kyivDay = (ms) => new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }); // РРРР-ММ-ДД
const ago = (ms) => { const s = Math.round((Date.now() - ms) / 1000); if (s < 60) return `${s} с тому`; if (s < 3600) return `${Math.floor(s / 60)} хв тому`;
  if (s < 86400) return `${Math.floor(s / 3600)} год тому`; return kyiv(ms); };
const digest = (v) => crypto.createHash("sha256").update(v).digest();
const keyOk = (v) => crypto.timingSafeEqual(digest(cleanKey(v)), digest(TEACHER_KEY));
const STUCK_MS = 5 * 60_000, IDLE_MS = 10 * 60_000;

const page = (title, body, extraHead = "") => `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap">
<link rel="stylesheet" href="/style.css">${extraHead}</head><body><main class="wrap wide">${body}</main></body></html>`;

function loginPage(res, status, message) {
  res.status(status).send(page("Вхід для вчителя", `
<header><div><h1>Вхід для <span>вчителя</span></h1><div class="sub">Прогрес і результати квесту</div></div></header>
<section class="card"><form method="get" action="/teacher">
<input class="name" type="password" name="key" placeholder="Ключ учителя (TEACHER_KEY)" autocomplete="current-password" required autofocus>
<button class="primary" type="submit">Увійти</button></form>
${message ? `<div class="msg bad">${message}</div>` : ""}</section>`));
}
function teacherAuth(req, res) {
  if (!TEACHER_KEY) { res.status(404).send("Сторінку вчителя вимкнено: задайте змінну середовища TEACHER_KEY і перезапустіть сервіс."); return false; }
  const key = req.query.key ?? req.body?.key;
  if (key === undefined) { loginPage(res, 401, ""); return false; }
  if (!keyOk(key)) { loginPage(res, 403, "Ключ не підходить. Перевірте розкладку клавіатури й регістр літер."); return false; }
  return true;
}

function statusOf(a, now) {
  if (a.finishedAt) return { code: "done", label: "Завершив(ла)" };
  if (now - a.updatedAt > IDLE_MS) return { code: "idle", label: "Неактивний(а)" };
  if (now - a.stageStartedAt > STUCK_MS || a.qErrors[a.idx] >= 5) return { code: "stuck", label: "Застряг(ла)" };
  return { code: "work", label: "Працює" };
}

app.get("/teacher", wrap(async (req, res) => {
  if (!teacherAuth(req, res)) return;
  const key = encodeURIComponent(cleanKey(req.query.key));
  const now = Date.now();
  const all = await store.list();
  const days = [...new Set(all.map((a) => kyivDay(a.startedAt)))].sort().reverse();
  const day = req.query.day === "all" ? "all" : (req.query.day || days[0] || kyivDay(now));
  const list = all.filter((a) => day === "all" || kyivDay(a.startedAt) === day);
  const order = { stuck: 0, work: 1, idle: 2, done: 3 };
  list.sort((a, b) => order[statusOf(a, now).code] - order[statusOf(b, now).code] || a.name.localeCompare(b.name, "uk"));

  const count = (c) => list.filter((a) => statusOf(a, now).code === c).length;
  const rows = list.map((a) => {
    const st = statusOf(a, now);
    const done = a.finishedAt ? TOTAL : a.idx;
    const q = QUESTIONS[a.idx];
    const stage = a.finishedAt ? "—" : `<b>${a.idx + 1}.</b> ${esc(q.section)} · ${esc(q.title)}`;
    return `<tr class="st-${st.code}">
<td><b>${esc(a.name)}</b><div class="small">почав(ла) ${kyiv(a.startedAt)}</div></td>
<td><div class="bar"><i style="width:${(done / TOTAL) * 100}%"></i></div><div class="small">${done} з ${TOTAL}</div></td>
<td>${stage}</td>
<td class="num">${a.finishedAt ? "—" : a.qErrors[a.idx]} / ${a.errors}</td>
<td class="num">${a.hints}</td>
<td class="num">${a.finishedAt ? mmss(a.finishedAt - a.startedAt) : mmss(now - a.stageStartedAt)}</td>
<td>${ago(a.updatedAt)}</td>
<td><span class="pill ${st.code}">${st.label}</span></td>
<td><form method="post" action="/teacher/delete" onsubmit="return confirm('Видалити спробу «${esc(a.name).replace(/'/g, "")}»?')">
<input type="hidden" name="key" value="${esc(cleanKey(req.query.key))}"><input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="day" value="${esc(day)}">
<button class="link" type="submit" title="Видалити спробу">✕</button></form></td></tr>`;
  }).join("");

  // теплова карта: скільки учнів зараз на кожному завданні і скільки помилок на ньому зроблено
  const onQ = Array(TOTAL).fill(0), errQ = Array(TOTAL).fill(0);
  for (const a of list) { if (!a.finishedAt) onQ[a.idx]++; a.qErrors.forEach((e, i) => { errQ[i] += e; }); }
  const maxErr = Math.max(1, ...errQ);
  const heat = QUESTIONS.map((q, i) => `<div class="hq" style="--h:${errQ[i] / maxErr}${errQ[i] / maxErr > 0.5 ? ";color:var(--accent-ink)" : ""}" title="${i + 1}. ${esc(q.title)} — помилок: ${errQ[i]}, зараз на завданні: ${onQ[i]}">
<span class="hn">${i + 1}</span><span class="he">${errQ[i]}</span>${onQ[i] ? `<span class="ho">${onQ[i]}</span>` : ""}</div>`).join("");

  const dayOpts = [...new Set([kyivDay(now), ...days])].sort().reverse().map((d) => `<option value="${d}"${d === day ? " selected" : ""}>${d}</option>`).join("")
    + `<option value="all"${day === "all" ? " selected" : ""}>усі дні</option>`;

  res.send(page("Прогрес квесту", `
<header><div><h1>Прогрес <span>квесту</span></h1>
<div class="sub">Оновлюється кожні 15 с · прогрес зберігається: ${store.durable ? "у базі даних PostgreSQL" : "у файлі на сервері"}</div>
${store.durable ? "" : `<div class="small warnline">Без бази даних прогрес може зникнути під час перезапуску сервісу на хостингу. Підключіть PostgreSQL (див. README).</div>`}</div>
<div class="row"><form method="get" action="/teacher" class="dayform"><input type="hidden" name="key" value="${esc(cleanKey(req.query.key))}">
<label for="day" class="small">День</label><select id="day" name="day" onchange="this.form.submit()">${dayOpts}</select></form>
<a class="ghost btn" href="/teacher.csv?key=${key}&day=${encodeURIComponent(day)}">CSV</a><a class="ghost btn" href="/teacher/answers?key=${key}">Ключі</a></div></header>
<section class="kpis">
<div class="stat"><b>${list.length}</b><span>усього спроб</span></div>
<div class="stat"><b>${count("work")}</b><span>працюють</span></div>
<div class="stat warn"><b>${count("stuck")}</b><span>застрягли (&gt;5 хв або ≥5 помилок на етапі)</span></div>
<div class="stat"><b>${count("done")}</b><span>завершили</span></div></section>
<section class="card"><h2>Де найважче</h2><p class="small">Число внизу — помилки на завданні (що темніше, то більше), кружечок — скільки учнів зараз на ньому.</p>
<div class="heat">${heat}</div></section>
<section class="card"><div class="tbl"><table class="results live"><thead><tr><th>Учень</th><th>Пройдено</th><th>Поточне завдання</th><th>Помилок<br><span class="small">етап / усього</span></th><th>Підказок</th><th>Час<br><span class="small">на етапі / загалом</span></th><th>Остання дія</th><th>Стан</th><th></th></tr></thead>
<tbody>${rows || `<tr><td colspan="9">За цей день спроб немає. Учні з’являться тут, щойно натиснуть «Почати».</td></tr>`}</tbody></table></div></section>`,
  `<meta http-equiv="refresh" content="15">`));
}));

app.post("/teacher/delete", wrap(async (req, res) => {
  if (!teacherAuth(req, res)) return;
  if (req.body.id) await store.remove(String(req.body.id));
  res.redirect(303, `/teacher?key=${encodeURIComponent(cleanKey(req.body.key))}&day=${encodeURIComponent(req.body.day || "")}`);
}));

app.get("/teacher.csv", wrap(async (req, res) => {
  if (!teacherAuth(req, res)) return;
  const day = req.query.day || "all";
  const now = Date.now();
  const list = (await store.list()).filter((a) => day === "all" || kyivDay(a.startedAt) === day).sort((a, b) => a.startedAt - b.startedAt);
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const head = ["Учень", "Початок", "Стан", "Пройдено завдань", "Поточне завдання", "Помилок", "Підказок", "Час, хв:с", ...QUESTIONS.map((_, i) => `Помилки ${i + 1}`)];
  const lines = list.map((a) => [q(a.name), q(kyiv(a.startedAt)), q(statusOf(a, now).label), a.finishedAt ? TOTAL : a.idx,
    q(a.finishedAt ? "—" : `${a.idx + 1}. ${QUESTIONS[a.idx].title}`), a.errors, a.hints,
    q(mmss((a.finishedAt || now) - a.startedAt)), ...a.qErrors].join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="cipher-quest-${day}.csv"`);
  res.send("﻿" + [head.map(q).join(";"), ...lines].join("\r\n"));
}));

app.get("/teacher/answers", (req, res) => {
  if (!teacherAuth(req, res)) return;
  const rows = QUESTIONS.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.section)}</td><td>${esc(x.title)}</td><td class="mono">${esc(x.show)}</td><td class="mono"><b>${esc(x.answer)}</b> ${esc(x.unit || "")}</td></tr>`).join("");
  res.send(page("Ключі квесту", `
<header><div><h1>Ключі <span>квесту</span></h1><div class="sub">Лише для вчителя</div></div><a class="ghost btn" href="/teacher?key=${encodeURIComponent(cleanKey(req.query.key))}">← Прогрес</a></header>
<section class="card"><div class="tbl"><table class="results"><thead><tr><th>№</th><th>Розділ</th><th>Завдання</th><th>Умова</th><th>Відповідь</th></tr></thead><tbody>${rows}</tbody></table></div></section>`));
});

app.get("/healthz", (_req, res) => res.send("ok"));

app.ready = store.init();
app.store = store;
if (require.main === module) {
  app.ready.then(() => app.listen(PORT, () => console.log(`Шифрувальний квест: http://localhost:${PORT} · прогрес зберігається: ${store.durable ? "PostgreSQL" : "файл (задайте DATABASE_URL для постійного зберігання)"}`)))
    .catch((e) => { console.error("Не вдалося підключитися до сховища:", e.message); process.exit(1); });
}
module.exports = app;
