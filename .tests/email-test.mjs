import crypto from "node:crypto";
const mod = await import("../functions/api/[[route]].js");
const SECRET = "whsec_testsecret";
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  return { ok: true, status: 200, text: async () => "" };
};
const kv = new Map();
const env = {
  RESEND_API_KEY: "re_stub",
  ENQUIRY_FROM: "Neotype orders <orders@neotype.au>",
  ENQUIRY_TO: "kiko@neotype.au",
  STRIPE_WEBHOOK_SECRET: SECRET,
  NEOTYPE: {
    get: async k => kv.get(k) ?? null,
    put: async (k, v) => void kv.set(k, v),
    list: async () => ({ keys: [] }),
    getWithMetadata: async () => null,
  },
};
const session = {
  id: "cs_test_customeremail01", created: Math.floor(Date.now()/1000),
  status: "complete", payment_status: "paid",
  amount_total: 8700, currency: "aud",
  customer_details: { email: "tyler@wise-ai.au", name: "Tyler Wise", phone: "" },
  metadata: { product: "stickers", quantity: "100", size: "75mm", finish: "Gloss", shape: "Die-cut", turnaround: "Standard · 4 days" },
};
const body = JSON.stringify({ type: "checkout.session.completed", data: { object: session } });
const t = Math.floor(Date.now()/1000);
const sig = crypto.createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
const req = new Request("https://neotype.au/api/stripe-webhook", {
  method: "POST", body,
  headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" },
});
const res = await mod.onRequest({ request: req, env, params: { route: ["stripe-webhook"] } });
console.log("webhook:", res.status, await res.text());
console.log("\nemails sent:", sent.length);
for (const m of sent) {
  console.log("---");
  console.log("  from    :", m.from);
  console.log("  to      :", JSON.stringify(m.to));
  console.log("  reply_to:", m.reply_to);
  console.log("  subject :", m.subject);
  console.log("  has text:", !!m.text);
}
// de-dup: replay the same event
sent.length = 0;
const res2 = await mod.onRequest({ request: new Request("https://neotype.au/api/stripe-webhook", {
  method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" } }), env, params: { route: ["stripe-webhook"] } });
console.log("\nreplay:", res2.status, "-> emails sent on replay:", sent.length, sent.length === 0 ? "(de-dup OK)" : "(DUPLICATE!)");
