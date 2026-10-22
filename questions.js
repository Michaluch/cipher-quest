// questions.js — банк запитань квесту.
// Шифротексти, двійкові записи й об'єми НЕ вписані вручну: вони обчислюються тут під час запуску
// з відкритих даних, тож помилитися в ключі неможливо. Відповіді живуть лише на сервері.

const ABC = "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ"; // 33 літери, А = 0 … Я = 32
const N = ABC.length;
const idx = (c) => ABC.indexOf(c);
const mod = (a) => ((a % N) + N) % N;

const caesar = (t, k) => [...t].map((c) => (idx(c) < 0 ? c : ABC[mod(idx(c) + k)])).join("");
const atbash = (t) => [...t].map((c) => (idx(c) < 0 ? c : ABC[N - 1 - idx(c)])).join("");
function vigenere(t, key, sign = 1) {
  let j = 0;
  return [...t].map((c) => {
    if (idx(c) < 0) return c;
    const r = ABC[mod(idx(c) + sign * idx(key[j % key.length]))];
    j++;
    return r;
  }).join("");
}
const POLY = [...ABC, "’", ",", "."]; // квадрат 6×6
const polybius = (t) =>
  t.split(" ").map((w) => [...w].map((c) => {
    const i = POLY.indexOf(c);
    return `${Math.floor(i / 6) + 1}${(i % 6) + 1}`;
  }).join(" ")).join(" / ");

// Об'єм зображення в Кбайт; кидає помилку, якщо результат не цілий
function imageKB(w, h, bits) {
  const kb = (w * h * bits) / 8 / 1024;
  if (!Number.isInteger(kb)) throw new Error(`Об'єм ${w}×${h}×${bits} не цілий: ${kb}`);
  return kb;
}
const bitsFor = (colors) => Math.ceil(Math.log2(colors));
const colorsWord = (n) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "кольори" : n % 10 === 1 && n % 100 !== 11 ? "колір" : "кольорів");

const Q = [];
const add = (q) => Q.push(q);

/* ---------- 1. Двійкова система (8) ---------- */
const toBin = [13, 25, 45, 100];
const toDec = ["1011", "11001", "101101", "10000000"];
toBin.forEach((d, i) => add({
  section: "Двійкова система", title: `Десяткове → двійкове · ${i + 1}`,
  ask: "Запишіть число у двійковій системі числення.", show: String(d), showKind: "number",
  answer: d.toString(2), kind: "binary",
  hint: "Діліть число на 2 й записуйте остачі. Двійковий запис — це остачі, прочитані знизу вгору.",
}));
toDec.forEach((b, i) => add({
  section: "Двійкова система", title: `Двійкове → десяткове · ${i + 1}`,
  ask: "Переведіть двійкове число в десяткову систему числення.", show: b, showKind: "number", showSuffix: "₂",
  answer: String(parseInt(b, 2)), kind: "number",
  hint: "Розряди справа наліво мають вагу 1, 2, 4, 8, 16, 32, 64, 128… Додайте ваги тих розрядів, де стоїть 1.",
}));

