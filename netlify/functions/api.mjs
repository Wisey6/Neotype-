/* ==========================================================================
   Neotype API — one Netlify Function serving four routes:

     GET  /api/pricing   → current price list (the site reads this)
     POST /api/pricing   → save prices from the admin page (password guarded)
     POST /api/verify    → check the admin password (login)
     POST /api/checkout  → validate options, price them SERVER-SIDE, and create
                           a Stripe Checkout Session

   All pricing maths and every allowed option live in assets/js/pricing-core.js,
   which the browser loads too — so the price a customer sees is the price this
   function charges. Do not re-implement any of it here.

   Prices live in Netlify Blobs so the owner can change them from /admin with no
   redeploy. If blobs are empty, the core's defaults are used.

   Environment variables (Netlify → Site settings → Environment variables):
     STRIPE_SECRET_KEY   Stripe secret key (sk_test_… then sk_live_…)
     ADMIN_PASSWORD      password for the pricing admin page

   Stripe's return pages use the origin the request actually arrived on, so
   deploy previews return to the preview URL and production returns to
   neotype.au. Nothing to configure.
   ========================================================================== */
import { getStore } from "@netlify/blobs";
import pricing from "../../assets/js/pricing-core.js";

const { DEFAULT_PRICING, LF_META, priceStickers, priceLargeFormat } = pricing;

// ---- price store ----------------------------------------------------------
async function getPricing() {
  try {
    const store = getStore("neotype-pricing");
    const stored = await store.get("pricing", { type: "json" });
    if (stored) return stored;
  } catch (_) { /* blobs unavailable → fall back to defaults */ }
  return DEFAULT_PRICING;
}

// ---- helpers --------------------------------------------------------------
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

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

function authorised(request) {
  const pass = request.headers.get("x-admin-password") || "";
  const expected = process.env.ADMIN_PASSWORD || "";
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

export default async (request) => {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const method = request.method;

  // --- pricing read (public — the site needs it to show prices) ---
  if (route === "pricing" && method === "GET") return json(await getPricing());

  // --- admin login ---
  if (route === "verify" && method === "POST") {
    if (!authorised(request)) return json({ error: "Unauthorized" }, 401);
    return json({ ok: true });
  }

  // --- pricing write (admin) ---
  if (route === "pricing" && method === "POST") {
    if (!authorised(request)) return json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
    const clean = sanitizePricing(body);
    try {
      const store = getStore("neotype-pricing");
      await store.setJSON("pricing", clean);
    } catch {
      return json({ error: "Price storage unavailable" }, 500);
    }
    return json({ ok: true, pricing: clean });
  }

  // --- checkout ---
  if (route === "checkout" && method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }

    const table = await getPricing();
    const product = String(body.product || "stickers");
    const quote = product === "stickers" ? priceStickers(body, table)
      : (product === "banner" || product === "corflute") ? priceLargeFormat(product, body, table)
      : null;
    // null means the options aren't ones the shop offers (bad size, a quantity
    // that isn't on the page, an unknown finish) — never price those.
    if (!quote) return json({ error: "Invalid options" }, 400);

    const secret = process.env.STRIPE_SECRET_KEY;
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

export const config = { path: ["/api/pricing", "/api/verify", "/api/checkout"] };
