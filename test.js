// test.js — проходить квест через API й перевіряє збереження прогресу та сторінку вчителя.
const os = require("os"), path = require("path"), fs = require("fs");
const FILE = path.join(os.tmpdir(), `cq-test-${Date.now()}.json`);
Object.assign(process.env, { TEACHER_KEY: "test-key", QUIZ_SECRET: "test-secret", LIMIT_PER_ATTEMPT: "1000", PROGRESS_FILE: FILE });
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; else delete process.env.DATABASE_URL;
const assert = require("assert");
const app = require("./server");
const { QUESTIONS } = require("./questions");

(async () => {
  await app.ready;
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, b) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const get = (p) => fetch(base + p).then((r) => r.text());

  let r = await post("/api/start", { name: "" }); assert.equal(r.status, 400);
  r = await post("/api/start", { name: "Тестовий Учень" }); const t = r.token;
  assert.equal(r.question.n, 1); assert.ok(!("answer" in r.question), "відповідь не має йти на клієнт");

  r = await post("/api/answer", { token: t, answer: "999" }); assert.equal(r.correct, false); assert.equal(r.errors, 1);
  r = await post("/api/hint", { token: t }); assert.ok(r.hint);
  r = await post("/api/hint", { token: t }); assert.equal(r.hints, 1, "повторна підказка не рахується двічі");
  r = await post("/api/answer", { token: t.split(".")[0] + ".AAAA", answer: "1" }); assert.equal(r.status, 400, "підроблений токен");

  // одночасні відповіді не мають зіпсувати лічильник
  await Promise.all([1, 2, 3].map(() => post("/api/answer", { token: t, answer: "0" })));
  r = await post("/api/resume", { token: t }); assert.equal(r.errors, 4); assert.equal(r.question.n, 1);

  // проходимо 10 завдань — учитель має бачити етап 11
  for (let i = 0; i < 10; i++) { r = await post("/api/answer", { token: t, answer: QUESTIONS[i].answer }); assert.equal(r.correct, true); }
  r = await post("/api/start", { name: "Друга Учениця" }); const t2 = r.token;
  let html = await get("/teacher?key=test-key");
  assert.ok(html.includes("Тестовий Учень") && html.includes(`<b>11.</b>`), "учитель бачить поточний етап");
  assert.ok(html.includes("Друга Учениця") && html.includes("10 з 30") && html.includes("0 з 30"));

  // прогрес переживає перезапуск сервера (файл перечитується)
  await app.store.flush();
  if (!process.env.DATABASE_URL) {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
    assert.equal(Object.values(saved).find((a) => a.name === "Тестовий Учень").idx, 10, "прогрес записано у файл");
  }
  delete require.cache[require.resolve("./store")];
  const reloaded = require("./store")(); await reloaded.init();
  const back = (await reloaded.list()).filter((a) => [t, t2].map((x) => x.split(".")[0]).includes(a.id));
  assert.equal(back.length, 2, "після перезапуску спроби на місці");
  assert.equal(back.find((a) => a.name === "Тестовий Учень").idx, 10, "після перезапуску етап той самий");

  // дорозв'язуємо квест; регістр і пробіли не важливі
  for (let i = 10; i < QUESTIONS.length; i++) {
    const v = i % 2 ? QUESTIONS[i].answer.toLowerCase() : "  " + QUESTIONS[i].answer + " ";
    r = await post("/api/answer", { token: t, answer: v });
    assert.equal(r.correct, true, `запитання ${i + 1} (${QUESTIONS[i].title}) не прийняло «${QUESTIONS[i].answer}»`);
  }
  assert.equal(r.finished, true); assert.equal(r.errors, 4); assert.equal(r.hints, 1);
  r = await post("/api/answer", { token: t, answer: "x" }); assert.equal(r.status, 400, "після фінішу відповіді не приймаються");

  assert.equal((await fetch(base + "/teacher?key=wrong")).status, 403);
  assert.equal((await fetch(base + "/teacher")).status, 401);
  html = await get("/teacher?key=test-key&day=all"); assert.ok(html.includes("Завершив(ла)"));
  const csv = await get("/teacher.csv?key=test-key&day=all"); assert.ok(csv.includes("Тестовий Учень") && csv.includes("Помилки 30"));

  // видалення спроби
  const id2 = t2.split(".")[0];
  const del = await fetch(base + "/teacher/delete", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `key=test-key&id=${id2}&day=all` });
  assert.equal(del.status, 303); assert.ok(!(await get("/teacher?key=test-key&day=all")).includes("Друга Учениця"));

  const page = await get("/") + await get("/app.js");
  for (const q of QUESTIONS.filter((q) => q.kind === "text")) assert.ok(!page.includes(q.answer), "відповідь витекла на клієнт");

  console.log(`OK [${app.store.kind}]: ${QUESTIONS.length} відповідей приймаються; прогрес зберігається й переживає перезапуск; учитель бачить етап кожного учня.`);
  await app.store.remove(t.split(".")[0]);
  srv.close(); fs.rmSync(FILE, { force: true }); process.exit(0);
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
