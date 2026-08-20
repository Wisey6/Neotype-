import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
/* playwright-core is deliberately NOT in package.json. Cloudflare runs npm install
   whenever this repo declares a dependency, and that install step is what stalled
   production deploys for a day. Keep the repo dependency-free and point NODE_PATH
   at wherever playwright-core lives:

     mkdir -p /tmp/pw && cd /tmp/pw && npm i playwright-core
     NODE_PATH=/tmp/pw/node_modules node .tests/visual-verify.mjs ./shots

   Skipping beats crashing: ERR_MODULE_NOT_FOUND reads as a broken test, and a
   broken test gets deleted. */
let chromium;
try { ({ chromium } = _req("playwright-core")); }
catch {
  console.log("SKIP — playwright-core not resolvable. See the note at the top of this file.");
  process.exit(0);
}
const CORE = _req("../assets/js/pricing-core.js");
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

// ---- server-side refusal (the part that actually protects anything) ----
console.log("\n[ pricing-core refuses hidden options ]");
const table = JSON.parse(JSON.stringify(CORE.DEFAULT_PRICING));
table.off = { "stickers.finish.holographic": true, "banner.material.mesh": true };
const opt = f => ({ finish: f, shape: "die", size: 3, qty: 100, turnaround: "standard" });
check("holographic prices normally when in stock", !!CORE.priceStickers(opt("holographic"), CORE.DEFAULT_PRICING));
check("holographic refuses to price when off", CORE.priceStickers(opt("holographic"), table) === null);
check("other finishes unaffected", !!CORE.priceStickers(opt("vinyl-gloss"), table));
const lf = m => CORE.priceLargeFormat("banner", { w: 2, h: 0.85, qty: 1, material: m }, table);
check("banner mesh refuses when off", lf("mesh") === null);
check("banner vinyl still prices", !!lf("vinyl-440"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

// ---- admin: the toggle exists, flips, and lands in the saved payload ----
console.log("\n[ /admin stock switch ]");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  let saved = null;
  await p.route("**/api/**", r => {
    const u = r.request().url(), j = b => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (u.includes("/verify")) return j({ ok: true });
    if (u.includes("/orders")) return j({ orders: [] });
    if (u.includes("/enquiries")) return j({ enquiries: [] });
    if (u.includes("/pricing")) {
      if (r.request().method() === "POST") { saved = JSON.parse(r.request().postData()); return j({ ok: true }); }
      return j(CORE.DEFAULT_PRICING);
    }
    return j({ ok: true });
  });
  await p.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await p.fill("#admPass", "x"); await p.click("#admUnlock");
  await p.waitForSelector(".adm-rail"); await p.waitForTimeout(600);
  await p.click('[data-view="pricing"]'); await p.waitForTimeout(600);

  const sel = '[data-off="stickers.finish.holographic"]';
  check("a switch exists for every option", await p.locator(".adm-stock").count() > 20,
        (await p.locator(".adm-stock").count()) + " switches");
  check("holographic switch starts In stock", await p.locator(sel).isChecked());
  const label = p.locator('label.adm-stock:has([data-off="stickers.finish.holographic"])');
  await label.scrollIntoViewIfNeeded();
  await label.click();                       // a person clicks the switch, not the hidden input
  await p.waitForTimeout(250);
  check("switch is now unchecked", !(await p.locator(sel).isChecked()));
  check("label reads Hidden", (await label.locator(".adm-stock-txt").innerText()) === "Hidden");
  check("row dims to show it is off", await p.locator('.adm-tr-off:has([data-off="stickers.finish.holographic"])').count() === 1);
  if (OUT) await p.screenshot({ path: `${OUT}/07-admin-stock.png` });
  await p.click("#admSave"); await p.waitForTimeout(500);
  check("save payload carries the off flag", !!(saved && saved.off && saved.off["stickers.finish.holographic"] === true),
        saved ? JSON.stringify(saved.off) : "no POST seen");
  await ctx.close();
}

// ---- customizer: the button disappears for customers ----
console.log("\n[ customizer hides it ]");
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.route("**/api/pricing", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(table) }));
  await p.goto(B + "/customizer.html", { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  const m = await p.evaluate(() => {
    const btn = document.querySelector('[data-finish="holographic"]');
    const gloss = document.querySelector('[data-finish="vinyl-gloss"]');
    return { holoHidden: btn.hidden, glossVisible: !gloss.hidden,
             visibleCount: [...document.querySelectorAll("[data-finish]")].filter(b => !b.hidden).length };
  });
  check("holographic button hidden", m.holoHidden);
  check("the other six remain", m.glossVisible && m.visibleCount === 6, m.visibleCount + " visible");
  if (OUT) await p.screenshot({ path: `${OUT}/08-customizer-stock.png` });
  await ctx.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
