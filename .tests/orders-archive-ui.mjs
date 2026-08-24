/* Archiving, from the dashboard's side.

   The API tests (orders-archive.mjs) prove the server does the right thing.
   This proves the dashboard does — and specifically the part that is easy to
   get half-right: an archived order has to disappear from every surface that
   answers a question about the business, not just from the orders list.

   An archived order still sitting in the revenue tile is worse than no archive
   at all, because the number looks authoritative and is wrong.

       python3 -m http.server 8901 &
       node .tests/orders-archive-ui.mjs                                     */
import { createRequire } from "node:module";
const _req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = _req("playwright-core")); } catch { console.log("SKIP"); process.exit(0); }
const CORE = _req("../assets/js/pricing-core.js");
const B = "http://127.0.0.1:8901";
let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); ok ? pass++ : fail++; };

const day = 86400000, now = Date.now();
const mk = (o) => ({
  key: "order:2026-08-0" + o.n + "T00:00:00.000Z:" + o.session,
  ref: o.ref, session: o.session, when: new Date(now - (o.age ?? 1) * day).toISOString(),
  amount: o.amount, currency: "AUD", status: "paid", stage: "new",
  product: "stickers", quantity: 100, size: "75 × 75 mm", finish: "Matte", shape: "Die-cut",
  turnaround: "Standard", name: o.name, email: o.name.toLowerCase() + "@example.com",
  artwork: "https://neotype.au/api/art/" + o.ref, archived: o.archived,
});

// Two live orders worth $500, two test-mode ones worth $900. If archiving
// leaks, the revenue tile says $1,400.
let ORDERS = [
  mk({ n: 1, ref: "LIVE0001", session: "cs_live_aaa", name: "Kelly", amount: 20000, age: 0 }),
  mk({ n: 2, ref: "LIVE0002", session: "cs_live_bbb", name: "Sam", amount: 30000, age: 1 }),
  mk({ n: 3, ref: "TEST0001", session: "cs_test_ccc", name: "Testy", amount: 40000, age: 2 }),
  mk({ n: 4, ref: "TEST0002", session: "cs_test_ddd", name: "Testo", amount: 50000, age: 3 }),
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));

const calls = [];
await p.route("**/api/**", (r) => {
  const u = r.request().url(), j = (x) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
  const post = r.request().method() === "POST";
  if (post) { try { calls.push({ u, body: JSON.parse(r.request().postData() || "{}") }); } catch { calls.push({ u, body: {} }); } }

  if (u.includes("/verify")) return j({ ok: true });
  if (u.includes("/enquiries")) return j({ enquiries: [] });
  if (u.includes("/pricing")) return j(CORE.DEFAULT_PRICING);

  if (u.includes("/order-archive")) {
    const b = calls[calls.length - 1].body;
    ORDERS = ORDERS.map((o) => (o.key === b.key ? { ...o, archived: b.archived !== false } : o));
    return j({ ok: true, archived: b.archived !== false });
  }
  if (u.includes("/order-purge")) {
    const b = calls[calls.length - 1].body;
    const t = ORDERS.find((o) => o.key === b.key);
    if (!t || !t.archived) return r.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Archive that order before deleting it"}' });
    ORDERS = ORDERS.filter((o) => o.key !== b.key);
    return j({ ok: true, deleted: 1 });
  }
  if (u.includes("/orders-sweep")) {
    const b = calls[calls.length - 1].body;
    let count = 0;
    if (b.mode === "archive-test") {
      ORDERS = ORDERS.map((o) => { if (/cs_test_/.test(o.session) && !o.archived) { count++; return { ...o, archived: true }; } return o; });
    } else {
      const before = ORDERS.length;
      ORDERS = ORDERS.filter((o) => !o.archived);
      count = before - ORDERS.length;
    }
    return j({ ok: true, mode: b.mode, count });
  }
  if (u.includes("/orders")) return j({ orders: ORDERS, total: ORDERS.length, capped: false, artExpires: 0 });
  return j({ ok: true });
});

// Confirm dialogs: accept everything, then assert the wording actually warns.
const dialogs = [];
p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });

await p.goto(B + "/admin.html", { waitUntil: "networkidle" });
await p.locator('input[type="password"]').fill("x");
await p.keyboard.press("Enter");
await p.waitForTimeout(1200);

const money = async () => (await p.locator("#panel-dash").innerText()).replace(/\s+/g, " ");

