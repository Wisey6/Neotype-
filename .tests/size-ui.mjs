/* The size control in a real browser: presets, the custom reveal, clamping,
   and that the preview follows the shape the customer typed. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 })).newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.route("**/api/**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CORE.DEFAULT_PRICING) }));
await p.goto(B + "/customizer.html", { waitUntil: "networkidle" });
await p.waitForTimeout(600);

const total = async () => { await p.waitForTimeout(430); return Number((await p.locator("#priceTotal").innerText()).replace(/[^0-9]/g, "")); };
const priced = (o) => CORE.priceStickers({ finish: "vinyl-matte", shape: "die", turnaround: "standard", qty: 100, ...o }, CORE.DEFAULT_PRICING).total;

console.log("\n[ the control ]");
check("size is a dropdown, not a row of inch buttons", await p.locator("#czSizeSel").count() === 1);
check("no inch buttons remain", await p.locator("[data-size]").count() === 0);
check("the custom boxes start hidden", await p.locator("#czDims").isHidden());
check("it opens on 75 mm", /75 × 75 mm/i.test(await p.locator("#czSizeVal").innerText()),
  await p.locator("#czSizeVal").innerText());
check("the default price is the 75 mm price", await total() === priced({ w: 75, h: 75 }));

console.log("\n[ presets ]");
await p.selectOption("#czSizeSel", "100x100");
check("100 mm preset prices", await total() === priced({ w: 100, h: 100 }));
check("label follows", /100 × 100/i.test(await p.locator("#czSizeVal").innerText()));
check("custom boxes stay hidden on a preset", await p.locator("#czDims").isHidden());

console.log("\n[ custom size ]");
await p.selectOption("#czSizeSel", "custom");
await p.waitForTimeout(150);
check("choosing Custom reveals width and height", await p.locator("#czDims").isVisible());
check("the boxes carry the cutter's limits",
  await p.locator("#czW").getAttribute("min") === "10" && await p.locator("#czW").getAttribute("max") === "300");

await p.fill("#czW", "100"); await p.fill("#czH", "50");
check("a rectangle prices correctly", await total() === priced({ w: 100, h: 50 }), String(priced({ w: 100, h: 50 })));
check("the label reads as typed", /100 × 50 mm/i.test(await p.locator("#czSizeVal").innerText()),
  await p.locator("#czSizeVal").innerText());

console.log("\n[ the preview follows the shape ]");
const box = await p.locator("#czArtwork, .cz-artwork").first().boundingBox();
check("a 100×50 sticker previews wider than tall", box && box.width > box.height * 1.6,
  box && `${Math.round(box.width)}×${Math.round(box.height)}px`);
await p.fill("#czW", "50"); await p.fill("#czH", "100");
await p.waitForTimeout(400);
const tall = await p.locator("#czArtwork, .cz-artwork").first().boundingBox();
check("and 50×100 previews taller than wide", tall && tall.height > tall.width * 1.6,
  tall && `${Math.round(tall.width)}×${Math.round(tall.height)}px`);

console.log("\n[ limits are explained, then enforced ]");
await p.fill("#czW", "500");
await p.waitForTimeout(150);
check("over the maximum says so", /large-format|ask us/i.test(await p.locator("#czSizeHelp").innerText()),
  (await p.locator("#czSizeHelp").innerText()).slice(0, 60));
await p.locator("#czW").blur();
await p.waitForTimeout(200);
check("blur clamps down to 300", await p.locator("#czW").inputValue() === "300", await p.locator("#czW").inputValue());
await p.fill("#czW", "2");
await p.waitForTimeout(150);
check("under the minimum says so", /minimum/i.test(await p.locator("#czSizeHelp").innerText()));
await p.locator("#czW").blur();
await p.waitForTimeout(200);
check("blur clamps up to 10", await p.locator("#czW").inputValue() === "10", await p.locator("#czW").inputValue());
await p.fill("#czW", "1");
await p.waitForTimeout(120);
check("typing towards a valid number isn't snapped mid-keystroke", await p.locator("#czW").inputValue() === "1");

console.log("\n[ it still adds to checkout ]");
await p.fill("#czW", "100"); await p.fill("#czH", "50"); await p.locator("#czH").blur();
await p.waitForTimeout(400);
let posted = null;
await p.route("**/api/checkout", r => { posted = JSON.parse(r.request().postData() || "{}");
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://x" }) }); });
await p.evaluate(() => { window.NeotypeCheckout = { enabled: true, checkout: (o) => { window.__o = o; } }; });
await p.click("#addCart");
await p.waitForTimeout(300);
const o = await p.evaluate(() => window.__o);
const pay = o && o.payload;
check("the order carries mm, not inches",
  pay && pay.w === 100 && pay.h === 50 && pay.size === undefined,
  JSON.stringify(pay && { w: pay.w, h: pay.h, size: pay.size }));
if (OUT) await p.locator(".cz-panel, main").first().screenshot({ path: OUT + "/size-ui.png" }).catch(() => {});
check("no JS errors", errs.length === 0, errs.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
