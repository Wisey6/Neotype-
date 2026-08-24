/* Archiving, restoring and deleting orders.

   Deleting a customer order is the only irreversible thing the dashboard can
   do. KV has no undo, and Stripe's copy is a record of a payment — not of this
   job's stage, notes or artwork link. So the destructive paths are the ones
   worth pinning down hardest:

     - purge refuses anything not already archived (the two-step is enforced by
       the server, not just by the dashboard's buttons)
     - the test-mode sweep matches on the Stripe session id, so it can never
       reach an order that took real money, however they are interleaved
     - purge-archived deletes only what is archived
     - every one of them needs the admin password

   No network, no credentials, nothing to configure:

       node .tests/orders-archive.mjs                                        */

const mod = await import("../functions/api/[[route]].js");

let pass = 0, fail = 0;
const check = (name, cond, note) => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

const PW = "correct-horse";

/* A KV stub that behaves like the real one in the way that matters here:
   list() pages. The sweep follows the cursor; a single-page stub would let a
   broken sweep pass by never having more than one page to miss. */
function makeEnv(seed, pageSize = 2) {
  const kv = new Map(seed);
  return {
    env: {
      ADMIN_PASSWORD: PW,
      NEOTYPE: {
        get: async (k, o) => {
          const v = kv.get(k);
          if (v == null) return null;
          return o && o.type === "json" ? JSON.parse(v) : v;
        },
        put: async (k, v) => void kv.set(k, v),
        delete: async (k) => void kv.delete(k),
        list: async ({ prefix, cursor } = {}) => {
          const all = [...kv.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort();
          const start = cursor ? Number(cursor) : 0;
          const slice = all.slice(start, start + pageSize);
          const next = start + pageSize;
          return {
            keys: slice.map((name) => ({ name })),
            list_complete: next >= all.length,
            cursor: next >= all.length ? undefined : String(next),
          };
        },
      },
    },
    kv,
  };
}

const order = (o) => JSON.stringify(Object.assign(
  { status: "paid", stage: "new", amount: 8700, currency: "AUD", when: "2026-08-01T00:00:00.000Z" }, o));

const K_TEST1 = "order:2026-08-01T00:00:00.000Z:cs_test_aaa111";
const K_TEST2 = "order:2026-08-02T00:00:00.000Z:cs_test_bbb222";
const K_LIVE  = "order:2026-08-03T00:00:00.000Z:cs_live_ccc333";
const K_MAN   = "order:2026-08-04T00:00:00.000Z:man_ddd444";

const seed = () => [
  [K_TEST1, order({ ref: "TEST0001", session: "cs_test_aaa111" })],
  [K_TEST2, order({ ref: "TEST0002", session: "cs_test_bbb222" })],
  [K_LIVE,  order({ ref: "LIVE0001", session: "cs_live_ccc333" })],
  [K_MAN,   order({ ref: "MAN00001", session: "man_ddd444" })],
];

async function call(env, route, body, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (!opts.noAuth) headers["X-Admin-Password"] = opts.password || PW;
  const request = new Request("https://neotype.au/api/" + route, {
    method: "POST", body: JSON.stringify(body), headers,
  });
  const res = await mod.onRequest({ request, env, params: { route: [route] } });
  let json = {};
  try { json = await res.json(); } catch { /* some errors have no body */ }
  return { status: res.status, json };
}

const read = async (kv, key) => { const v = kv.get(key); return v == null ? null : JSON.parse(v); };

console.log("\n[ archive and restore ]");
{
  const { env, kv } = makeEnv(seed());

  const a = await call(env, "order-archive", { key: K_TEST1, archived: true });
  check("archiving an order succeeds", a.status === 200 && a.json.ok === true, `HTTP ${a.status}`);
  const rec = await read(kv, K_TEST1);
  check("the record is flagged archived", rec.archived === true);
  check("and stamped with when", typeof rec.archivedAt === "string" && rec.archivedAt.length > 0);
  check("the order is NOT deleted", kv.has(K_TEST1));
  check("nothing else was touched", (await read(kv, K_LIVE)).archived === undefined);

  const r = await call(env, "order-archive", { key: K_TEST1, archived: false });
  const back = await read(kv, K_TEST1);
  check("restoring clears the flag", r.status === 200 && back.archived === false);
  check("and clears the timestamp with it", back.archivedAt === undefined);
}

console.log("\n[ delete is a two-step, enforced by the server ]");
{
  const { env, kv } = makeEnv(seed());

  const early = await call(env, "order-purge", { key: K_TEST1 });
  check("purging an order that is not archived is refused", early.status === 409, `HTTP ${early.status}`);
  check("and it is still there", kv.has(K_TEST1));
  check("the refusal says what to do", /archive/i.test(early.json.error || ""), early.json.error);

  await call(env, "order-archive", { key: K_TEST1, archived: true });
  const gone = await call(env, "order-purge", { key: K_TEST1 });
  check("once archived, it deletes", gone.status === 200 && gone.json.ok === true);
  check("and is really gone from storage", !kv.has(K_TEST1));
  check("its neighbours are untouched", kv.has(K_TEST2) && kv.has(K_LIVE) && kv.has(K_MAN));

  const missing = await call(env, "order-purge", { key: K_TEST1 });
  check("deleting it twice is a clean 404, not a crash", missing.status === 404);
}

console.log("\n[ the test-mode sweep cannot reach real money ]");
{
  const { env, kv } = makeEnv(seed());

  const s = await call(env, "orders-sweep", { mode: "archive-test" });
  check("the sweep runs", s.status === 200 && s.json.ok === true, `HTTP ${s.status}`);
  check("it archives both test orders", s.json.count === 2, `count=${s.json.count}`);
  check("cs_test_ order 1 is archived", (await read(kv, K_TEST1)).archived === true);
  check("cs_test_ order 2 is archived", (await read(kv, K_TEST2)).archived === true);
  check("the LIVE order is untouched", (await read(kv, K_LIVE)).archived === undefined);
  check("the MANUAL order is untouched", (await read(kv, K_MAN)).archived === undefined);
  check("nothing was deleted", kv.size === 4, `${kv.size} records`);

  const again = await call(env, "orders-sweep", { mode: "archive-test" });
  check("running it twice archives nothing new", again.json.count === 0, `count=${again.json.count}`);
  check("and reports what was already done", again.json.already === 2, `already=${again.json.already}`);
}

console.log("\n[ emptying the archive deletes only what is archived ]");
{
  const { env, kv } = makeEnv(seed());
  await call(env, "orders-sweep", { mode: "archive-test" });

  const e = await call(env, "orders-sweep", { mode: "purge-archived" });
  check("it deletes the archived pair", e.status === 200 && e.json.count === 2, `count=${e.json.count}`);
  check("cs_test_ orders are gone", !kv.has(K_TEST1) && !kv.has(K_TEST2));
  check("the LIVE order survives", kv.has(K_LIVE));
  check("the MANUAL order survives", kv.has(K_MAN));

  const empty = await call(env, "orders-sweep", { mode: "purge-archived" });
  check("emptying an empty archive is a no-op", empty.json.count === 0);
}

console.log("\n[ pagination — a sweep must see every page ]");
{
  // Nine test orders against a stub that returns two keys per page. A sweep
  // that ignores the cursor stops at two and reports success.
  const many = [];
  for (let i = 0; i < 9; i++) {
    const k = `order:2026-08-01T00:00:0${i}.000Z:cs_test_page${i}`;
    many.push([k, order({ ref: "PAGE000" + i, session: "cs_test_page" + i })]);
  }
  const { env, kv } = makeEnv(many, 2);
  const s = await call(env, "orders-sweep", { mode: "archive-test" });
  check("every page is followed", s.json.count === 9, `archived ${s.json.count} of 9`);
  let archivedAll = true;
  for (const [k] of many) if (!(await read(kv, k)).archived) archivedAll = false;
  check("and every record really carries the flag", archivedAll);
}

console.log("\n[ nothing here is reachable without the password ]");
{
  const { env, kv } = makeEnv(seed());
  await call(env, "order-archive", { key: K_TEST1, archived: true });

  for (const [route, body] of [
    ["order-archive", { key: K_TEST2, archived: true }],
    ["order-purge", { key: K_TEST1 }],
    ["orders-sweep", { mode: "purge-archived" }],
  ]) {
    const anon = await call(env, route, body, { noAuth: true });
    check(`${route} refuses an unauthenticated call`, anon.status === 401, `HTTP ${anon.status}`);
    const wrong = await call(env, route, body, { password: "guess" });
    check(`${route} refuses a wrong password`, wrong.status === 401, `HTTP ${wrong.status}`);
  }
  check("and nothing was changed by any of it", kv.size === 4 && (await read(kv, K_TEST2)).archived === undefined);
}

console.log("\n[ only real order keys, only known actions ]");
{
  const { env, kv } = makeEnv(seed());
  for (const bad of ["pricing", "admin:session:abc", "order:../pricing", "", "order:2026:cs_test_x y"]) {
    const r = await call(env, "order-archive", { key: bad, archived: true });
    check(`archive rejects ${JSON.stringify(bad)}`, r.status === 400, `HTTP ${r.status}`);
    const q = await call(env, "order-purge", { key: bad });
    check(`purge rejects ${JSON.stringify(bad)}`, q.status === 400, `HTTP ${q.status}`);
  }
  const m = await call(env, "orders-sweep", { mode: "delete-everything" });
  check("an unknown sweep mode is refused", m.status === 400, `HTTP ${m.status}`);
  check("storage is exactly as it was", kv.size === 4);
}


console.log("\n[ enquiries archive the same way ]");
{
  const E1 = "enquiry:2026-08-01T00:00:00.000Z:a1b2c3d4";
  const E2 = "enquiry:2026-08-02T00:00:00.000Z:e5f6a7b8";
  const seedE = () => [
    [E1, JSON.stringify({ name: "Rae Fisher", email: "rae@fisher.example", topic: "Quote", message: "300 stickers?", when: "2026-08-01T00:00:00.000Z" })],
    [E2, JSON.stringify({ name: "Spam Bot", email: "bot@spam.example", topic: "General", message: "buy followers", when: "2026-08-02T00:00:00.000Z" })],
    [K_LIVE, order({ ref: "LIVE0001", session: "cs_live_ccc333" })],
  ];
  const { env, kv } = makeEnv(seedE());

  const a = await call(env, "enquiry-archive", { key: E2, archived: true });
  check("archiving an enquiry succeeds", a.status === 200 && a.json.ok === true, `HTTP ${a.status}`);
  check("it is flagged, not deleted", (await read(kv, E2)).archived === true && kv.has(E2));
  check("the other enquiry is untouched", (await read(kv, E1)).archived === undefined);

  const early = await call(env, "enquiry-purge", { key: E1 });
  check("purging an unarchived enquiry is refused", early.status === 409, `HTTP ${early.status}`);

  const gone = await call(env, "enquiry-purge", { key: E2 });
  check("an archived one deletes", gone.status === 200 && !kv.has(E2));

  await call(env, "enquiry-archive", { key: E1, archived: true });
  const swept = await call(env, "enquiries-sweep", { mode: "purge-archived" });
  check("emptying the enquiry archive works", swept.status === 200 && swept.json.count === 1, `count=${swept.json.count}`);
  check("and it left the ORDER alone", kv.has(K_LIVE), "orders and enquiries must not sweep each other");
}

console.log("\n[ the two kinds cannot address each other ]");
{
  const E1 = "enquiry:2026-08-01T00:00:00.000Z:a1b2c3d4";
  const { env, kv } = makeEnv([
    [E1, JSON.stringify({ name: "Rae", email: "r@e.example", message: "hi", when: "2026-08-01T00:00:00.000Z", archived: true })],
    [K_TEST1, order({ ref: "TEST0001", session: "cs_test_aaa111", archived: true })],
  ]);
  const a = await call(env, "order-archive", { key: E1, archived: true });
  check("an enquiry key is rejected by the ORDER route", a.status === 400, `HTTP ${a.status}`);
  const b = await call(env, "enquiry-purge", { key: K_TEST1 });
  check("an order key is rejected by the ENQUIRY route", b.status === 400, `HTTP ${b.status}`);
  check("both records survive", kv.has(E1) && kv.has(K_TEST1));

  for (const [route, body] of [["enquiry-archive", { key: E1, archived: true }], ["enquiries-sweep", { mode: "purge-archived" }]]) {
    const anon = await call(env, route, body, { noAuth: true });
    check(`${route} refuses an unauthenticated call`, anon.status === 401, `HTTP ${anon.status}`);
  }
  const m = await call(env, "enquiries-sweep", { mode: "archive-test" });
  check("enquiries have no test-mode sweep", m.status === 400, `HTTP ${m.status}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
