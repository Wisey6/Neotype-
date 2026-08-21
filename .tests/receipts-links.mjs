/* The Receipts tab is an index into Stripe, so a link that doesn't resolve is
   the whole feature failing. And Analytics adds up a capped list, so its labels
   must not claim more than they can see. */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

const day = 86400000, now = Date.now();
const ord = (o) => ({
  key: "order:x:" + o.ref, ref: o.ref, when: new Date(now - (o.age || 1) * day).toISOString(),
  amount: o.amount || 7100, currency: "AUD", status: "paid", stage: "new",
  product: o.product || "stickers", quantity: 100, size: "75 × 75 mm", finish: "Matte",
  name: o.name, email: o.name.toLowerCase().replace(" ", "@") + ".example",
  session: o.session, payment: o.payment, live: o.live, source: o.source || "stripe",
});
const ORDERS = [
  ord({ ref: "NT-2001", name: "Kelly N", session: "cs_live_a1", payment: "pi_live_a1", live: true }),
  ord({ ref: "NT-2002", name: "Sam P", session: "cs_test_b2", payment: "pi_test_b2", live: false }),
  ord({ ref: "NT-2003", name: "Old Order", session: "cs_live_c3" }),          // pre-fix: no pi_
  ord({ ref: "NT-2004", name: "Walk In", session: "man_d4", source: "manual" }),
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on("pageerror", e => errs.push(e.message));
let capped = false;
await p.route("**/api/**", r => {
  const u = r.request().url(), j = b => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  if (u.includes("/verify")) return j({ ok: true });
  if (u.includes("/orders")) return j({ orders: ORDERS, total: capped ? 640 : ORDERS.length, capped, artExpires: 0 });
  if (u.includes("/enquiries")) return j({ enquiries: [] });
  if (u.includes("/pricing")) return j(CORE.DEFAULT_PRICING);
  return j({ ok: true });
});
const open = async (view) => {
  await p.goto(B + "/admin.html", { waitUntil: "networkidle" });
  await p.fill("#admPass", "x"); await p.click("#admUnlock");
  await p.waitForSelector(".adm-rail");
  await p.click(`[data-view="${view}"]`);
  await p.waitForTimeout(600);
};

console.log("\n[ Receipts → Stripe ]");
await open("receipts");
const links = await p.locator(".rec-link").evaluateAll(as => as.map(a => a.href));
check("three payments link out, the manual one doesn't", links.length === 3, String(links.length));
check("a live payment points at its PaymentIntent",
  links.some(h => h === "https://dashboard.stripe.com/payments/pi_live_a1"), links[0]);
check("NO link uses a cs_ session id on /payments/ — the original bug",
  !links.some(h => /\/payments\/cs_/.test(h)), links.join(" "));
check("a test-mode payment goes to the test dashboard",
  links.some(h => h === "https://dashboard.stripe.com/test/payments/pi_test_b2"), links[1]);
check("an order recorded before the fix falls back to search, not a dead link",
  links.some(h => h.includes("/search?query=cs_live_c3")), links[2]);
check("the manual order says so instead of linking",
  (await p.locator(".rec-src").innerText()).toLowerCase().includes("hand"));

console.log("\n[ Analytics doesn't overclaim ]");
await open("analytics");
let txt = await p.locator(".an-stats").innerText();
check("with a full list it says all time", /All time/i.test(txt) && /since the shop opened/i.test(txt),
  txt.replace(/\n/g, " · ").slice(0, 90));

capped = true;
await open("analytics");
txt = await p.locator(".an-stats").innerText();
check("with a capped list it does NOT claim all time", !/since the shop opened/i.test(txt));
check("and it says how many it couldn't see", /640/.test(txt), txt.replace(/\n/g, " · ").slice(0, 130));
check("no JS errors", errs.length === 0, errs.join(" | "));

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
