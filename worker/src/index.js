/* ==========================================================================
   Neotype checkout Worker — Cloudflare Worker that creates Stripe Checkout
   Sessions with a SERVER-SIDE price. The browser only sends the chosen
   options (finish, shape, size, qty); this Worker validates them against fixed
   allowlists and recomputes the price with the same formula as the site, so a
   customer can't tamper with the amount. The Stripe SECRET key never leaves
   here.

   Deploy: see worker/README.md
   Secrets/vars needed:
     STRIPE_SECRET_KEY  (secret)  – Stripe secret key (sk_live_… / sk_test_…)
     ALLOWED_ORIGIN     (var)     – comma list, e.g. "https://neotype.au"
     SUCCESS_URL        (var)     – e.g. "https://neotype.au/success.html"
     CANCEL_URL         (var)     – e.g. "https://neotype.au/customizer.html"
   ========================================================================== */

// --- pricing (MUST match assets/js/customizer.js) --------------------------
const FINISH = {
  "vinyl-matte": { mult: 1.00, label: "Vinyl · matte" },
  "vinyl-gloss": { mult: 1.05, label: "Vinyl · gloss" },
  "holographic": { mult: 1.50, label: "Holographic" },
  "glitter":     { mult: 1.45, label: "Glitter" },
  "chrome":      { mult: 1.60, label: "Chrome" },
  "clear":       { mult: 1.15, label: "Clear" },
};
const SHAPE = {
  die:     { mult: 1.00, label: "Die-cut" },
  kiss:    { mult: 1.02, label: "Kiss-cut" },
  circle:  { mult: 0.97, label: "Circle" },
  square:  { mult: 0.95, label: "Square" },
  rect:    { mult: 0.96, label: "Rectangle" },
  rounded: { mult: 0.97, label: "Rounded" },
  sheet:   { mult: 1.10, label: "Sheet" },
};
const SIZES = [2, 3, 4, 5];
const QTYS = [15, 50, 100, 200, 300, 500, 1000];
const MIN_ORDER = 18;      // A$ minimum
const CURRENCY = "aud";

const areaM2 = (sizeIn) => { const m = sizeIn * 0.0254; return m * m; };
const ratePerM2 = (a) => 85 + 120 * Math.exp(-a / 0.5);
function orderTotal(size, finish, shape, qty) {
  const totalArea = areaM2(size) * qty;
  const t = totalArea * ratePerM2(totalArea) * FINISH[finish].mult * SHAPE[shape].mult;
  return Math.max(MIN_ORDER, t);
}

// --- helpers ---------------------------------------------------------------
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.indexOf(origin) !== -1;
  return {
    "Access-Control-Allow-Origin": ok ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    const url = new URL(request.url);
    if (!url.pathname.endsWith("/create-checkout")) return json({ error: "Not found" }, 404, cors);

    let body;
    try { body = await request.json(); } catch (_) { return json({ error: "Bad request" }, 400, cors); }

    // validate against allowlists — price is derived only from these
    const finish = String(body.finish || "");
    const shape = String(body.shape || "");
    const size = parseInt(body.size, 10);
    const qty = parseInt(body.qty, 10);
    if (!FINISH[finish] || !SHAPE[shape] || SIZES.indexOf(size) === -1 || QTYS.indexOf(qty) === -1) {
      return json({ error: "Invalid options" }, 400, cors);
    }

    const total = orderTotal(size, finish, shape, qty);
    const amount = Math.round(total * 100); // cents

    const artwork = typeof body.artwork === "string" ? body.artwork.slice(0, 480) : "";
    const artworkName = typeof body.artworkName === "string" ? body.artworkName.slice(0, 200) : "";
    const background = typeof body.background === "string" ? body.background.slice(0, 60) : "";
    const cutColour = typeof body.cutColour === "string" ? body.cutColour.slice(0, 40) : "";

    const name = "Neotype " + SHAPE[shape].label + " sticker · " + size + "″ · " + FINISH[finish].label;
    const desc = qty + " stickers · " + FINISH[finish].label + " · " + SHAPE[shape].label + " · " + size + "×" + size + " in";

    const p = new URLSearchParams();
    p.append("mode", "payment");
    p.append("success_url", (env.SUCCESS_URL || "") + "?status=paid&session_id={CHECKOUT_SESSION_ID}");
    p.append("cancel_url", env.CANCEL_URL || "");
    p.append("billing_address_collection", "auto");
    p.append("phone_number_collection[enabled]", "true");
    ["AU", "NZ", "US", "GB", "CA"].forEach((c, i) => p.append("shipping_address_collection[allowed_countries][" + i + "]", c));

    p.append("line_items[0][quantity]", "1");
    p.append("line_items[0][price_data][currency]", CURRENCY);
    p.append("line_items[0][price_data][unit_amount]", String(amount));
    p.append("line_items[0][price_data][product_data][name]", name);
    p.append("line_items[0][price_data][product_data][description]", desc);
    // show the artwork on the Stripe page when it's a raster image URL
    if (/^https:\/\//.test(artwork) && !/\.svg(\?|$)/i.test(artwork)) {
      p.append("line_items[0][price_data][product_data][images][0]", artwork);
    }

    const meta = { finish: FINISH[finish].label, shape: SHAPE[shape].label, size: size + " in",
      quantity: String(qty), background: background, cut_colour: cutColour,
      artwork: artwork || artworkName || "none supplied" };
    Object.keys(meta).forEach((k) => { p.append("metadata[" + k + "]", meta[k]); p.append("payment_intent_data[metadata][" + k + "]", meta[k]); });

    let session;
    try {
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: p,
      });
      session = await res.json();
      if (!res.ok) {
        return json({ error: (session.error && session.error.message) || "Stripe error" }, 502, cors);
      }
    } catch (e) {
      return json({ error: "Payment service unavailable" }, 502, cors);
    }

    return json({ url: session.url, amount: amount, currency: CURRENCY }, 200, cors);
  },
};
