/* ==========================================================================
   Neotype checkout + pricing Worker.

   - POST /create-checkout : validates options, prices them SERVER-SIDE using
     the current price list, and creates a Stripe Checkout Session.
   - GET  /pricing         : returns the current price list (site reads this).
   - POST /pricing         : admin.html saves an updated price list here
                             (guarded by the ADMIN_PASSWORD secret).

   Prices live in Cloudflare KV (binding PRICING_KV) so the client can change
   them from the admin page with no redeploy. If KV is empty/unbound the
   DEFAULT_PRICING below is used. Deploy + KV setup: see worker/README.md
   ========================================================================== */

// ---- default price list (used until the admin saves an override) ----------
const DEFAULT_PRICING = {
  stickers: {
    min: 18,
    rate: { base: 85, extra: 120, decay: 0.5 },
    finish: { "vinyl-matte": 1.00, "vinyl-gloss": 1.05, "holographic": 1.50, "glitter": 1.45, "chrome": 1.60, "clear": 1.15 },
    shape: { die: 1.00, kiss: 1.02, circle: 0.97, square: 0.95, rect: 0.96, rounded: 0.97, sheet: 1.10 },
  },
  banner: {
    rate: 29, min: 35,
    material: { "vinyl-440": 1.00, "mesh": 1.12 },
    finishing: { "hem-eyelets": 1.00, "trim-eyelets": 0.95, "trim": 0.90, "pole": 1.06 },
  },
  corflute: {
    rate: 58, min: 30,
    thickness: { "3mm": 1.00, "5mm": 1.18 },
    sides: { single: 1.00, double: 1.65 },
    eyelets: { none: 1.00, corners: 1.05 },
  },
};

// labels + validation ranges (NOT editable from admin — only numbers are)
const FINISH_LABEL = { "vinyl-matte": "Vinyl · matte", "vinyl-gloss": "Vinyl · gloss", "holographic": "Holographic", "glitter": "Glitter", "chrome": "Chrome", "clear": "Clear" };
const SHAPE_LABEL = { die: "Die-cut", kiss: "Kiss-cut", circle: "Circle", square: "Square", rect: "Rectangle", rounded: "Rounded", sheet: "Sheet" };
const SIZES = [2, 3, 4, 5];
const QTYS = [15, 50, 100, 200, 300, 500, 1000];
const LF_META = {
  banner: { label: "Banner", wRange: [0.3, 6], hRange: [0.3, 3], qtyMax: 500,
    groups: { material: { "vinyl-440": "440gsm PVC", "mesh": "Mesh" }, finishing: { "hem-eyelets": "Hemmed + eyelets", "trim-eyelets": "Trimmed + eyelets", "trim": "Trimmed to size", "pole": "Pole pockets" } } },
  corflute: { label: "Corflute sign", wRange: [0.3, 2.4], hRange: [0.3, 1.2], qtyMax: 500,
    groups: { thickness: { "3mm": "3 mm", "5mm": "5 mm" }, sides: { single: "Single-sided", double: "Double-sided" }, eyelets: { none: "None", corners: "4 corner eyelets" } } },
};

// ---- pricing store --------------------------------------------------------
function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
async function getPricing(env) {
  let stored = null;
  try { if (env.PRICING_KV) { const raw = await env.PRICING_KV.get("pricing"); if (raw) stored = JSON.parse(raw); } } catch (_) {}
  return stored || DEFAULT_PRICING;
}
function pMult(store, product, group, key, fallback) {
  const g = store[product] && store[product][group];
  return g && typeof g[key] === "number" ? g[key] : fallback;
}

const areaM2 = (sizeIn) => { const m = sizeIn * 0.0254; return m * m; };
const lfQtyMult = (q) => 0.6 + 0.4 * Math.exp(-(q - 1) / 20);

function priceStickers(b, store) {
  const finish = String(b.finish || ""), shape = String(b.shape || "");
  const size = parseInt(b.size, 10), qty = parseInt(b.qty, 10);
  if (!FINISH_LABEL[finish] || !SHAPE_LABEL[shape] || SIZES.indexOf(size) === -1 || QTYS.indexOf(qty) === -1) return null;
  const S = store.stickers || DEFAULT_PRICING.stickers;
  const rate = num(S.rate && S.rate.base, 85) + num(S.rate && S.rate.extra, 120) * Math.exp(-(areaM2(size) * qty) / num(S.rate && S.rate.decay, 0.5));
  const fMult = pMult(store, "stickers", "finish", finish, DEFAULT_PRICING.stickers.finish[finish]);
  const shMult = pMult(store, "stickers", "shape", shape, DEFAULT_PRICING.stickers.shape[shape]);
  const total = Math.max(num(S.min, 18), areaM2(size) * qty * rate * fMult * shMult);
  return {
    amount: Math.round(total * 100),
    name: "Neotype " + SHAPE_LABEL[shape] + " sticker · " + size + "″ · " + FINISH_LABEL[finish],
    desc: qty + " stickers · " + size + "×" + size + " in",
    meta: { product: "stickers", finish: FINISH_LABEL[finish], shape: SHAPE_LABEL[shape], size: size + " in",
      quantity: String(qty), background: str(b.background, 60), cut_colour: str(b.cutColour, 40) },
  };
}