/* ---------- 2. Об'єм зображення, Кбайт (8) ---------- */
const imgs = [
  { w: 128, h: 128, bits: 24, t: "Іконка застосунку" },
  { w: 256, h: 256, bits: 8, t: "Чорно-сіра фотографія" },
  { w: 512, h: 256, bits: 16, t: "Банер для сайту" },
  { w: 1024, h: 768, bits: 24, t: "Фото для презентації" },
];
imgs.forEach((m) => add({
  section: "Об'єм зображення", title: m.t,
  ask: `Зображення має роздільність ${m.w} × ${m.h} пікселів і глибину кольору ${m.bits} біт. Обчисліть його об'єм у кілобайтах.`,
  show: `${m.w} × ${m.h} · ${m.bits} біт`, showKind: "plain",
  answer: String(imageKB(m.w, m.h, m.bits)), kind: "number", unit: "Кбайт",
  hint: "V = ширина × висота × глибина кольору. Результат у бітах: ÷ 8 → байти, ÷ 1024 → Кбайт.",
}));
const pal = [
  { w: 640, h: 480, colors: 16, t: "Схема метро" },
  { w: 320, h: 256, colors: 2, t: "Чорно-білий малюнок" },
  { w: 1024, h: 1024, colors: 65536, t: "Текстура для гри" },
];
pal.forEach((m) => add({
  section: "Об'єм зображення", title: m.t,
  ask: `Зображення ${m.w} × ${m.h} пікселів використовує палітру з ${m.colors} кольорів. Обчисліть його об'єм у кілобайтах.`,
  show: `${m.w} × ${m.h} · ${m.colors} ${colorsWord(m.colors)}`, showKind: "plain",
  answer: String(imageKB(m.w, m.h, bitsFor(m.colors))), kind: "number", unit: "Кбайт",
  hint: "Спершу знайдіть глибину кольору i: 2ⁱ = кількість кольорів. Далі V = ширина × висота × i ÷ 8 ÷ 1024.",
}));
{ // обернена задача: скільки кольорів
  const w = 256, h = 128, kb = 32;
  const bits = (kb * 1024 * 8) / (w * h);
  if (!Number.isInteger(bits)) throw new Error("bits");
  add({
    section: "Об'єм зображення", title: "Скільки кольорів у палітрі",
    ask: `Нестиснене зображення ${w} × ${h} пікселів займає ${kb} Кбайт. Скільки кольорів може бути в його палітрі?`,
    show: `${w} × ${h} · ${kb} Кбайт`, showKind: "plain",
    answer: String(2 ** bits), kind: "number", unit: "кольорів",
    hint: "Переведіть Кбайт у біти (× 1024 × 8) і поділіть на кількість пікселів — отримаєте i. Кольорів N = 2ⁱ.",
  });
}

/* ---------- 3. Шифри (14) ---------- */
const C = (o) => add({ section: "Шифри", showKind: o.showKind || "letters", kind: o.kind || "text", ...o });
C({ title: "Перше повідомлення", cipher: "Цезар", ask: "Дешифруйте слово. Шифр Цезаря, ключ k = 3.", show: caesar("ШИФР", 3), answer: "ШИФР",
    hint: "Від номера кожної літери відніміть 3. Якщо вийшло менше за 0 — додайте 33." });
C({ title: "Наказ легіону", cipher: "Цезар", ask: "Дешифруйте фразу. Шифр Цезаря, ключ k = 3.", show: caesar("ЖЕРЕБ КИНУТО", 3), answer: "ЖЕРЕБ КИНУТО",
    hint: "Пробіли не шифрувалися. Ґ(4) − 3 = 1 → Б." });
C({ title: "Зашифруйте самі", cipher: "Цезар", ask: "Зашифруйте слово шифром Цезаря з ключем k = 5 і введіть шифротекст.", show: "ДАНІ", showKind: "plainLetters", answer: caesar("ДАНІ", 5),
    hint: "До номера кожної літери додайте 5. Д = 5, А = 0, Н = 17, І = 11." });
C({ title: "Дзеркальна абетка", cipher: "Атбаш", ask: "Дешифруйте слово, зашифроване атбашем.", show: atbash("ЛІТОПИС"), answer: "ЛІТОПИС",
    hint: "Номер літери → 32 − номер. А ↔ Я, Б ↔ Ю, В ↔ Ь…" });
C({ title: "Лист із минулого", cipher: "Атбаш", ask: "Дешифруйте фразу, зашифровану атбашем.", show: atbash("СТАРИЙ АРХІВ"), answer: "СТАРИЙ АРХІВ",
    hint: "Атбаш симетричний: дешифрування — та сама дія, що й шифрування." });
C({ title: "Сигнальні вогні", cipher: "Полібій", ask: "Дешифруйте слово за квадратом Полібія (перша цифра — рядок, друга — стовпець).", show: polybius("ГЕТЬМАН"), showKind: "pairs", answer: "ГЕТЬМАН",
    hint: "14 — рядок 1, стовпець 4." });
C({ title: "Січове зібрання", cipher: "Полібій", ask: "Дешифруйте назву за квадратом Полібія. Знак / розділяє слова.", show: polybius("КОЗАЦЬКА РАДА"), showKind: "pairs", answer: "КОЗАЦЬКА РАДА",
    hint: "61 — рядок 6, стовпець 1: це Ь." });
C({ title: "Шифр у числах", cipher: "Полібій", ask: "Зашифруйте слово за квадратом Полібія. Пари чисел розділяйте пробілом.", show: "КОД", showKind: "plainLetters", answer: polybius("КОД"), kind: "digits",
    hint: "Для кожної літери запишіть номер рядка, потім номер стовпця. К — рядок 3, стовпець 3." });
