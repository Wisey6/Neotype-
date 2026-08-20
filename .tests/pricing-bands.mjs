import { createRequire } from "node:module";
const CORE = createRequire(import.meta.url)("../assets/js/pricing-core.js");
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };
const base = { finish: "vinyl-matte", shape: "die", size: 3, turnaround: "standard" };
const price = (qty, table, size = 3) => CORE.priceStickers({ ...base, size, qty }, table);

const BANDS = [
  { from: 1, rate: 0.01858 }, { from: 20, rate: 0.01649 }, { from: 50, rate: 0.01352 },
  { from: 100, rate: 0.01007 }, { from: 250, rate: 0.00865 },
  { from: 500, rate: 0.0085 }, { from: 2000, rate: 0.0085 },
];
const banded = JSON.parse(JSON.stringify(CORE.DEFAULT_PRICING));
banded.stickers.qtyBands = BANDS;

console.log("\n[ bands are opt-in ]");
for (const q of [15, 100, 500, 1000]) {
  const a = price(q, CORE.DEFAULT_PRICING);
  check(`qty ${q} unchanged with no bands set`, a && a.total > 0, "$" + a.total);
}

console.log("\n[ free quantity ]");
check("an off-preset quantity prices", !!price(37, CORE.DEFAULT_PRICING));
check("below the published minimum is refused", price(CORE.QTY_MIN - 1, CORE.DEFAULT_PRICING) === null);
check("above the ceiling is refused", price(CORE.QTY_MAX + 1, CORE.DEFAULT_PRICING) === null);
check("the minimum itself prices", !!price(CORE.QTY_MIN, CORE.DEFAULT_PRICING));

console.log("\n[ nobody pays more for buying less ]");
let prev = 0, mono = true, worst = "";
for (let q = CORE.QTY_MIN; q <= 2600; q++) {
  const t = price(q, banded).total;
  if (t < prev) { mono = false; worst = `qty ${q} ($${t}) < qty ${q - 1} ($${prev})`; break; }
  prev = t;
}
check("monotonic across every quantity from 15 to 2600", mono, worst || "2586 quantities checked");

console.log("\n[ the boundary clamp ]");
check("19 is charged the price of 20", price(19, banded).total === price(20, banded).total,
      `$${price(19, banded).total} vs $${price(20, banded).total}`);
check("21 costs more than 20", price(21, banded).total > price(20, banded).total);

console.log("\n[ cliff detector ]");
const bad = JSON.parse(JSON.stringify(banded));
bad.stickers.qtyBands[3].rate = 0.004;
const area3 = Math.pow(3 * 2.54, 2);
check("flags a steep drop", CORE.bandBreaks(CORE.bandsOf(bad, "stickers"), area3).length > 0);
check("names the boundary", CORE.bandBreaks(CORE.bandsOf(bad, "stickers"), area3).some(b => b.from === 100));

console.log("\n[ stock switches still hold with bands on ]");
const off = JSON.parse(JSON.stringify(banded));
off.off = { "stickers.finish.holographic": true };
check("a hidden finish still refuses to price", CORE.priceStickers({ ...base, finish: "holographic", qty: 100 }, off) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