function priceLargeFormat(product, b, store) {
  const meta = LF_META[product];
  if (!meta) return null;
  const w = parseFloat(b.w), h = parseFloat(b.h), qty = parseInt(b.qty, 10);
  if (!(w >= meta.wRange[0] && w <= meta.wRange[1]) || !(h >= meta.hRange[0] && h <= meta.hRange[1])) return null;
  if (!(qty >= 1 && qty <= meta.qtyMax)) return null;
  let mult = 1; const metaChoices = {};
  for (const group in meta.groups) {
    const picked = String(b[group] || "");
    if (!meta.groups[group][picked]) return null;
    mult *= pMult(store, product, group, picked, (DEFAULT_PRICING[product][group] || {})[picked] || 1);
    metaChoices[group] = meta.groups[group][picked];
  }
  const P = store[product] || DEFAULT_PRICING[product];
  const total = Math.max(num(P.min, DEFAULT_PRICING[product].min), w * h * num(P.rate, DEFAULT_PRICING[product].rate) * mult * qty * lfQtyMult(qty));
  const dims = w.toFixed(2) + " × " + h.toFixed(2) + " m";
  return { amount: Math.round(total * 100), name: "Neotype " + meta.label + " · " + dims,
    desc: qty + " × " + meta.label + " · " + dims, meta: Object.assign({ product: product, size: dims, quantity: String(qty) }, metaChoices) };
}

// ---- helpers --------------------------------------------------------------
function str(v, n) { return typeof v === "string" ? v.slice(0, n) : ""; }
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.indexOf(origin) !== -1;
  return { "Access-Control-Allow-Origin": ok ? origin : (allowed[0] || "*"),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password", "Vary": "Origin" };
}
function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}) });
}

// only numeric values are accepted into the stored price list (no code/keys added)
function sanitizePricing(input) {
  const out = JSON.parse(JSON.stringify(DEFAULT_PRICING));
  function copyNums(dst, src) {
    for (const k in dst) {
      if (typeof dst[k] === "number") { if (src && typeof src[k] === "number" && isFinite(src[k]) && src[k] >= 0) dst[k] = src[k]; }
      else if (dst[k] && typeof dst[k] === "object") copyNums(dst[k], src ? src[k] : null);
    }
  }
  copyNums(out, input);
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    // --- pricing read ---
    if (path.endsWith("/pricing") && request.method === "GET") {
      return json(await getPricing(env), 200, cors);
    }
    // --- pricing write (admin) ---
    if (path.endsWith("/pricing") && request.method === "POST") {
      const pass = request.headers.get("X-Admin-Password") || "";
      if (!env.ADMIN_PASSWORD || pass !== env.ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401, cors);
      if (!env.PRICING_KV) return json({ error: "Pricing store not configured" }, 500, cors);
      let body; try { body = await request.json(); } catch (_) { return json({ error: "Bad request" }, 400, cors); }
      const clean = sanitizePricing(body);
      await env.PRICING_KV.put("pricing", JSON.stringify(clean));
      return json({ ok: true, pricing: clean }, 200, cors);
    }

    // --- checkout ---
    if (path.endsWith("/create-checkout") && request.method === "POST") {
      let body; try { body = await request.json(); } catch (_) { return json({ error: "Bad request" }, 400, cors); }
      const store = await getPricing(env);
      const product = String(body.product || "stickers");
      let line = null;
      if (product === "stickers") line = priceStickers(body, store);
      else if (product === "banner" || product === "corflute") line = priceLargeFormat(product, body, store);
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
      if (/^https:\/\//.test(artwork) && !/\.svg(\?|$)/i.test(artwork)) p.append("line_items[0][price_data][product_data][images][0]", artwork);
      Object.keys(line.meta).forEach((k) => { p.append("metadata[" + k + "]", line.meta[k]); p.append("payment_intent_data[metadata][" + k + "]", line.meta[k]); });

      let session;
      try {
        const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST", headers: { "Authorization": "Bearer " + env.STRIPE_SECRET_KEY, "Content-Type": "application/x-www-form-urlencoded" }, body: p,
        });
        session = await res.json();
        if (!res.ok) return json({ error: (session.error && session.error.message) || "Stripe error" }, 502, cors);
      } catch (e) { return json({ error: "Payment service unavailable" }, 502, cors); }
      return json({ url: session.url, amount: line.amount, currency: "aud" }, 200, cors);
    }

    return json({ error: "Not found" }, 404, cors);
  },
};
