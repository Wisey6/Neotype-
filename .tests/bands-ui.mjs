import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
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
await p.waitForSelector(".adm-rail"); await p.click('[data-view="pricing"]'); await p.waitForTimeout(700);

console.log("\n[ band editor ]");
check("seven band rows render", await p.locator("[data-band$='.from']").count() === 7);
check("starts OFF (curve still pricing)", !(await p.locator("#admBandsOn").isChecked()));
check("table is dimmed while off", await p.locator(".adm-bandtable[data-dim]").count() === 1);

const toggle = p.locator("label.adm-bandon");
await toggle.scrollIntoViewIfNeeded();
await toggle.click();
await p.waitForTimeout(400);
check("toggling on undims the table", await p.locator(".adm-bandtable[data-dim]").count() === 0);
check("label changes", (await toggle.locator(".adm-stock-txt").innerText()).includes("pricing the shop"));

const unit0 = await p.locator("[data-bandunit='0']").innerText();
check("live per-sticker figure shown", /c each$/.test(unit0), unit0);
const tot3 = await p.locator("[data-bandtotal='3']").innerText();
check("live order total shown", /^\$[\d.]+ for \d+$/.test(tot3), tot3);

// edit a rate and watch the figure move
const before = await p.locator("[data-bandunit='3']").innerText();
await p.fill("[data-band='3.rate']", "0.500");
await p.waitForTimeout(400);
const after = await p.locator("[data-bandunit='3']").innerText();
check("editing a rate updates the example", before !== after, `${before} → ${after}`);
check("clamp warning appears for a steep step", !(await p.locator("#admBandWarn").isHidden()));

await p.screenshot({ path: `${OUT}/10-admin-bands.png` });
await p.click("#admSave"); await p.waitForTimeout(500);
check("bands reach the save payload", !!(saved && saved.stickers && saved.stickers.qtyBands && saved.stickers.qtyBands.length === 7));
check("rate stored in dollars, not cents", saved && saved.stickers.qtyBands[3].rate === 0.005,
      saved ? String(saved.stickers.qtyBands[3].rate) : "-");
check("no JS errors", errs.length === 0, errs.join("; "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
