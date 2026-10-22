// test.js — проходить увесь квест через API: хибні відповіді, підказка, підробка токена, усі 30 правильних, сторінка вчителя.
process.env.TEACHER_KEY = "test-key";
process.env.QUIZ_SECRET = "test-secret";
process.env.LIMIT_PER_ATTEMPT = "1000";
process.env.RESULTS_FILE = require("path").join(require("os").tmpdir(), `cq-test-${Date.now()}.json`);
const assert = require("assert");
const app = require("./server");
const { QUESTIONS } = require("./questions");

(async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, b) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

  let r = await post("/api/start", { name: "" }); assert.equal(r.status, 400);
  r = await post("/api/start", { name: "Тестовий Учень" }); let t = r.token;
  assert.equal(r.question.n, 1); assert.ok(!("answer" in r.question), "відповідь не має йти на клієнт");

  r = await post("/api/answer", { token: t, answer: "999" }); assert.equal(r.correct, false); t = r.token; assert.equal(r.errors, 1);
  r = await post("/api/hint", { token: t }); assert.ok(r.hint); t = r.token;
  r = await post("/api/hint", { token: t }); t = r.token; assert.equal(r.hints, 1, "повторна підказка не рахується двічі");
  const forged = t.split(".")[0] + ".AAAA"; r = await post("/api/answer", { token: forged, answer: "1" }); assert.equal(r.status, 400);

  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    const variant = i % 2 ? q.answer.toLowerCase() : "  " + q.answer + " "; // перевіряємо нечутливість до регістру й пробілів
    r = await post("/api/answer", { token: t, answer: variant }); t = r.token;
    assert.equal(r.correct, true, `запитання ${i + 1} (${q.title}) не прийняло «${q.answer}»`);
    if (i < QUESTIONS.length - 1) assert.equal(r.question.n, i + 2);
  }
  assert.equal(r.finished, true); assert.equal(r.errors, 1); assert.equal(r.hints, 1);
  r = await post("/api/resume", { token: t }); assert.equal(r.finished, true);
  r = await post("/api/answer", { token: t, answer: "x" }); assert.equal(r.status, 400, "після фінішу відповіді не приймаються");

  let html = await fetch(base + "/teacher?key=wrong").then((x) => x.status); assert.equal(html, 403);
  html = await fetch(base + "/teacher?key=test-key").then((x) => x.text()); assert.ok(html.includes("Тестовий Учень"));
  const csv = await fetch(base + "/teacher.csv?key=test-key").then((x) => x.text()); assert.ok(csv.includes("Тестовий Учень"));
  const page = await fetch(base + "/").then((x) => x.text()); assert.ok(page.includes("Шифрувальний"));
  const appjs = await fetch(base + "/app.js").then((x) => x.text());
  for (const q of QUESTIONS.filter((q) => q.kind === "text")) assert.ok(!appjs.includes(q.answer) && !page.includes(q.answer), "відповідь витекла на клієнт");

  console.log(`OK: усі ${QUESTIONS.length} відповідей приймаються; хибні, підробка токена, фініш і сторінка вчителя працюють.`);
  srv.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
