/* The email-code sign-in, exercised against the real Function.
   What matters here is not that the happy path works — it's that each of the
   ways in that shouldn't work, doesn't. */
const mod = await import("../functions/api/[[route]].js");

let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  return { ok: true, status: 200, text: async () => "" };
};

const kv = new Map();
const ttl = new Map();
const env = {
  ADMIN_PASSWORD: "the-real-password",
  ADMIN_EMAIL: "kiko@neotype.au",
  RESEND_API_KEY: "re_stub",
  ENQUIRY_FROM: "Neotype orders <orders@neotype.au>",
  NEOTYPE: {
    get: async (k, o) => {
      const v = kv.get(k);
      if (v == null) return null;
      return o && o.type === "json" ? JSON.parse(v) : v;
    },
    put: async (k, v, o) => { kv.set(k, v); if (o) ttl.set(k, o.expirationTtl); },
    delete: async (k) => void kv.delete(k),
    list: async () => ({ keys: [] }),
  },
};

const call = (path, init = {}) =>
  mod.onRequest({ request: new Request("https://neotype.au/api/" + path, init), env });

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  — " + detail : "")); }
}
const post = (p, body, headers = {}) =>
  call(p, { method: "POST", headers: { "content-type": "application/json", ...headers },
            body: body === undefined ? undefined : JSON.stringify(body) });

console.log("\nBefore signing in");
check("no credentials is 401", (await post("verify")).status === 401);
check("wrong password is 401", (await post("verify", undefined, { "x-admin-password": "guess" })).status === 401);
check("a made-up token is 401", (await post("verify", undefined, { "x-admin-token": "a".repeat(64) })).status === 401);
check("the real password still works", (await post("verify", undefined, { "x-admin-password": "the-real-password" })).status === 200);

console.log("\nRequesting a code");
let r = await post("admin-code");
let d = await r.json();
check("send succeeds", r.status === 200 && d.ok, JSON.stringify(d));
check("one email went out", sent.length === 1);
const mail = sent[0] || {};
check("addressed to the configured inbox, not a request field",
  JSON.stringify(mail.to) === JSON.stringify(["kiko@neotype.au"]), JSON.stringify(mail.to));
const code = (mail.text || "").match(/\b(\d{6})\b/)?.[1];
check("the email carries a six-digit code", !!code, mail.subject);
check("the reply masks the address", /^k•••@neotype\.au$/.test(d.sentTo || ""), d.sentTo);
check("the plain code is NOT in KV", ![...kv.values()].some(v => String(v).includes(code)));
check("a hash of it is", String(kv.get("admin:code")).length > 60);

console.log("\nThe code cannot be redirected");
sent = [];
kv.delete("admin:code:gap");
r = await post("admin-code", { email: "attacker@evil.example", to: "attacker@evil.example" });
check("a caller-supplied address is ignored",
  JSON.stringify((sent[0] || {}).to) === JSON.stringify(["kiko@neotype.au"]), JSON.stringify((sent[0] || {}).to));
const code2 = (sent[0].text || "").match(/\b(\d{6})\b/)[1];

console.log("\nGuessing");
for (let i = 1; i <= 4; i++) {
  const wrong = String((Number(code2) + i) % 1000000).padStart(6, "0");
  r = await post("admin-code/verify", { code: wrong });
  check(`wrong guess ${i} is refused`, r.status === 401 || r.status === 429);
}
r = await post("admin-code/verify", { code: String((Number(code2) + 5) % 1000000).padStart(6, "0") });
check("the fifth wrong guess kills the code", r.status === 429, String(r.status));
check("the dead code is gone from KV", !kv.has("admin:code"));
r = await post("admin-code/verify", { code: code2 });
check("even the RIGHT code is refused once burned", r.status !== 200 || !(await r.clone().json()).token);

console.log("\nRedeeming a fresh code");
sent = [];
kv.delete("admin:code:gap");
await post("admin-code");
const code3 = (sent[0].text || "").match(/\b(\d{6})\b/)[1];
r = await post("admin-code/verify", { code: code3 });
d = await r.json();
const token = d.token;
check("a correct code returns a token", r.status === 200 && /^[a-f0-9]{64}$/.test(token || ""), JSON.stringify(d));
check("the token opens /verify", (await post("verify", undefined, { "x-admin-token": token })).status === 200);
check("it also opens a real admin route", (await call("orders", { headers: { "x-admin-token": token } })).status === 200);
check("the used code is single-use", (await post("admin-code/verify", { code: code3 })).status !== 200);

console.log("\nRate limiting");
r = await post("admin-code");
check("a second send inside the gap is refused", r.status === 429, String(r.status));

console.log("\nSigning out");
r = await post("admin-signout", undefined, { "x-admin-token": token });
check("sign-out succeeds", r.status === 200);
check("the token is dead server-side, not just locally",
  (await post("verify", undefined, { "x-admin-token": token })).status === 401);

console.log("\nMalformed tokens never reach KV lookups");
for (const bad of ["", "short", "A".repeat(64), "../admin:code", "z".repeat(64), "a".repeat(63), "a".repeat(65)]) {
  check(`rejected: ${JSON.stringify(bad.slice(0, 18))}`,
    (await post("verify", undefined, { "x-admin-token": bad })).status === 401);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
