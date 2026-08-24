/* The dashboard's new look, measured rather than eyeballed.

   /admin used to load the shop's styles.css and inherit a dark synthwave
   canvas, a 148px marketing header and a glitching logo above a table of
   orders. It is now a standalone light application. Every check here is
   something that would go wrong silently if that were undone or half-undone —
   a stylesheet re-added, a token overridden, a colour picked by eye. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

/* ---- contrast, computed the same way a checker would ------------------- */
const lum = (rgb) => {
  const c = rgb.map(v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
/* An active nav item's tint is rgba(...,.10). Read as opaque it measures teal
   on teal — 1:1 — and the check fails on a colour nobody can see. Composite it
   over what is actually behind it first. */
const over = (fg, bg) => {
  const a = Number((fg.match(/[\d.]+/g) || [])[3] ?? 1);
  if (a >= 1) return fg;
  const f = parse(fg), b = parse(bg);
  return `rgb(${f.map((v, i) => Math.round(v * a + b[i] * (1 - a))).join(",")})`;
};
const ratio = (a, b) => { const x = lum(parse(a)), y = lum(parse(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const isLight = (s) => lum(parse(s)) > 0.6;

const day = 86400000, now = Date.now();
const order = (o) => ({ key: "order:x:" + o.ref, ref: o.ref, when: new Date(now - (o.age || 1) * day).toISOString(),
  amount: o.amount || 7100, currency: "AUD", status: o.status || "paid", stage: o.stage || "new",
  product: o.product || "stickers", quantity: 100, size: "75 × 75 mm", finish: "Matte", shape: "Die-cut",
  turnaround: "Standard", name: o.name, email: o.email, payment: "pi_" + o.ref, live: true,
  artwork: "https://neotype.au/api/art/" + o.ref });
const ORDERS = [
  order({ ref: "NT-1012", name: "Kelly Nguyen", email: "kelly@brewco.com.au", age: 0, amount: 14200 }),
  order({ ref: "NT-1011", name: "Sam Porter", email: "sam@ridgeline.com.au", age: 1, stage: "proof", amount: 8600 }),
  order({ ref: "NT-1010", name: "Dana Iyer", email: "dana@iyer.example", age: 2, product: "banner", amount: 31000 }),
  order({ ref: "NT-1009", name: "Ari Blake", email: "ari@blake.example", age: 3, status: "pending", amount: 5400 }),
  order({ ref: "NT-1008", name: "Mia Cole", email: "mia@cole.example", age: 6, product: "corflute", amount: 22300 }),
  // a stage nobody defined — an older record, or one we renamed. Must not print
  // the literal word "undefined" onto the card.
  order({ ref: "NT-1007", name: "Dev Rao", email: "dev@rao.example", age: 9, stage: "wrapping", amount: 6900 }),
];
const ENQ = [{ key: "enq:1", when: new Date(now - day).toISOString(), name: "Rae Fisher",
  email: "rae@fisher.example", topic: "Quote", message: "After 300 die-cut stickers." }];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const stub = (p) => p.route("**/api/**", r => { const u = r.request().url(), j = x => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
  if (u.includes("/verify")) return j({ ok: true });
  if (u.includes("/orders")) return j({ orders: ORDERS, total: ORDERS.length, capped: false, artExpires: 90 });
  if (u.includes("/enquiries")) return j({ enquiries: ENQ });
  if (u.includes("/pricing")) return j(CORE.DEFAULT_PRICING);
  return j({ ok: true }); });

const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
await stub(p);
await p.goto(B + "/admin.html", { waitUntil: "networkidle" });
await p.waitForTimeout(400);

console.log("\n[ it stopped inheriting the shop's theme ]");
const sheets = await p.$$eval('link[rel="stylesheet"]', els => els.map(e => e.getAttribute("href")));
check("styles.css is not loaded", !sheets.some(h => /styles\.css/.test(h)), sheets.join(" "));
check("admin.css is", sheets.some(h => /admin\.css/.test(h)));
check("no marketing header on the page", await p.locator(".site-header").count() === 0);
check("no glitching logo", await p.locator("[data-glitch]").count() === 0);

console.log("\n[ sign in ]");
const canvas = await p.locator("body").evaluate(el => getComputedStyle(el).backgroundColor);
const cardBg = await p.locator("#admRoot").evaluate(el => getComputedStyle(el).backgroundColor);
/* Dark by default — this is Neotype's tool and Neotype is a dark brand. The
   white version is a preference on the rail, not the shipped state. */
check("the dashboard opens in the brand's dark theme", !isLight(canvas), canvas);
check("sign-in is a card, not text adrift on the canvas", cardBg !== canvas, cardBg);
check("it carries a mark", await p.locator(".adm-lockmark").count() === 1);
check("there is no rail before you are signed in", await p.locator(".adm-rail").count() === 0);

await p.locator('input[type="password"]').fill("x");
await p.keyboard.press("Enter");
await p.waitForTimeout(1200);

console.log("\n[ the shell ]");
const rail = await p.locator(".adm-rail").boundingBox();
const main = await p.locator(".adm-main").boundingBox();
check("the rail is on the left", rail.x < 4, `x=${Math.round(rail.x)}`);
check("it runs the full height of the window", rail.height >= 940, `${Math.round(rail.height)}px of 950`);
check("it starts at the very top — no header above it", rail.y < 2, `y=${Math.round(rail.y)}`);
check("content sits beside it, not under it", main.x >= rail.x + rail.width - 1, `main.x=${Math.round(main.x)} rail ends ${Math.round(rail.x + rail.width)}`);
check("the rail lifts off the canvas rather than blending into it",
  await p.locator(".adm-rail").evaluate(el => getComputedStyle(el).backgroundColor) !== canvas,
  await p.locator(".adm-rail").evaluate(el => getComputedStyle(el).backgroundColor));
check("every nav section is there, plus the theme switch", await p.locator(".adm-navbtn").count() === 10,
  `${await p.locator(".adm-navbtn").count()} buttons`);
/* textContent, not innerText: the label is text-transform:uppercase, so the
   rendered text is "PRICING" and comparing it against the source case fails on
   a group that is perfectly correct. */
check("pricing is a group of three under Dashboard, not one page at the end",
  await p.locator(".adm-navbtn--sub").count() === 3 &&
  (await p.locator(".adm-navgroup").textContent()) === "Pricing",
  `${await p.locator(".adm-navbtn--sub").count()} sub-items`);
check("each product has its own pricing page",
  await p.locator("#panel-price-stickers").count() === 1 &&
  await p.locator("#panel-price-banner").count() === 1 &&
  await p.locator("#panel-price-corflute").count() === 1);
check("and each one carries its own Save", await p.locator(".adm-save").count() === 3);
check("the current section is marked for a screen reader too, not colour alone",
  await p.locator('.adm-navbtn[aria-current="page"]').count() === 1);

console.log("\n[ contrast — the thing a light repaint quietly breaks ]");
const surface = await p.locator(".dash-tile").first().evaluate(el => getComputedStyle(el).backgroundColor);
for (const [label, sel] of [
  ["body text", ".lead"],
  ["nav label", '.adm-navbtn:not([aria-current="page"])'],
  ["panel heading", ".display-lg"],
  ["micro-label", ".eyebrow"],
  ["tile number", ".dash-n"],
  ["tile caption", ".dash-note"]
]) {
  const el = p.locator(sel).first();
  const [fg, bg] = await el.evaluate(e => {
    let n = e, bg = "rgba(0, 0, 0, 0)";
    while (n && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
    return [getComputedStyle(e).color, bg];
  });
  const r = ratio(fg, bg);
  check(`${label} clears 4.5:1`, r >= 4.5, r.toFixed(2) + ":1");
}
const railActive = await p.locator('.adm-navbtn[aria-current="page"]').evaluate(e =>
  [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
const railBg = await p.locator(".adm-rail").evaluate(el => getComputedStyle(el).backgroundColor);
const activeBg = over(railActive[1], railBg);
check("the active nav item clears 4.5:1 on its own tint", ratio(railActive[0], activeBg) >= 4.5,
  ratio(railActive[0], activeBg).toFixed(2) + ":1");

/* A second palette is a second chance to ship an illegible one. Everything
   above is re-measured after the switch, because "we checked the dark one" is
   not a statement about the theme Ian may actually be using. */
console.log("\n[ the light theme is a real theme, not a leftover ]");
await p.locator("#admTheme").click();
await p.waitForTimeout(300);
const lightCanvas = await p.locator("body").evaluate(el => getComputedStyle(el).backgroundColor);
check("the switch actually lights the page", isLight(lightCanvas), lightCanvas);
check("and says how to get back", /dark/i.test(await p.locator("#admTheme").innerText()),
  await p.locator("#admTheme").innerText());
check("the mark stays visible on a white rail — it is inverted, not hidden",
  (await p.locator(".adm-rail-h img").evaluate(el => getComputedStyle(el).filter)).indexOf("invert") !== -1,
  await p.locator(".adm-rail-h img").evaluate(el => getComputedStyle(el).filter));
for (const [label, sel] of [["body text", ".lead"], ["nav label", '.adm-navbtn:not([aria-current="page"])'],
     ["micro-label", ".eyebrow"], ["tile caption", ".dash-note"]]) {
  const [fg, bg] = await p.locator(sel).first().evaluate(e => {
    let n = e, bg = "rgba(0, 0, 0, 0)";
    while (n && bg === "rgba(0, 0, 0, 0)") { bg = getComputedStyle(n).backgroundColor; n = n.parentElement; }
    return [getComputedStyle(e).color, bg];
  });
  check(`light: ${label} clears 4.5:1`, ratio(fg, bg) >= 4.5, ratio(fg, bg).toFixed(2) + ":1");
}
check("the choice survives a reload", await p.evaluate(() => { try { return localStorage.getItem("neotype.admin.theme"); } catch (e) { return null; } }) === "light");
await p.locator("#admTheme").click();
await p.waitForTimeout(250);
check("and switches back", !isLight(await p.locator("body").evaluate(el => getComputedStyle(el).backgroundColor)));

console.log("\n[ orders ]");
await p.locator('[data-view="orders"]').click();
await p.waitForTimeout(500);
const ordersTxt = await p.locator("#panel-orders").innerText();
check("an unknown stage does not render as the word \"undefined\"", !/undefined/i.test(ordersTxt));
check("it shows the raw stage instead", /wrapping/i.test(ordersTxt));
check("an unpaid order is tinted, not just pilled",
  await p.locator(".adm-ord--pending").first().evaluate(el => getComputedStyle(el).backgroundColor) !== surface);
check("and offers no artwork download", await p.locator(".adm-ord--pending .adm-ord-art .btn").count() === 0);
check("but can still be archived out of the way",
  await p.locator(".adm-ord--pending .adm-arch").count() === 1);

console.log("\n[ charts — the palette is validated, so pin it ]");
await p.locator('[data-view="analytics"]').click();
await p.waitForTimeout(600);
/* These four passed the categorical validator against a light surface:
   lightness band, chroma floor, CVD separation, normal-vision separation and
   contrast. Changing one by eye is how a palette silently stops passing. */
/* The dark-surface set. A palette is validated against a surface, not in the
   abstract — the light-surface hues fail the lightness band here and vice
   versa, so these are deliberately different numbers, not a drift. */
const WANT = ["rgb(4, 164, 159)", "rgb(143, 108, 230)", "rgb(193, 134, 31)"];
const dots = await p.locator(".mix-dot").evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor));
check("the mix bars use the light-surface palette", dots.every(d => WANT.includes(d)), dots.join(" "));
check("every bar is named as well as coloured", await p.locator(".mix-label").count() === dots.length);
check("and carries its own value", await p.locator(".mix-val").count() === dots.length);
check("a table sits behind the chart", await p.locator(".an-table").count() >= 1);
/* A value label pinned to the top of the plot floats level with every other
   week's, so you have to trace down to find which bar it belongs to. */
const bars = await p.locator(".rev-col").evaluateAll(cols => cols.map(c => {
  const v = c.querySelector(".rev-val"), b = c.querySelector(".rev-bar");
  if (!v || !b || !v.textContent.trim()) return null;
  return v.getBoundingClientRect().bottom - b.getBoundingClientRect().top;
}).filter(x => x !== null));
check("each revenue label sits directly on its own bar", bars.length > 0 && bars.every(gap => gap > -14 && gap <= 2),
  bars.map(g => Math.round(g)).join(","));

console.log("\n[ receipts read as a ledger ]");
await p.locator('[data-view="receipts"]').click();
await p.waitForTimeout(500);
const when = await p.locator(".rec-when").first();
check("the date column does not wrap onto two lines",
  (await when.boundingBox()).height < 30, Math.round((await when.boundingBox()).height) + "px");
check("figures are monospaced, so columns line up",
  /mono/i.test(await p.locator(".rec-amt").first().evaluate(el => getComputedStyle(el).fontFamily)));

if (OUT) await p.screenshot({ path: OUT + "/admin-desktop.png", fullPage: false }).catch(() => {});

console.log("\n[ on a phone the rail becomes a tab strip ]");
const mp = await (await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })).newPage();
const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
await stub(mp);
await mp.goto(B + "/admin.html", { waitUntil: "networkidle" });
await mp.locator('input[type="password"]').fill("x");
await mp.keyboard.press("Enter");
await mp.waitForTimeout(1200);
const mrail = await mp.locator(".adm-rail").boundingBox();
const mmain = await mp.locator(".adm-main").boundingBox();
check("the rail is a strip across the top, not a column", mrail.height < 130, `${Math.round(mrail.height)}px tall`);
check("it spans the width", mrail.width > 370, `${Math.round(mrail.width)}px`);
check("content is below it, not beside it", mmain.y >= mrail.y + mrail.height - 2);
check("nothing spills sideways",
  await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  await mp.evaluate(() => document.documentElement.scrollWidth + " vs " + window.innerWidth));
check("every section is still reachable", await mp.locator(".adm-navbtn").count() === 10,
  `${await mp.locator(".adm-navbtn").count()} buttons`);
if (OUT) await mp.screenshot({ path: OUT + "/admin-mobile.png", fullPage: false }).catch(() => {});

check("no JS errors on either width", errs.length === 0 && merrs.length === 0, errs.concat(merrs).join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
