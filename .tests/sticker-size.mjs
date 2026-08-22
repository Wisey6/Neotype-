/* Stickers in millimetres, custom width × height, and the cutter limits.
   The load-bearing case is the LEGACY one: orders already in KV and any page a
   customer still has open carry `size` in inches, and must keep pricing to the
   same number they were quoted. */
const CORE = (await import("../assets/js/pricing-core.js")).default
  ?? (await import("node:module")).createRequire(import.meta.url)("../assets/js/pricing-core.js");
const mod = await import("../functions/api/[[route]].js");

let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };
const base = { finish: "vinyl-matte", shape: "die", turnaround: "standard", qty: 100 };
const P = (o) => CORE.priceStickers({ ...base, ...o });

console.log("\n[ legacy inches still price identically ]");
for (const [inches, mm] of [[2, 51], [3, 76], [4, 102], [5, 127]]) {
  const a = P({ size: inches }), b = P({ w: mm, h: mm });
  check(`${inches}" == ${mm}mm`, a && b && a.total === b.total, a && `$${a.total} / $${b.total}`);
}
check("legacy quote now reports mm", P({ size: 3 }).labels.size === "76 × 76 mm", P({ size: 3 }).labels.size);

console.log("\n[ custom sizes ]");
const rect = P({ w: 100, h: 50 });
check("a rectangle prices", !!rect, rect && "$" + rect.total);
/* NOT 2×. Halving the area halves the m², but the curve gives the larger order
   a lower rate per m², so the price ratio lands between 1 and 2. Asserting 2×
   here would be asserting the sliding scale doesn't exist. */
const sq = P({ w: 100, h: 100 });
check("half the area costs less, but more than half", 
  rect && sq.total > rect.total && sq.total < rect.total * 2,
  rect && `$${sq.total} vs $${rect.total} — ratio ${(sq.total / rect.total).toFixed(2)}`);
check("w×h is not commutative in the label", P({ w: 100, h: 50 }).labels.size === "100 × 50 mm");
check("but IS in the price", P({ w: 100, h: 50 }).total === P({ w: 50, h: 100 }).total);
check("area scales as area, not as a side",
  Math.abs(P({ w: 150, h: 150 }).area / P({ w: 75, h: 75 }).area - 4) < 0.001);

console.log("\n[ the cutter's limits are enforced, not decorative ]");
const lim = CORE.sizeLimits(CORE.DEFAULT_PRICING);
check(`min is ${lim.min}mm, max ${lim.max}mm`, lim.min === 10 && lim.max === 300);
check("below minimum refuses", P({ w: lim.min - 1, h: 50 }) === null);
check("above maximum refuses", P({ w: lim.max + 1, h: 50 }) === null);
check("at the boundaries it prices", !!P({ w: lim.min, h: lim.min }) && !!P({ w: lim.max, h: lim.max }));
check("one bad axis is enough to refuse", P({ w: 50, h: 9999 }) === null);
check("garbage refuses", P({ w: "abc", h: 50 }) === null && P({ w: -50, h: 50 }) === null);
check("no dimensions at all refuses", P({}) === null);

console.log("\n[ Ian can move the limits from /admin ]");
const wider = JSON.parse(JSON.stringify(CORE.DEFAULT_PRICING));
wider.stickers.minMm = 5; wider.stickers.maxMm = 500;
check("a 5mm sticker prices once he allows it",
  !!CORE.priceStickers({ ...base, w: 5, h: 5 }, wider) && P({ w: 5, h: 5 }) === null);
check("a 450mm one too", !!CORE.priceStickers({ ...base, w: 450, h: 450 }, wider));
const broken = JSON.parse(JSON.stringify(CORE.DEFAULT_PRICING));
broken.stickers.minMm = 400; broken.stickers.maxMm = 100;   // inverted by a typo
check("an inverted range falls back rather than refusing every order",
  !!CORE.priceStickers({ ...base, w: 75, h: 75 }, broken));

console.log("\n[ bands and the minimum still apply to custom sizes ]");
const withBands = JSON.parse(JSON.stringify(CORE.DEFAULT_PRICING));
withBands.stickers.qtyBands = [{ from: 1, rate: 0.024 }, { from: 100, rate: 0.011 }, { from: 500, rate: 0.007 }];
const b100 = CORE.priceStickers({ ...base, w: 100, h: 50, qty: 100 }, withBands);
const b500 = CORE.priceStickers({ ...base, w: 100, h: 50, qty: 500 }, withBands);
check("banded custom size prices", !!b100 && !!b500, b100 && `$${b100.total} / $${b500.total}`);
check("per-sticker price still falls with volume", b100.total / 100 > b500.total / 500);
check("the $18 minimum still floors a tiny order", P({ w: 10, h: 10, qty: 15 }).total === 18);

console.log("\n[ the server re-prices from the same module ]");
const kv = new Map();
const env = {
  STRIPE_SECRET_KEY: "sk_test_stub",
  NEOTYPE: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) },
};
let sentToStripe = null;
globalThis.fetch = async (url, init) => {
  sentToStripe = String(init.body);
  return { ok: true, status: 200, json: async () => ({ id: "cs_test_x", url: "https://checkout.stripe.com/x" }) };
};
const checkout = (body) => mod.onRequest({
  request: new Request("https://neotype.au/api/checkout", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env,
});
let r = await checkout({ product: "stickers", w: 100, h: 50, qty: 100, finish: "vinyl-matte", shape: "die", turnaround: "standard" });
check("a custom-size checkout is accepted", r.status === 200, String(r.status));
/* Parse rather than substring-match: URLSearchParams encodes spaces as "+" and
   brackets as %5B/%5D, so a naive .includes() on the decoded string tests the
   encoding rather than the value — which is how this assertion failed first time. */
const sent = new URLSearchParams(sentToStripe || "");
const expect = P({ w: 100, h: 50 }).amount;
check("Stripe is charged the price the page showed",
  sent.get("line_items[0][price_data][unit_amount]") === String(expect),
  `sent ${sent.get("line_items[0][price_data][unit_amount]")}, expected ${expect}`);
check("the line item names the real size",
  (sent.get("line_items[0][price_data][product_data][name]") || "").includes("100 × 50 mm"),
  sent.get("line_items[0][price_data][product_data][name]"));

r = await checkout({ product: "stickers", w: 9999, h: 50, qty: 100, finish: "vinyl-matte", shape: "die", turnaround: "standard" });
check("a size the cutter can't do is refused server-side", r.status === 400, String(r.status));
r = await checkout({ product: "stickers", size: 3, qty: 100, finish: "vinyl-matte", shape: "die", turnaround: "standard" });
check("a legacy inch order still checks out", r.status === 200, String(r.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
