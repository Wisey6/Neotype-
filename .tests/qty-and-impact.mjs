/* Two things added on 20 Aug 2026:
     • a free quantity box in the customizer, because the seven preset buttons
       were the only way to choose and 750 was not one of them
     • a before/after table in the band editor, because turning bands on moves
       some prices up and Ian needs to see which ones first */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
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

// ---------------------------------------------------------------- customizer
console.log("\n[ free quantity entry ]");
await p.goto(B + "/customizer.html", { waitUntil: "networkidle" });
const box = p.locator("#czQtyAny");
check("the box exists", await box.count() === 1);
check("it advertises the real range",
  await box.getAttribute("min") === String(CORE.QTY_MIN) && await box.getAttribute("max") === String(CORE.QTY_MAX),
  (await box.getAttribute("min")) + "–" + (await box.getAttribute("max")));

const total = () => p.locator("#priceTotal").innerText();
const settle = async () => { await p.waitForTimeout(420); return (await total()).replace(/[^0-9]/g, ""); };

await box.fill("750");
const at750 = await settle();
const expect750 = CORE.priceStickers({ size: 3, qty: 750, finish: "vinyl-matte", shape: "die", turnaround: "standard" }, CORE.DEFAULT_PRICING).total;
check("750 — a quantity no button offers — prices", Number(at750) === expect750, at750 + " vs " + expect750);
check("the label follows", (await p.locator("#czQtyVal").innerText()).includes("750"), await p.locator("#czQtyVal").innerText());
check("no preset is left looking selected",
  await p.locator('#qtyOpts button[aria-pressed="true"]').count() === 0);

await p.locator('#qtyOpts button[data-qty="500"]').click();
await p.waitForTimeout(120);
check("clicking a preset writes back into the box", await box.inputValue() === "500", await box.inputValue());
check("and that preset is pressed", await p.locator('#qtyOpts button[data-qty="500"]').getAttribute("aria-pressed") === "true");

await box.fill("999999");
await p.waitForTimeout(120);
const over = await p.locator("#czQtyHelp").innerText();
check("over the ceiling says so and points at a human", /trade/i.test(over) && over.includes("5,000"), over.slice(0, 70));
await box.blur();
await p.waitForTimeout(150);
check("blur clamps to the ceiling", await box.inputValue() === String(CORE.QTY_MAX), await box.inputValue());

await box.fill("3");
await p.waitForTimeout(120);
check("under the minimum says so", /minimum/i.test(await p.locator("#czQtyHelp").innerText()));
await box.blur();
await p.waitForTimeout(150);
check("blur clamps up to the minimum", await box.inputValue() === String(CORE.QTY_MIN), await box.inputValue());

await box.fill("1");
await p.waitForTimeout(120);
check("typing towards a bigger number is not snapped mid-keystroke",
  await box.inputValue() === "1", await box.inputValue());
await box.fill("150");
await p.waitForTimeout(420);
const expect150 = CORE.priceStickers({ size: 3, qty: 150, finish: "vinyl-matte", shape: "die", turnaround: "standard" }, CORE.DEFAULT_PRICING).total;
check("…and 150 then prices correctly", Number(await settle()) === expect150);
if (OUT) await p.locator(".cz-panel, .customizer, main").first().screenshot({ path: OUT + "/qty-box.png" }).catch(() => {});

// ------------------------------------------------------------------- admin
console.log("\n[ band impact table ]");
await p.goto(B + "/admin.html", { waitUntil: "networkidle" });
await p.fill("#admPass", "x"); await p.click("#admUnlock");
await p.waitForSelector(".adm-rail");
await p.click('[data-view="pricing"]');
await p.waitForTimeout(700);
await p.locator(".adm-impact").scrollIntoViewIfNeeded();
check("the impact table renders", await p.locator(".adm-impact").count() === 1);
const rows = p.locator(".adm-imptr:not(.adm-th)");
check("it covers twelve representative orders", await rows.count() === 12, String(await rows.count()));

const cells = await rows.evaluateAll(rs => rs.map(r => [...r.children].map(c => c.textContent.trim())));
check("no cell is still a placeholder", cells.every(c => c.every(v => v !== "—")), JSON.stringify(cells[0]));
check("percentages are signed", cells.every(c => /^[+-]?\d+%$/.test(c[3])), cells.map(c => c[3]).join(" "));

const twoInch = cells.find(c => c[0] === "100 × 2″");
check("2″ × 100 gets cheaper — the change Ian asked for", twoInch && twoInch[3].startsWith("-"), JSON.stringify(twoInch));
const fiveInch = cells.find(c => c[0] === "100 × 5″");
check("5″ × 100 gets dearer, and is shown as such", fiveInch && fiveInch[3].startsWith("+"), JSON.stringify(fiveInch));
const upClass = await p.locator('[data-impdiff]').evaluateAll(es => es.filter(e => e.className === "adm-imp-up").length);
check("rises are marked with the warning class", upClass >= 1, String(upClass) + " rises");

// the table must react to the editor, or it is decoration
const before = cells.find(c => c[0] === "500 × 3″")[2];
await p.locator('[data-band="5.rate"]').fill("0.400");
await p.waitForTimeout(400);
const after = await p.locator('.adm-imptr:not(.adm-th)').evaluateAll(rs => {
  const r = rs.find(x => x.children[0].textContent.trim() === "500 × 3″");
  return r ? r.children[2].textContent.trim() : null;
});
check("editing a rate moves the impact figures", after && after !== before, before + " → " + after);

if (OUT) await p.locator(".adm-impact").screenshot({ path: OUT + "/band-impact.png" }).catch(() => {});
check("no JS errors", errs.length === 0, errs.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
