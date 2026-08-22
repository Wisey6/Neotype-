/* Banner and corflute quantity: the preset row was also the whitelist, so 7
   banners was unbuyable. This checks the pricing core accepts every integer in
   range and still refuses what's outside it, then drives both builders in a
   real browser to confirm the box, the presets and the price stay in step. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
const CORE = _req("../assets/js/pricing-core.js");
const T = CORE.DEFAULT_PRICING;
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

const BASE = {
  banner:   { w: 2, h: 1,     material: "vinyl-440", finishing: "hem-eyelets", eyelets: "standard", rope: "none", turnaround: "standard" },
  corflute: { w: 0.6, h: 0.9, thickness: "5mm", sides: "single", eyelets: "none", turnaround: "standard" }
};
const q = (prod, n) => CORE.priceLargeFormat(prod, { ...BASE[prod], qty: n }, T);

console.log("\n[ the whitelist is gone ]");
for (const prod of ["banner", "corflute"]) {
  const M = CORE.LF_META[prod], hi = M.qtyMax;
  check(`${prod} declares a ceiling above its last preset`, hi > M.qtys[M.qtys.length - 1], `qtyMax ${hi}`);

  // every integer from 1 to the ceiling prices — no gaps, no throw
  let gaps = [];
  for (let n = 1; n <= hi; n++) if (!q(prod, n)) gaps.push(n);
  check(`${prod}: every quantity 1–${hi} prices`, gaps.length === 0, gaps.slice(0, 6).join(","));

  check(`${prod}: an off-preset quantity was previously unbuyable and now works`,
    M.qtys.indexOf(7) === -1 && Boolean(q(prod, 7)));

  console.log(`\n[ ${prod}: the ceiling still holds ]`);
  for (const bad of [hi + 1, hi * 10, 0, -1, NaN, Infinity, "many", null, undefined])
    check(`refuses ${String(bad)}`, q(prod, bad) === null);
}

console.log("\n[ the discount is continuous and monotone ]");
for (const prod of ["banner", "corflute"]) {
  const hi = CORE.LF_META[prod].qtyMax;
  let unitRises = [], totalDrops = [];
  let prev = q(prod, 1);
  for (let n = 2; n <= hi; n++) {
    const r = q(prod, n);
    // whole-dollar rounding lets unit price jitter by up to $1/qty; anything
    // beyond that would mean a customer pays more per unit for ordering more
    if (r.total / n > prev.total / (n - 1) + 1 / (n - 1)) unitRises.push(n);
    if (r.total < prev.total) totalDrops.push(n);
    prev = r;
  }
  check(`${prod}: buying more never costs more per unit`, unitRises.length === 0, unitRises.slice(0, 5).join(","));
  check(`${prod}: the total never goes down as quantity goes up`, totalDrops.length === 0, totalDrops.slice(0, 5).join(","));
}

console.log("\n[ the presets are still exactly what they price ]");
for (const prod of ["banner", "corflute"])
  for (const n of CORE.LF_META[prod].qtys) {
    const r = q(prod, n);
    check(`${prod} ×${n} = $${r.total}`, r.total > 0 && r.unit > 0 && Math.abs(r.unit * n - r.total) < 1);
  }

/* ---- the browser ------------------------------------------------------ */
let chromium; try { ({ chromium } = _req("playwright-core")); } catch {
  console.log(`\n(browser half skipped — no playwright-core)\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
const B = "http://127.0.0.1:8901";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errs = [];

for (const [prod, page] of [["banner", "banners.html"], ["corflute", "corflute.html"]]) {
  const hi = CORE.LF_META[prod].qtyMax;
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  p.on("pageerror", e => errs.push(prod + ": " + e.message));
  await p.route("**/api/**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(T) }));
  await p.goto(B + "/" + page, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);

  const total = async () => { await p.waitForTimeout(300); return Number((await p.locator("#lfTotal").innerText()).replace(/[^0-9]/g, "")); };
  /* Price the page's *own* configuration, not a fixture: the two builders open
     on different default sizes and materials, and a hard-coded expectation
     would be testing the fixture rather than the page. */
  const priced = async (n) => {
    const o = await p.evaluate((groups) => {
      const out = { w: Number(document.getElementById("lfW").value), h: Number(document.getElementById("lfH").value) };
      groups.forEach(g => {
        const b = document.querySelector(`[data-lfc-${g}][aria-pressed="true"]`);
        if (b) out[g] = b.getAttribute("data-lfc-" + g);
      });
      return out;
    }, Object.keys(CORE.LF_META[prod].groups));
    return CORE.priceLargeFormat(prod, { ...o, qty: n }, T).total;
  };

  console.log(`\n[ ${page}: the control exists ]`);
  check("a free-entry quantity box is on the page", await p.locator("#lfQtyAny").count() === 1);
  check("the preset buttons are still there", await p.locator("[data-lfqty]").count() === CORE.LF_META[prod].qtys.length);
  check("the box carries the real ceiling",
    await p.locator("#lfQtyAny").getAttribute("max") === String(hi) &&
    await p.locator("#lfQtyAny").getAttribute("min") === "1");
  check("the help text names the range", new RegExp("1 to " + hi.toLocaleString()).test(await p.locator("#lfQtyHelp").innerText()),
    await p.locator("#lfQtyHelp").innerText());

  console.log(`\n[ ${page}: typing a quantity the presets never offered ]`);
  await p.fill("#lfQtyAny", "7"); await p.locator("#lfQtyAny").blur();
  check("7 prices as the core prices it", await total() === await priced(7), String(await priced(7)));
  check("the label follows", /7 units/i.test(await p.locator("#lfQtyVal").innerText()), await p.locator("#lfQtyVal").innerText());
  check("no preset button is left highlighted", await p.locator('[data-lfqty][aria-pressed="true"]').count() === 0);

  console.log(`\n[ ${page}: the box and the buttons stay in step ]`);
  const preset = String(CORE.LF_META[prod].qtys[2]);
  await p.click(`[data-lfqty="${preset}"]`);
  await p.waitForTimeout(200);
  check(`clicking ${preset} fills the box`, await p.locator("#lfQtyAny").inputValue() === preset);
  check("and prices it", await total() === await priced(Number(preset)), String(await priced(Number(preset))));
  check("and highlights that button", await p.locator(`[data-lfqty="${preset}"]`).getAttribute("aria-pressed") === "true");

  console.log(`\n[ ${page}: clamping waits for blur ]`);
  await p.fill("#lfQtyAny", "1");
  check("a keystroke on the way to a bigger number isn't eaten", await p.locator("#lfQtyAny").inputValue() === "1");
  await p.fill("#lfQtyAny", String(hi + 5));
  check("over the ceiling explains rather than snapping",
    /trade run/i.test(await p.locator("#lfQtyHelp").innerText()), await p.locator("#lfQtyHelp").innerText());
  await p.locator("#lfQtyAny").blur();
  await p.waitForTimeout(200);
  check("blur clamps to the ceiling", await p.locator("#lfQtyAny").inputValue() === String(hi));
  check("and prices the ceiling", await total() === await priced(hi), String(await priced(hi)));

  await p.fill("#lfQtyAny", "0"); await p.locator("#lfQtyAny").blur();
  await p.waitForTimeout(200);
  check("zero clamps up to one", await p.locator("#lfQtyAny").inputValue() === "1");
  await p.fill("#lfQtyAny", "9"); await p.locator("#lfQtyAny").blur();
  await p.fill("#lfQtyAny", ""); await p.locator("#lfQtyAny").blur();
  await p.waitForTimeout(200);
  check("an emptied box falls back to the last good quantity", await p.locator("#lfQtyAny").inputValue() === "9",
    await p.locator("#lfQtyAny").inputValue());

  /* The live price list arrives after first paint and rebuilds the panel from
     scratch. Everything below this line is running against those replaced
     elements — which is exactly how the panel used to go dead. */
  console.log(`\n[ ${page}: it reaches checkout, on the rebuilt panel ]`);
  await p.fill("#lfQtyAny", "13"); await p.locator("#lfQtyAny").blur();
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.__n = 0; window.NeotypeCheckout = { enabled: true, checkout: (o) => { window.__o = o; window.__n++; } }; });
  await p.click("#lfCheckout");
  await p.waitForTimeout(300);
  const o = await p.evaluate(() => window.__o);
  const pay = o && (o.payload || o);
  check("the order carries the typed quantity", pay && pay.qty === 13, JSON.stringify(pay && { qty: pay.qty }));
  check("checkout fired exactly once, not twice", await p.evaluate(() => window.__n) === 1, String(await p.evaluate(() => window.__n)));

  console.log(`\n[ ${page}: the rest of the panel survived the rebuild ]`);
  const wTest = (CORE.LF_META[prod].wRange[1] - 0.15).toFixed(2);
  await p.fill("#lfW", wTest);
  await p.waitForTimeout(250);
  check("typing a custom width still moves the preview", (await p.locator("#lfSizeCap").innerText()).indexOf(wTest) === 0,
    await p.locator("#lfSizeCap").innerText() + " (typed " + wTest + ")");
  check("the artwork dropzone still opens the file picker",
    await p.evaluate(() => { let hit = false; const i = document.getElementById("lfInput");
      i.addEventListener("click", () => { hit = true; }); document.getElementById("lfDrop").click(); return hit; }));
  const CFG_PRESET0 = () => ({ w: pagePreset0 });
  const pagePreset0 = await p.evaluate(() => window.LF_PRODUCT.presets[0].w);
  const preset0 = await p.locator("[data-lfpreset]").first();
  await preset0.click(); await p.waitForTimeout(250);
  check("a size preset still fills the width box it no longer holds a reference to",
    Number(await p.locator("#lfW").inputValue()) === CFG_PRESET0(prod).w,
    await p.locator("#lfW").inputValue());
  await p.close();
}
check("no JS errors on either page", errs.length === 0, errs.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
