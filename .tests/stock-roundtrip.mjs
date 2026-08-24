/* Out-of-stock switches, checked the whole way round.

   `stock-toggle.mjs` already covered both ends of this and still let the bug
   ship. Its last assertion is "save payload carries the off flag" — it checked
   what the BROWSER SENDS and stopped there. The flag was correct on the wire
   and thrown away on arrival: sanitizePricing rebuilt the table from
   DEFAULT_PRICING and copied only numbers at keys that already existed there,
   and `off` is neither a number nor a key in the defaults. So Ian could switch
   holographic off, watch it say Saved, and go on selling holographic.

   The lesson this file encodes: assert what the server KEEPS, not what the
   client sent. Everything below goes through the real Pages Function. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
const mod = await import("../functions/api/[[route]].js");
const CORE = _req("../assets/js/pricing-core.js");
const D = CORE.DEFAULT_PRICING;
const OUT = process.argv[2], B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

/* One admin save, then read back exactly what a customer's browser and the
   checkout endpoint would be handed. */
function shop() {
  const kv = new Map();
  const env = { ADMIN_PASSWORD: "pw", NEOTYPE: {
    get: async (k, o) => { const v = kv.get(k); return v == null ? null : (o && o.type === "json" ? JSON.parse(v) : v); },
    put: async (k, v) => void kv.set(k, v), list: async () => ({ keys: [] }) } };
  const call = (p, i = {}) => mod.onRequest({ request: new Request("https://x/api/" + p, i), env });
  return {
    save: (table) => call("pricing", { method: "POST", headers: { "x-admin-password": "pw", "content-type": "application/json" }, body: JSON.stringify(table) }),
    load: async () => (await call("pricing")).json(),
    buy: (body) => call("checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  };
}
const after = async (table) => { const s = shop(); await s.save(table); return s.load(); };
const withOff = (off) => { const t = structuredClone(D); t.off = off; return t; };

console.log("\n[ the regression: a switch that survives being saved ]");
{
  const back = await after(withOff({ "stickers.finish.holographic": true }));
  check("the off flag is still there after a save", back.off && back.off["stickers.finish.holographic"] === true,
    JSON.stringify(back.off));
  const opt = { w: 75, h: 75, qty: 100, finish: "holographic", shape: "die", turnaround: "standard" };
  check("and the stored table refuses to price it", CORE.priceStickers(opt, back) === null);
  const s = shop();
  await s.save(withOff({ "stickers.finish.holographic": true }));
  const r = await s.buy({ product: "stickers", ...opt });
  check("/api/checkout turns the order away", r.status === 400, r.status + " " + (await r.text()).slice(0, 40));
  const ok = await s.buy({ product: "stickers", ...opt, finish: "vinyl-gloss" });
  check("a finish that IS in stock gets past pricing", ok.status !== 400, String(ok.status) + " (503 = priced fine, no Stripe key in the test)");
}

console.log("\n[ the quantity bands were write-only for the same reason ]");
{
  const t = structuredClone(D);
  t.stickers.qtyBands = [{ from: 1, rate: 0.024 }, { from: 100, rate: 0.011 }];
  const back = await after(t);
  check("bands survive a save", JSON.stringify(back.stickers.qtyBands) === JSON.stringify(t.stickers.qtyBands),
    JSON.stringify(back.stickers.qtyBands));
  check("and actually price the shop", CORE.bandsOf(back, "stickers") !== null);
  check("turning them off again removes them", (await after(structuredClone(D))).stickers.qtyBands === undefined);
  const empty = structuredClone(D); empty.stickers.qtyBands = [];
  check("an empty table is not a table — the curve takes over", (await after(empty)).stickers.qtyBands === undefined);
}

console.log("\n[ every other setting still round-trips ]");
{
  const t = structuredClone(D);
  t.stickers.rate.base = 91; t.stickers.rate.extra = 133; t.stickers.rate.decay = 0.61;
  t.stickers.min = 22; t.stickers.minMm = 15; t.stickers.maxMm = 250; t.stickers.finish.glitter = 1.7;
  t.banner.rate = 33; t.corflute.min = 41; t.corflute.sides.double = 1.8; t.banner.eyelets["extra-even"] = 1.09;
  const b = await after(t);
  check("rate, premium and decay", b.stickers.rate.base === 91 && b.stickers.rate.extra === 133 && b.stickers.rate.decay === 0.61);
  check("minimum order", b.stickers.min === 22);
  check("the cutter's size limits", b.stickers.minMm === 15 && b.stickers.maxMm === 250, `${b.stickers.minMm}–${b.stickers.maxMm}`);
  check("a sticker finish multiplier", b.stickers.finish.glitter === 1.7);
  check("large-format rates and nested multipliers",
    b.banner.rate === 33 && b.corflute.min === 41 && b.corflute.sides.double === 1.8 && b.banner.eyelets["extra-even"] === 1.09);
}

console.log("\n[ nothing switched off can be priced — every option, every product ]");
{
  const groups = { stickers: ["finish", "shape", "turnaround"] };
  for (const p of Object.keys(CORE.LF_META)) groups[p] = Object.keys(CORE.LF_META[p].groups);
  const base = {
    stickers: { w: 75, h: 75, qty: 100, finish: "vinyl-matte", shape: "die", turnaround: "standard" },
    banner:   { w: 2, h: 1, qty: 1, material: "vinyl-440", finishing: "hem-eyelets", eyelets: "standard", rope: "none", turnaround: "standard" },
    corflute: { w: .6, h: .9, qty: 1, thickness: "5mm", sides: "single", eyelets: "none", turnaround: "standard" }
  };
  const leaks = []; let n = 0;
  for (const prod of Object.keys(groups)) for (const g of groups[prod]) {
    const opts = prod === "stickers" ? Object.keys(D.stickers[g]) : Object.keys(CORE.LF_META[prod].groups[g]);
    for (const opt of opts) {
      n++;
      const stored = await after(withOff({ [`${prod}.${g}.${opt}`]: true }));
      const o = { ...base[prod], [g]: opt };
      const q = prod === "stickers" ? CORE.priceStickers(o, stored) : CORE.priceLargeFormat(prod, o, stored);
      if (q) leaks.push(`${prod}.${g}.${opt}`);
    }
  }
  check(`all ${n} options refuse when switched off`, leaks.length === 0, leaks.slice(0, 6).join(" "));
}

console.log("\n[ carrying two new settings did not open a door ]");
{
  const t = structuredClone(D);
  t.off = { "stickers.finish.holographic": true, "stickers.finish.<script>": true, "evil.group.opt": true,
            "stickers.nosuchgroup.x": true, "stickers.finish.notreal": true,
            "stickers.finish.chrome": "yes", "stickers.finish.clear": 1 };
  t.stickers.qtyBands = [{ from: -5, rate: .02 }, { from: 10, rate: -1 }, { from: "x", rate: "y" },
                         { from: 50, rate: .01 }, null, { from: 20, rate: .015 }];
  t.stickers.newSetting = 999; t.newProduct = { rate: 1 }; t.stickers.rate.base = -4;
  const b = await after(t);
  check("only real option paths are stored", JSON.stringify(Object.keys(b.off)) === '["stickers.finish.holographic"]', JSON.stringify(b.off));
  check("a value that is not exactly true is not 'off'",
    b.off["stickers.finish.chrome"] === undefined && b.off["stickers.finish.clear"] === undefined);
  check("junk band rows dropped, survivors sorted",
    JSON.stringify(b.stickers.qtyBands) === '[{"from":20,"rate":0.015},{"from":50,"rate":0.01}]', JSON.stringify(b.stickers.qtyBands));
  check("invented keys are still refused", b.stickers.newSetting === undefined && b.newProduct === undefined);
  check("a negative rate is still refused", b.stickers.rate.base === D.stickers.rate.base, String(b.stickers.rate.base));
  const many = structuredClone(D);
  many.stickers.qtyBands = Array.from({ length: 400 }, (_, i) => ({ from: i + 1, rate: .01 }));
  check("the band table cannot grow without limit", (await after(many)).stickers.qtyBands.length <= 12);
}

/* ---- the customer's side ---------------------------------------------- */
let chromium; try { ({ chromium } = _req("playwright-core")); } catch {
  console.log(`\n(browser half skipped — no playwright-core)\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errs = [];
const open = async (page, off) => {
  const stored = await after(off ? withOff(off) : structuredClone(D));   // what the API would really serve
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on("pageerror", e => errs.push(page + ": " + e.message));
  await p.route("**/api/**", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stored) }));
  await p.goto(B + "/" + page, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  return p;
};

console.log("\n[ the customizer, fed the table the server really stored ]");
{
  const p = await open("customizer.html", { "stickers.finish.holographic": true });
  check("the switched-off finish is not offered", await p.locator('[data-finish="holographic"]').isHidden());
  check("the other six are", await p.locator("[data-finish]:visible").count() === 6);
  await p.close();
}
{
  // the option the page opens on is the one that goes out of stock
  const p = await open("customizer.html", { "stickers.finish.vinyl-matte": true });
  check("it moves the customer off the dead option rather than stranding them",
    await p.locator('[data-finish][aria-pressed="true"]').getAttribute("data-finish") !== "vinyl-matte",
    await p.locator('[data-finish][aria-pressed="true"]').getAttribute("data-finish"));
  check("and still shows a real price", Number((await p.locator("#priceTotal").innerText()).replace(/[^0-9]/g, "")) > 0);
  check("add to cart still works", !(await p.locator("#addCart").isDisabled()));
  await p.close();
}
{
  const off = {}; for (const k of Object.keys(D.stickers.finish)) off["stickers.finish." + k] = true;
  const p = await open("customizer.html", off);
  check("with every finish off, no finish is offered", await p.locator("[data-finish]:visible").count() === 0);
  /* The old behaviour: the last good price stayed on screen and the button
     stayed live, so the customer's first clue was a failed checkout. */
  check("the price says so rather than showing the last one that worked",
    (await p.locator("#priceTotal").innerText()).replace(/[^0-9]/g, "") === "",
    await p.locator("#priceTotal").innerText());
  check("add to cart is disabled", await p.locator("#addCart").isDisabled());
  check("and it explains why", /can't print this combination/i.test(await p.locator("#czQuoteLines").innerText()));
  if (OUT) await p.locator(".cz-panel, main").first().screenshot({ path: OUT + "/stock-unavailable.png" }).catch(() => {});
  await p.close();
}

console.log("\n[ the large-format builders ]");
for (const [page, off1, offAll] of [
  ["banners.html", { "banner.material.mesh": true }, { "banner.material.mesh": true, "banner.material.vinyl-440": true }],
  ["corflute.html", { "corflute.thickness.3mm": true }, { "corflute.thickness.3mm": true, "corflute.thickness.5mm": true }]
]) {
  const g = page === "banners.html" ? "material" : "thickness";
  let p = await open(page, off1);
  check(`${page}: the off option is not offered`, await p.locator(`[data-lfc-${g}]`).count() === 1);
  check(`${page}: it still prices`, Number((await p.locator("#lfTotal").innerText()).replace(/[^0-9]/g, "")) > 0);
  check(`${page}: checkout still works`, !(await p.locator("#lfCheckout").isDisabled()));
  await p.close();

  p = await open(page, offAll);
  check(`${page}: with the whole group off, nothing is offered`, await p.locator(`[data-lfc-${g}]`).count() === 0);
  /* This one read "$0" before — worse than a stale price, because free is a
     claim rather than a leftover. */
  check(`${page}: it does not advertise itself at $0`,
    (await p.locator("#lfTotal").innerText()).replace(/[^0-9]/g, "") === "",
    await p.locator("#lfTotal").innerText());
  check(`${page}: checkout is disabled`, await p.locator("#lfCheckout").isDisabled());
  await p.close();
}
check("no JS errors anywhere", errs.length === 0, errs.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