/* Show-the-archive is sticky across re-renders, which is right for the person
   using it and a trap for a script: blindly clicking the toggle collapses an
   archive that is already open. Ask for the state you want, not for a click. */
async function ensureArchiveOpen() {
  if (await p.locator(".adm-ord--archived").count() > 0) return;
  const t = p.locator("#admArchToggle");
  if (await t.count()) { await t.click(); await p.waitForTimeout(300); }
}

console.log("\n[ before anything is archived ]");
await p.locator('[data-view="orders"]').click();
await p.waitForTimeout(400);
check("all four orders are listed", await p.locator("#panel-orders .adm-ord").count() === 4,
  `${await p.locator("#panel-orders .adm-ord").count()} cards`);
check("the tidy-up offers to archive the two test orders",
  /Archive 2 test orders/.test(await p.locator("#panel-orders").innerText()));

console.log("\n[ archiving one order ]");
await p.locator(".adm-ord .adm-arch").first().click();
await p.waitForTimeout(500);
check("it leaves the orders list", await p.locator("#panel-orders .adm-ord:not(.adm-ord--archived)").count() === 3,
  `${await p.locator("#panel-orders .adm-ord:not(.adm-ord--archived)").count()} left`);
check("an archive appears", /Archive/.test(await p.locator("#panel-orders").innerText()));
check("the request said archived:true",
  calls.some((c) => c.u.includes("/order-archive") && c.body.archived === true));

console.log("\n[ the money figures must not count it ]");
await p.locator('[data-view="dash"]').click();
await p.waitForTimeout(400);
const dash = await money();
check("the archived $200 order is not in the dashboard", !/\$1,?400/.test(dash) && !/\$200\.00/.test(dash), dash.slice(0, 120));
await p.locator('[data-view="analytics"]').click();
await p.waitForTimeout(400);
const an = (await p.locator("#panel-analytics").innerText()).replace(/\s+/g, " ");
check("nor in Analytics", !/\$1,?400/.test(an), an.slice(0, 120));
await p.locator('[data-view="receipts"]').click();
await p.waitForTimeout(400);
check("nor in Receipts", !(await p.locator("#panel-receipts").innerText()).includes("LIVE0001"));

console.log("\n[ restoring puts it back ]");
await p.locator('[data-view="orders"]').click();
await p.waitForTimeout(300);
await ensureArchiveOpen();
await p.locator(".adm-ord--archived .adm-arch").first().click();
await p.waitForTimeout(500);
check("it is back in the list", await p.locator("#panel-orders .adm-ord:not(.adm-ord--archived)").count() === 4);
check("the request said archived:false",
  calls.some((c) => c.u.includes("/order-archive") && c.body.archived === false));

console.log("\n[ the test-mode sweep ]");
await p.locator('.adm-sweep[data-mode="archive-test"]').first().click();
await p.waitForTimeout(600);
check("it warns before doing anything", dialogs.some((d) => /test-mode order/i.test(d)), dialogs[dialogs.length - 1]);
check("and promises real orders are safe", dialogs.some((d) => /Real orders are not touched/i.test(d)));
check("both test orders are archived", await p.locator("#panel-orders .adm-ord:not(.adm-ord--archived)").count() === 2);
const left = await p.locator("#panel-orders").innerText();
check("the two live orders remain", /LIVE0001/.test(left) && /LIVE0002/.test(left));

console.log("\n[ permanent delete ]");
await ensureArchiveOpen();
const beforeDel = ORDERS.length;
await p.locator(".adm-purge").first().click();
await p.waitForTimeout(600);
check("it warns that this cannot be undone", dialogs.some((d) => /cannot be undone/i.test(d)));
check("the order is gone from storage", ORDERS.length === beforeDel - 1, `${ORDERS.length} of ${beforeDel}`);
check("a live order was not the one deleted", ORDERS.filter((o) => /cs_live_/.test(o.session)).length === 2);

console.log("\n[ emptying the archive ]");
await p.locator('.adm-sweep[data-mode="purge-archived"]').first().click();
await p.waitForTimeout(600);
check("only live orders are left", ORDERS.length === 2 && ORDERS.every((o) => /cs_live_/.test(o.session)),
  ORDERS.map((o) => o.ref).join(", "));
await p.waitForTimeout(300);
check("and the archive is gone from the page", await p.locator(".adm-ord--archived").count() === 0);

check("no JavaScript errors throughout", errs.length === 0, errs.join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
