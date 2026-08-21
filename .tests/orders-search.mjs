/* Order search, the truncation notice, and the artwork-expiry warning.
   All three exist because of the same failure mode: the dashboard showing
   something that looks complete when it isn't. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

const day = 86400000, now = Date.now();
const order = (o) => ({
  key: "order:x:" + o.ref, ref: o.ref, when: new Date(now - (o.age || 1) * day).toISOString(),
  amount: o.amount || 7100, currency: "AUD", status: o.status || "paid", stage: o.stage || "new",
  product: "stickers", quantity: o.qty || 100, size: '3"', finish: o.finish || "Matte", shape: "Die-cut",
  turnaround: "Standard", name: o.name, email: o.email,
  artwork: o.art === false ? "" : "https://neotype.au/api/art/" + o.ref,
});
const ORDERS = [
  order({ ref: "NT-1001", name: "Kelly Nguyen", email: "kelly@brewco.com.au", finish: "Holographic", age: 2 }),
  order({ ref: "NT-1002", name: "Sam Porter", email: "sam@ridgeline.com.au", age: 5, stage: "proof" }),
  order({ ref: "NT-1003", name: "Kelly Watts", email: "kw@studio.example", age: 40, finish: "Gloss" }),
  order({ ref: "NT-1004", name: "Dev Rao", email: "dev@rao.example", age: 76 }),   // 14 days of file left
  order({ ref: "NT-1005", name: "Mia Cole", email: "mia@cole.example", age: 95 }), // already gone
  order({ ref: "NT-1006", name: "Ari Blake", email: "ari@blake.example", age: 1, status: "pending" }),
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
let artExpires = 90;
await p.route("**/api/**", r => {
  const u = r.request().url(), j = b => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (u.includes("/verify")) return j({ ok: true });
  if (u.includes("/orders")) return j({ orders: ORDERS, total: 640, capped: true, artExpires });
  if (u.includes("/enquiries")) return j({ enquiries: [] });
  if (u.includes("/pricing")) return j(CORE.DEFAULT_PRICING);
  return j({ ok: true });
});

const open = async () => {
  await p.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await p.fill("#admPass", "x"); await p.click("#admUnlock");
  await p.waitForSelector(".adm-rail");
  await p.click('[data-view="orders"]');
  await p.waitForTimeout(600);
};
await open();
const cards = p.locator(".adm-enq.adm-ord");

console.log("\n[ search ]");
check("all six orders render", await cards.count() === 6, String(await cards.count()));
check("the box is there", await p.locator("#admOrderQ").count() === 1);

await p.fill("#admOrderQ", "NT-1003");
await p.waitForTimeout(250);
check("a reference finds exactly one", await cards.count() === 1, String(await cards.count()));
check("and it's the right one", (await cards.first().innerText()).includes("NT-1003"));
check("the header says how many matched",
  /1 of 6 match/.test(await p.locator(".dash-card-h .adm-note").last().innerText()),
  await p.locator(".dash-card-h .adm-note").last().innerText());

await p.fill("#admOrderQ", "kelly");
await p.waitForTimeout(250);
check("a name finds both Kellys", await cards.count() === 2, String(await cards.count()));
await p.fill("#admOrderQ", "kelly holo");
await p.waitForTimeout(250);
check("two words narrow rather than widen", await cards.count() === 1, String(await cards.count()));
await p.fill("#admOrderQ", "KELLY");
await p.waitForTimeout(250);
check("case doesn't matter", await cards.count() === 2, String(await cards.count()));

await p.fill("#admOrderQ", "brewco");
await p.waitForTimeout(250);
check("an email domain works", await cards.count() === 1);
await p.fill("#admOrderQ", "awaiting");
await p.waitForTimeout(250);
check("so does a payment state", await cards.count() === 1, String(await cards.count()));

await p.fill("#admOrderQ", "zzzz");
await p.waitForTimeout(250);
check("no match says so instead of showing an empty list",
  /Nothing matches/.test(await p.locator(".dash-card").last().innerText()));

console.log("\n[ typing doesn't fight the re-render ]");
await p.fill("#admOrderQ", "");
await p.locator("#admOrderQ").focus();
await p.keyboard.type("kelly", { delay: 40 });
await p.waitForTimeout(250);
check("the whole word survives keystroke-by-keystroke", await p.locator("#admOrderQ").inputValue() === "kelly",
  await p.locator("#admOrderQ").inputValue());
check("focus stays in the box", await p.evaluate(() => document.activeElement && document.activeElement.id) === "admOrderQ");
await p.click("#admOrderQX");
await p.waitForTimeout(250);
check("Clear resets to all six", await cards.count() === 6 && await p.locator("#admOrderQ").inputValue() === "");

console.log("\n[ the list says when it isn't the whole list ]");
const cap = await p.locator(".adm-cap").innerText();
check("truncation is stated, not silent", /640/.test(cap) && /most recent 6/.test(cap), cap.slice(0, 80));

console.log("\n[ artwork expiry ]");
const soon = await p.locator(".adm-art-soon").allInnerTexts();
const gone = await p.locator(".adm-art-gone").allInnerTexts();
check("a 76-day-old file warns with days left", soon.length === 1 && /14 days/.test(soon[0]), JSON.stringify(soon));
check("a 95-day-old file is reported as gone", gone.length === 1, JSON.stringify(gone));
check("recent orders get no warning", soon.length + gone.length === 2);
if (OUT) await p.locator(".dash-card").last().screenshot({ path: OUT + "/orders-search.png" }).catch(() => {});

console.log("\n[ with R2 bound there is nothing to warn about ]");
artExpires = 0;
await open();
check("no expiry warnings when files don't expire",
  await p.locator(".adm-art-soon, .adm-art-gone").count() === 0);

check("no JS errors", errs.length === 0, errs.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
