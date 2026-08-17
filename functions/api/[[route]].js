/* ==========================================================================
   Neotype API — one Cloudflare Pages Function serving every /api/* route:

     GET  /api/pricing   → current price list (the site reads this)
     POST /api/pricing   → save prices from the admin page (password guarded)
     POST /api/verify    → check the admin password (login)
     POST /api/checkout  → validate options, price them SERVER-SIDE, and create
                           a Stripe Checkout Session
     POST /api/enquiry   → contact form: store the enquiry, email Ian

   All pricing maths and every allowed option live in assets/js/pricing-core.js,
   which the browser loads too — so the price a customer sees is the price this
   function charges. Do not re-implement any of it here.

   Prices live in Workers KV so the owner can change them from /admin with no
   redeploy. If KV is empty or unbound, the core's defaults are used.

   Bindings (Cloudflare dashboard → Workers & Pages → Settings):
     KV namespace  NEOTYPE      the price store and the enquiry log
     Secret        ADMIN_PASSWORD     password for the pricing admin page
     Secret        STRIPE_SECRET_KEY  Stripe secret key (sk_test_… then sk_live_…)
     Secret        RESEND_API_KEY     optional — emails enquiries to ENQUIRY_TO
     Plain var     ENQUIRY_TO         where enquiries go (default kiko@neotype.au)
     Plain var     ENQUIRY_FROM       verified sender, e.g. site@send.neotype.au

   Stripe's return pages use the origin the request actually arrived on, so
   preview deployments return to the preview URL and production returns to
   neotype.au. Nothing to configure.
   ========================================================================== */
import pricing from "../../assets/js/pricing-core.js";

const { DEFAULT_PRICING, LF_META, priceStickers, priceLargeFormat } = pricing;

// ---- helpers --------------------------------------------------------------
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// ---- price store ----------------------------------------------------------
async function getPricing(env) {
  try {
    if (env.NEOTYPE) {
      const stored = await env.NEOTYPE.get("pricing", { type: "json" });
      if (stored) return stored;
    }
  } catch (_) { /* KV unavailable → fall back to defaults */ }
  return DEFAULT_PRICING;
}

// Only numeric values are accepted into the stored price list, and only at
// paths that already exist in the defaults — so a compromised admin session
// can change a rate but cannot inject new keys or non-numeric values.
function sanitizePricing(input) {
  const out = structuredClone(DEFAULT_PRICING);
  (function copyNums(dst, src) {
    for (const k in dst) {
      if (typeof dst[k] === "number") {
        if (src && typeof src[k] === "number" && isFinite(src[k]) && src[k] >= 0) dst[k] = src[k];
      } else if (dst[k] && typeof dst[k] === "object") copyNums(dst[k], src ? src[k] : null);
    }
  })(out, input);
  return out;
}

function authorised(request, env) {
  const pass = request.headers.get("x-admin-password") || "";
  const expected = env.ADMIN_PASSWORD || "";
  return Boolean(expected) && pass === expected;
}

// Build the Stripe line item from a priced quote.
function describe(product, quote) {
  if (product === "stickers") {
    const L = quote.labels;
    return {
      name: `Neotype ${L.shape} sticker · ${L.size} · ${L.finish}`,
      desc: `${L.quantity} stickers · ${L.size} · ${L.turnaround}`,
    };
  }
  const label = LF_META[product].label;
  return {
    name: `Neotype ${label} · ${quote.dims}`,
    desc: `${quote.labels.quantity} × ${label} · ${quote.dims}`,
  };
}

