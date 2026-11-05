// app.js — клієнт квесту. Відповідей тут немає: перевіряє сервер.
const $ = (id) => document.getElementById(id);
const KEY = "cipher-quest-token";
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} } };
let token = null, current = null, pending = null, total = 21, solvedCount = 0;

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Сервер недоступний. Спробуйте ще раз.");
  return data;
}
function progress(doneCount, cur) {
  $("progress").innerHTML = Array.from({ length: total }, (_, k) =>
    `<i class="${k < doneCount ? "done" : k === cur ? "cur" : ""}" title="${k + 1}"></i>`).join("");
}
const tile = (t, cls = "") => `<span class="tile ${cls}">${t}</span>`;
function renderDisplay(q) {
  const d = $("display"); const s = q.show;
  if (q.showKind === "letters" || q.showKind === "plainLetters") {
    const open = q.showKind === "plainLetters";
    d.innerHTML = `<span class="label">${open ? "Відкритий текст" : "Шифротекст"}</span>` +
      s.split(" ").map((w) => `<span class="word">${[...w].map((c) => tile(c, open ? "open" : "")).join("")}</span>`).join("");
  } else if (q.showKind === "pairs") {
    d.innerHTML = `<span class="label">Шифротекст</span>` +
      s.split(" / ").map((w, i) => (i ? '<span class="sep">/</span>' : "") + `<span class="word">${w.split(" ").map((p) => tile(p)).join("")}</span>`).join("");
  } else if (q.showKind === "number") {
    d.innerHTML = `<span class="word">${[...s].map((c) => tile(c, "open")).join("")}</span>` + (q.showSuffix ? `<span class="suffix">${q.showSuffix}</span>` : "");
  } else {
    d.innerHTML = `<span class="plain">${s}</span>`;
  }
}
function view(name) { for (const id of ["start", "task", "finish"]) $(id).hidden = id !== name; }
function showQuestion(q, hint) {
  current = q; total = q.total; solvedCount = q.n - 1; progress(solvedCount, q.n - 1); view("task");
  $("section").textContent = q.section; $("cipherName").hidden = !q.cipher; $("cipherName").textContent = q.cipher || "";
  $("step").textContent = `Завдання ${q.n} з ${q.total}`; $("title").textContent = q.title; $("ask").textContent = q.ask;
  renderDisplay(q); $("unit").textContent = q.unit || "";
  $("answer").value = ""; $("answer").disabled = false; $("checkBtn").disabled = false;
  $("answer").setAttribute("inputmode", q.inputMode); $("msg").className = ""; $("msg").textContent = "";
  $("nextBtn").hidden = true; $("hintBtn").hidden = !!hint; $("hint").hidden = !hint; $("hint").textContent = hint || "";
  $("answer").focus();
}
function showFinish(r) {
  progress(r.total, -1); view("finish");
  const s = Math.round(r.timeMs / 1000);
  $("finName").textContent = `${r.name} — усі ${r.total} завдань виконано.`;
  $("sTime").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  $("sErr").textContent = r.errors; $("sHint").textContent = r.hints;
}
const setToken = (t) => { token = t; store.set(t); };

$("startForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { const r = await api("/api/start", { name: $("name").value }); setToken(r.token); showQuestion(r.question); }
  catch (err) { $("startMsg").className = "msg bad"; $("startMsg").textContent = err.message; }
});
$("answerForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (pending) return next();
  const m = $("msg"); const a = $("answer").value.trim();
  if (!a) { m.className = "msg bad"; m.textContent = "Введіть відповідь."; return; }
  $("checkBtn").disabled = true;
  try {
    const r = await api("/api/answer", { token, answer: a }); setToken(r.token);
    if (r.correct) {
      pending = r; progress(solvedCount + 1, -1);
      m.className = "msg ok"; m.textContent = "Правильно!";
      $("answer").disabled = true; $("hintBtn").hidden = true; $("nextBtn").hidden = false;
      $("nextBtn").textContent = r.finished ? "Завершити →" : "Наступне завдання →"; $("nextBtn").focus();
    } else {
      m.className = "msg bad"; m.textContent = "Результат некоректний. Перевірте обчислення й спробуйте ще раз.";
      const c = $("task"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake");
      $("checkBtn").disabled = false; $("answer").focus(); $("answer").select();
    }
  } catch (err) { m.className = "msg bad"; m.textContent = err.message; $("checkBtn").disabled = false; }
});
function next() { const r = pending; pending = null; if (!r) return; r.finished ? showFinish(r) : showQuestion(r.question); }
$("nextBtn").addEventListener("click", next);
$("hintBtn").addEventListener("click", async () => {
  try { const r = await api("/api/hint", { token }); setToken(r.token); $("hint").textContent = r.hint; $("hint").hidden = false; $("hintBtn").hidden = true; }
  catch (err) { $("msg").className = "msg bad"; $("msg").textContent = err.message; }
});
$("restart").addEventListener("click", () => { setToken(null); $("name").value = ""; progress(0, -1); view("start"); });

async function boot() {
  try {
    const ref = await fetch("/api/reference").then((r) => r.json());
    if (ref.total) { total = ref.total; $("totalCount").textContent = ref.total; }
    let rows = "";
    for (let r = 0; r < 3; r++) {
      const seg = [...ref.abc].slice(r * 11, r * 11 + 11);
      rows += `<tr>${seg.map((c) => `<td class="l">${c}</td>`).join("")}</tr><tr>${seg.map((_, k) => `<td class="n">${r * 11 + k}</td>`).join("")}</tr>`;
    }
    $("abc").innerHTML = rows;
    let p = "<tr><th></th>" + [1, 2, 3, 4, 5, 6].map((x) => `<th>${x}</th>`).join("") + "</tr>";
    for (let r = 0; r < 6; r++) p += `<tr><th>${r + 1}</th>` + ref.poly.slice(r * 6, r * 6 + 6).map((x) => `<td>${x}</td>`).join("") + "</tr>";
    $("poly").innerHTML = p;
  } catch {}
  progress(0, -1);
  const saved = store.get();
  if (saved) {
    try { const r = await api("/api/resume", { token: saved }); setToken(r.token); return r.finished ? showFinish(r) : showQuestion(r.question, r.hint); }
    catch { setToken(null); }
  }
  view("start");
}
boot();
