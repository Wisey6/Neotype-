/* ==========================================================================
   Neotype checkout Worker — creates Stripe Checkout Sessions with a
   SERVER-SIDE price for every product (stickers, banners, corflute). The
   browser sends only the chosen options; this Worker validates them and
   recomputes the price so it can't be tampered with. The Stripe secret key
   never leaves here. Deploy: see worker/README.md

   Pricing constants below MUST match the site:
     stickers  -> assets/js/customizer.js
     banner    -> banners.html   (window.LF_PRODUCT)
     corflute  -> corflute.html  (window.LF_PRODUCT)
   ========================================================================== */

// ---- stickers -------------------------------------------------------------
const FINISH = {
  "vinyl-matte": { mult: 1.00, label: "Vinyl · matte" },
  "vinyl-gloss": { mult: 1.05, label: "Vinyl · gloss" },
  "holographic": { mult: 1.50, label: "Holographic" },
  "glitter":     { mult: 1.45, label: "Glitter" },
  "chrome":      { mult: 1.60, label: "Chrome" },
  "clear":       { mult: 1.15, label: "Clear" },
};
const SHAPE = {
  die: { mult: 1.00, label: "Die-cut" }, kiss: { mult: 1.02, label: "Kiss-cut" },
  circle: { mult: 0.97, label: "Circle" }, square: { mult: 0.95, label: "Square" },
  rect: { mult: 0.96, label: "Rectangle" }, rounded: { mult: 0.97, label: "Rounded" },
  sheet: { mult: 1.10, label: "Sheet" },
};
const SIZES = [2, 3, 4, 5];
const QTYS = [15, 50, 100, 200, 300, 500, 1000];
const STICKER_MIN = 18;
const areaM2 = (sizeIn) => { const m = sizeIn * 0.0254; return m * m; };
const ratePerM2 = (a) => 85 + 120 * Math.exp(-a / 0.5);

function priceStickers(b) {
  const finish = String(b.finish || ""), shape = String(b.shape || "");
  const size = parseInt(b.size, 10), qty = parseInt(b.qty, 10);
  if (!FINISH[finish] || !SHAPE[shape] || SIZES.indexOf(size) === -1 || QTYS.indexOf(qty) === -1) return null;
  const totalArea = areaM2(size) * qty;
  const total = Math.max(STICKER_MIN, totalArea * ratePerM2(totalArea) * FINISH[finish].mult * SHAPE[shape].mult);
  return {
    amount: Math.round(total * 100),
    name: "Neotype " + SHAPE[shape].label + " sticker · " + size + "″ · " + FINISH[finish].label,
    desc: qty + " stickers · " + size + "×" + size + " in",
    meta: { product: "stickers", finish: FINISH[finish].label, shape: SHAPE[shape].label,
      size: size + " in", quantity: String(qty), background: str(b.background, 60), cut_colour: str(b.cutColour, 40) },
  };
}

// ---- large format (banner / corflute) -------------------------------------
// rate = A$/m²; mults multiply; price = w*h*rate*mults*qty (>= min)
const LF = {
  banner: {
    label: "Banner", rate: 29, min: 35, wRange: [0.3, 6], hRange: [0.3, 3], qtyMax: 500,
    choices: {
      material: { label: "Material", opts: { "vinyl-440": { label: "440gsm PVC", mult: 1.00 }, "mesh": { label: "Mesh", mult: 1.12 } } },
      finishing: { label: "Finishing", opts: {
        "hem-eyelets": { label: "Hemmed + eyelets", mult: 1.00 },
        "trim-eyelets": { label: "Trimmed + eyelets", mult: 0.95 },
        "trim": { label: "Trimmed to size", mult: 0.90 },
        "pole": { label: "Pole pockets", mult: 1.06 } } },
    },
  },
  corflute: {
    label: "Corflute sign", rate: 58, min: 30, wRange: [0.3, 2.4], hRange: [0.3, 1.2], qtyMax: 500,
    choices: {
      thickness: { label: "Thickness", opts: { "3mm": { label: "3 mm", mult: 1.00 }, "5mm": { label: "5 mm", mult: 1.18 } } },
      sides: { label: "Print sides", opts: { "single": { label: "Single-sided", mult: 1.00 }, "double": { label: "Double-sided", mult: 1.65 } } },
      eyelets: { label: "Eyelets", opts: { "none": { label: "None", mult: 1.00 }, "corners": { label: "4 corner eyelets", mult: 1.05 } } },
    },
  },
};
const lfQtyMult = (q) => 0.6 + 0.4 * Math.exp(-(q - 1) / 20);

