/* A pass over every public page: one h1, every image described, every control
   named, no page-level horizontal scroll on a phone, no JS errors, and no two
   pages sharing a title. These are the checks that catch a whole class of quiet
   regressions — a heading demoted, a swatch added without a label, a wide table
   pushing the layout sideways — none of which look broken in a screenshot. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const titles = [];
const PAGES = ["index.html", "customizer.html", "banners.html", "corflute.html", "custom-stickers-brisbane.html", "success.html"];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
await p.route("**/api/**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CORE.DEFAULT_PRICING) }));
await p.route("**fonts.googleapis.com**", r => r.abort());
for (const page of PAGES) {
  const errs = [];
  p.removeAllListeners("pageerror"); p.on("pageerror", e => errs.push(e.message));
  await p.goto(B + "/" + page, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(700);
  const a = await p.evaluate(() => ({
    h1: document.querySelectorAll("h1").length,
    noAlt: [...document.querySelectorAll("img")].filter(i => !i.hasAttribute("alt")).length,
    unnamedBtn: [...document.querySelectorAll("button")].filter(b => !b.textContent.trim() && !b.getAttribute("aria-label")).length,
    unlabelled: [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(el =>
      !el.getAttribute("aria-label") && !el.closest("label") &&
      !(el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'))).length,
    title: document.title,
  }));
  const f = [];
  if (errs.length) f.push("JS: " + errs.join("|"));
  if (a.h1 !== 1) f.push("h1=" + a.h1);
  if (a.noAlt) f.push(a.noAlt + " img no alt");
  if (a.unnamedBtn) f.push(a.unnamedBtn + " unnamed button");
  if (a.unlabelled) f.push(a.unlabelled + " unlabelled input");
    if (f.length) { fail++; console.log("  FAIL  " + page + "  — " + f.join("; ")); }
  else { pass++; console.log("  PASS  " + page.padEnd(31) + a.title.slice(0, 58)); }
  titles.push([page, a.title]);
}
console.log("\n--- mobile 390 ---");
await p.setViewportSize({ width: 390, height: 844 });
for (const page of PAGES) {
  await p.goto(B + "/" + page, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(500);
  const o = await p.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return { s: document.documentElement.scrollWidth, w,
      over: [...document.querySelectorAll("body *")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 2; })
        .slice(0, 3).map(e => e.tagName.toLowerCase() + "." + String(e.className).split(" ")[0]) };
  });
    const bad = o.s > o.w + 2;
  if (bad) { fail++; console.log("  FAIL  " + page + `  — ${o.s} > ${o.w}: ` + o.over.join(", ")); }
  else { pass++; console.log("  PASS  " + page.padEnd(31) + "no horizontal scroll"); }
}

// Two pages competing for one phrase is worse than either ranking alone.
console.log("\n--- titles are distinct ---");
const seen = new Map();
let dupe = false;
for (const [page, t] of titles) {
  if (seen.has(t)) { dupe = true; console.log("  FAIL  " + page + " shares its title with " + seen.get(t)); }
  seen.set(t, page);
}
if (!dupe) { pass++; console.log("  PASS  all " + titles.length + " titles unique"); } else fail++;

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