// ---- enquiries ------------------------------------------------------------
// Stored in KV first, emailed second. If the mail provider is unconfigured or
// down, the enquiry is still saved and still shows in /admin — an enquiry is
// never silently dropped, which is what a lost sale looks like.
async function handleEnquiry(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

  if (str(body.company, 200).trim()) return json({ ok: true });   // honeypot: pretend success

  const name = str(body.name, 120).trim();
  const email = str(body.email, 200).trim();
  const topic = str(body.topic, 80).trim() || "General";
  const message = str(body.message, 4000).trim();
  if (!name || !message || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Please fill in your name, a valid email and a message." }, 400);
  }

  const when = new Date().toISOString();
  const record = { name, email, topic, message, when };

  let stored = false;
  try {
    if (env.NEOTYPE) {
      await env.NEOTYPE.put(`enquiry:${when}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify(record));
      stored = true;
    }
  } catch (_) { /* fall through to email */ }

  let emailed = false;
  if (env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: env.ENQUIRY_FROM || "Neotype site <site@neotype.au>",
          to: [env.ENQUIRY_TO || "kiko@neotype.au"],
          reply_to: email,
          subject: `Neotype enquiry — ${topic} — ${name}`,
          text: `${name} <${email}>\nTopic: ${topic}\nReceived: ${when}\n\n${message}\n`,
        }),
      });
      emailed = res.ok;
    } catch (_) { /* stored anyway */ }
  }

  // Only a total failure is worth telling the customer about.
  if (!stored && !emailed) return json({ error: "Couldn't send that — please email kiko@neotype.au." }, 502);
  return json({ ok: true });
}

// ---- router ---------------------------------------------------------------
export const onRequest = async ({ request, env }) => {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const method = request.method;

  // --- pricing read (public — the site needs it to show prices) ---
  if (route === "pricing" && method === "GET") return json(await getPricing(env));

  // --- contact form ---
  if (route === "enquiry" && method === "POST") return handleEnquiry(request, env);

  // --- admin login ---
  if (route === "verify" && method === "POST") {
    if (!authorised(request, env)) return json({ error: "Unauthorized" }, 401);
    return json({ ok: true });
  }

  // --- pricing write (admin) ---
  if (route === "pricing" && method === "POST") {
    if (!authorised(request, env)) return json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
    const clean = sanitizePricing(body);
    if (!env.NEOTYPE) return json({ error: "Price storage unavailable" }, 500);
    try {
      await env.NEOTYPE.put("pricing", JSON.stringify(clean));
    } catch {
      return json({ error: "Price storage unavailable" }, 500);
    }
    return json({ ok: true, pricing: clean });
  }

  // --- checkout ---
  if (route === "checkout" && method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

    const table = await getPricing(env);
    const product = String(body.product || "stickers");
    const quote = product === "stickers" ? priceStickers(body, table)
      : (product === "banner" || product === "corflute") ? priceLargeFormat(product, body, table)
      : null;
    // null means the options aren't ones the shop offers (bad size, a quantity
    // that isn't on the page, an unknown finish) — never price those.
    if (!quote) return json({ error: "Invalid options" }, 400);

    const secret = env.STRIPE_SECRET_KEY;
    if (!secret) return json({ error: "Payments aren't switched on yet" }, 503);

    const artwork = str(body.artwork, 480);
    const { name, desc } = describe(product, quote);

    // everything Ian needs on the order, including the area he quotes from
    const meta = Object.assign({ product }, quote.labels, {
      area_m2: quote.area.toFixed(3),
      artwork: artwork || str(body.artworkName, 200) || "none supplied",
    });

    // return to whichever host served this request (production or a preview)
    const site = url.origin.replace(/\/$/, "");
    const p = new URLSearchParams();
    p.append("mode", "payment");
    p.append("success_url", `${site}/success.html?status=paid&session_id={CHECKOUT_SESSION_ID}`);
    p.append("cancel_url", `${site}/${product === "stickers" ? "customizer" : product === "banner" ? "banners" : "corflute"}.html`);
    p.append("billing_address_collection", "auto");
    p.append("phone_number_collection[enabled]", "true");
    ["AU", "NZ", "US", "GB", "CA"].forEach((c, i) => p.append(`shipping_address_collection[allowed_countries][${i}]`, c));
    p.append("line_items[0][quantity]", "1");
    p.append("line_items[0][price_data][currency]", "aud");
    p.append("line_items[0][price_data][unit_amount]", String(quote.amount));
    p.append("line_items[0][price_data][product_data][name]", name);
    p.append("line_items[0][price_data][product_data][description]", desc);
    if (/^https:\/\//.test(artwork) && !/\.svg(\?|$)/i.test(artwork)) {
      p.append("line_items[0][price_data][product_data][images][0]", artwork);
    }
    for (const k of Object.keys(meta)) {
      p.append(`metadata[${k}]`, String(meta[k]));
      p.append(`payment_intent_data[metadata][${k}]`, String(meta[k]));
    }

    try {
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
        body: p,
      });
      const session = await res.json();
      if (!res.ok) return json({ error: session.error?.message || "Stripe error" }, 502);
      return json({ url: session.url, amount: quote.amount, currency: "aud" });
    } catch {
      return json({ error: "Payment service unavailable" }, 502);
    }
  }

  return json({ error: "Not found" }, 404);
};