function priceLargeFormat(product, b) {
  const cfg = LF[product];
  if (!cfg) return null;
  const w = parseFloat(b.w), h = parseFloat(b.h), qty = parseInt(b.qty, 10);
  if (!(w >= cfg.wRange[0] && w <= cfg.wRange[1]) || !(h >= cfg.hRange[0] && h <= cfg.hRange[1])) return null;
  if (!(qty >= 1 && qty <= cfg.qtyMax)) return null;
  let mult = 1; const metaChoices = {};
  for (const key in cfg.choices) {
    const picked = String(b[key] || "");
    const opt = cfg.choices[key].opts[picked];
    if (!opt) return null;
    mult *= opt.mult;
    metaChoices[key] = opt.label;
  }
  const total = Math.max(cfg.min, w * h * cfg.rate * mult * qty * lfQtyMult(qty));
  const dims = w.toFixed(2) + " × " + h.toFixed(2) + " m";
  return {
    amount: Math.round(total * 100),
    name: "Neotype " + cfg.label + " · " + dims,
    desc: qty + " × " + cfg.label + " · " + dims,
    meta: Object.assign({ product: product, size: dims, quantity: String(qty) }, metaChoices),
  };
}

// ---- helpers --------------------------------------------------------------
function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.indexOf(origin) !== -1;
  return {
    "Access-Control-Allow-Origin": ok ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin",
  };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) });
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

    const product = String(body.product || "stickers");
    let line = null;
    if (product === "stickers") line = priceStickers(body);
    else if (product === "banner" || product === "corflute") line = priceLargeFormat(product, body);
    if (!line) return json({ error: "Invalid options" }, 400, cors);

    const artwork = str(body.artwork, 480), artworkName = str(body.artworkName, 200);
    line.meta.artwork = artwork || artworkName || "none supplied";

    const p = new URLSearchParams();
    p.append("mode", "payment");
    p.append("success_url", (env.SUCCESS_URL || "") + "?status=paid&session_id={CHECKOUT_SESSION_ID}");
    p.append("cancel_url", env.CANCEL_URL || "");
    p.append("billing_address_collection", "auto");
    p.append("phone_number_collection[enabled]", "true");
    ["AU", "NZ", "US", "GB", "CA"].forEach((c, i) => p.append("shipping_address_collection[allowed_countries][" + i + "]", c));
    p.append("line_items[0][quantity]", "1");
    p.append("line_items[0][price_data][currency]", "aud");
    p.append("line_items[0][price_data][unit_amount]", String(line.amount));
    p.append("line_items[0][price_data][product_data][name]", line.name);
    p.append("line_items[0][price_data][product_data][description]", line.desc);
    if (/^https:\/\//.test(artwork) && !/\.svg(\?|$)/i.test(artwork)) {
      p.append("line_items[0][price_data][product_data][images][0]", artwork);
    }
    Object.keys(line.meta).forEach((k) => {
      p.append("metadata[" + k + "]", line.meta[k]);
      p.append("payment_intent_data[metadata][" + k + "]", line.meta[k]);
    });

    let session;
    try {
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" },
        body: p,
      });
      session = await res.json();
      if (!res.ok) return json({ error: (session.error && session.error.message) || "Stripe error" }, 502, cors);
    } catch (e) {
      return json({ error: "Payment service unavailable" }, 502, cors);
    }
    return json({ url: session.url, amount: line.amount, currency: "aud" }, 200, cors);
  },
};