C({ title: "Ключове слово", cipher: "Віженер", ask: "Дешифруйте слово шифром Віженера. Ключ — МОВА.", show: vigenere("ПІСНЯ", "МОВА"), answer: "ПІСНЯ",
    hint: "Від номера літери шифру відніміть номер літери ключа: М = 16, О = 18, В = 2, А = 0. Ключ повторюється по колу." });
C({ title: "Вислів мудреця", cipher: "Віженер", ask: "Дешифруйте фразу шифром Віженера. Ключ — ЛІРА (ключ іде лише по літерах, пробіли пропускаємо).", show: vigenere("СЛОВО МАЄ СИЛУ", "ЛІРА"), answer: "СЛОВО МАЄ СИЛУ",
    hint: "Л = 15, І = 11, Р = 20, А = 0." });
C({ title: "Перехоплене донесення", cipher: "Цезар", ask: "Шифр Цезаря з невідомим ключем. Відомо, що донесення починається з літери П. Дешифруйте його.", show: caesar("ПРИЙШОВ ПОБАЧИВ ПЕРЕМІГ", 7), answer: "ПРИЙШОВ ПОБАЧИВ ПЕРЕМІГ",
    hint: "Порівняйте першу літеру шифру з П — різниця номерів і є ключем." });
C({ title: "Знайдіть ключ", cipher: "Цезар", ask: "Слово ЛІЦЕЙ зашифрували шифром Цезаря й отримали слово нижче. Яким був ключ k? Введіть число.", show: caesar("ЛІЦЕЙ", 11), answer: "11", kind: "number",
    hint: "Л = 15. Знайдіть номер першої літери шифру й відніміть 15 (якщо менше 0 — додайте 33)." });
{
  const m1 = "ЗБІР БІЛЯ ШКОЛИ";
  C({ title: "Злам за відомим текстом", cipher: "Віженер", ask: `Відомо, що шифр нижче — це фраза «${m1}», зашифрована Віженером. Знайдіть ключове слово.`, show: vigenere(m1, "КЛЕН"), answer: "КЛЕН",
      hint: "Для кожної пари: номер літери шифру − номер літери тексту. Отримані літери повторюються — це ключ." });
}
{
  const fin = "ЗАХИСТ ДАНИХ ВАЖЛИВИЙ";
  C({ title: "Подвійний замок", cipher: "Атбаш + Цезар", ask: "Повідомлення зашифрували двічі: спочатку атбашем, потім шифром Цезаря з ключем k = 2. Дешифруйте.", show: caesar(atbash(fin), 2), answer: fin,
      hint: "Знімайте замки у зворотному порядку: спершу Цезар назад на 2, потім атбаш." });
}

/* ---------- перевірки цілісності ---------- */
if (Q.length !== 30) throw new Error(`Очікувалось 30 запитань, є ${Q.length}`);
for (const q of Q) {
  if (q.cipher === "Цезар" && q.title === "Перше повідомлення" && caesar(q.show, -3) !== q.answer) throw new Error(q.title);
}
if (atbash(atbash("ЛІТОПИС")) !== "ЛІТОПИС" || vigenere(vigenere("ПІСНЯ", "МОВА"), "МОВА", -1) !== "ПІСНЯ") throw new Error("ciphers");

// Нормалізація відповіді: регістр, пробіли, розділові знаки й провідні нулі не важливі
function normalize(s, kind) {
  let v = String(s || "").toUpperCase().replace(/Ё/g, "Е");
  if (kind === "text") return v.replace(/[^А-ЯҐЄІЇ]/g, "");
  v = v.replace(/[^0-9]/g, "");
  if (kind === "number" || kind === "binary") v = v.replace(/^0+(?=\d)/, "");
  return v;
}
const isCorrect = (q, input) => normalize(input, q.kind) !== "" && normalize(input, q.kind) === normalize(q.answer, q.kind);

// Що бачить учень (без відповіді)
const publicView = (q, i) => ({
  n: i + 1, total: Q.length, section: q.section, cipher: q.cipher || null, title: q.title, ask: q.ask,
  show: q.show, showKind: q.showKind, showSuffix: q.showSuffix || "", unit: q.unit || "",
  inputMode: q.kind === "text" ? "text" : "numeric",
});

module.exports = { QUESTIONS: Q, isCorrect, publicView, ABC, POLY };
