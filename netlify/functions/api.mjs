/* ==========================================================================
   Neotype API — one Netlify Function serving three routes:

     GET  /api/pricing   → current price list (the site reads this)
     POST /api/pricing   → save prices from the admin page (password guarded)
     POST /api/verify    → check the admin password (login)
     POST /api/checkout  → validate options, price them SERVER-SIDE, and create
                           a Stripe Checkout Session

   Prices live in Netlify Blobs so the owner can change them from /admin with no
   redeploy. If blobs are empty, DEFAULT_PRICING below is used.

   Environment variables (set in Netlify → Site settings → Environment variables):
     STRIPE_SECRET_KEY   Stripe secret key (sk_test_… then sk_live_…)
     ADMIN_PASSWORD      password for the pricing admin page

   Stripe's return pages use the origin the request actually arrived on, so
   deploy previews return to the preview URL and production returns to
   neotype.au. Nothing to configure.
   ========================================================================== */
import { getStore } from "@netlify/blobs";

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

// labels + ranges (fixed — only numbers are editable from the admin)
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

// ---- price store ----------------------------------------------------------
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

async function getPricing() {
  try {
    const store = getStore("neotype-pricing");
    const stored = await store.get("pricing", { type: "json" });
    if (stored) return stored;
  } catch (_) { /* blobs unavailable → fall back */ }
  return DEFAULT_PRICING;
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
  if (!FINISH_LABEL[finish] || !SHAPE_LABEL[shape] || !SIZES.includes(size) || !QTYS.includes(qty)) return null;
  const S = store.stickers || DEFAULT_PRICING.stickers;
  const area = areaM2(size) * qty;
  const rate = num(S.rate?.base, 85) + num(S.rate?.extra, 120) * Math.exp(-area / num(S.rate?.decay, 0.5));
  const fMult = pMult(store, "stickers", "finish", finish, DEFAULT_PRICING.stickers.finish[finish]);
  const shMult = pMult(store, "stickers", "shape", shape, DEFAULT_PRICING.stickers.shape[shape]);
  const total = Math.max(num(S.min, 18), area * rate * fMult * shMult);
  return {
    amount: Math.round(total * 100),
    name: `Neotype ${SHAPE_LABEL[shape]} sticker · ${size}″ · ${FINISH_LABEL[finish]}`,
    desc: `${qty} stickers · ${size}×${size} in`,
    meta: { product: "stickers", finish: FINISH_LABEL[finish], shape: SHAPE_LABEL[shape],
      size: `${size} in`, quantity: String(qty), background: str(b.background, 60), cut_colour: str(b.cutColour, 40) },
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
    mult *= pMult(store, product, group, picked, (DEFAULT_PRICING[product][group] || {})[picked] ?? 1);
    metaChoices[group] = meta.groups[group][picked];
  }
  const P = store[product] || DEFAULT_PRICING[product];
  const total = Math.max(num(P.min, DEFAULT_PRICING[product].min),
    w * h * num(P.rate, DEFAULT_PRICING[product].rate) * mult * qty * lfQtyMult(qty));
  const dims = `${w.toFixed(2)} × ${h.toFixed(2)} m`;
  return { amount: Math.round(total * 100), name: `Neotype ${meta.label} · ${dims}`,
    desc: `${qty} × ${meta.label} · ${dims}`, meta: { product, size: dims, quantity: String(qty), ...metaChoices } };
}

// ---- helpers --------------------------------------------------------------
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// only numeric values are accepted into the stored price list
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

export default async (request) => {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const method = request.method;

  // --- pricing read (public) ---
  if (route === "pricing" && method === "GET") return json(await getPricing());

  // --- admin login ---
  if (route === "verify" && method === "POST") {
    const pass = request.headers.get("x-admin-password") || "";
    const expected = process.env.ADMIN_PASSWORD || "";
    if (!expected || pass !== expected) return json({ error: "Unauthorized" }, 401);
    return json({ ok: true });
  }

  // --- pricing write (admin) ---
  if (route === "pricing" && method === "POST") {
    const pass = request.headers.get("x-admin-password") || "";
    const expected = process.env.ADMIN_PASSWORD || "";
    if (!expected || pass !== expected) return json({ error: "Unauthorized" }, 401);
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
    const store = await getPricing();
    const product = String(body.product || "stickers");
    const line = product === "stickers" ? priceStickers(body, store)
      : (product === "banner" || product === "corflute") ? priceLargeFormat(product, body, store)
      : null;
    if (!line) return json({ error: "Invalid options" }, 400);

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return json({ error: "Payments aren't switched on yet" }, 503);

    const artwork = str(body.artwork, 480);
    line.meta.artwork = artwork || str(body.artworkName, 200) || "none supplied";

    // return to whichever host served this request (production or a preview)
    const site = url.origin.replace(/\/$/, "");
    const p = new URLSearchParams();
    p.append("mode", "payment");
    p.append("success_url", `${site}/success.html?status=paid&session_id={CHECKOUT_SESSION_ID}`);
    p.append("cancel_url", `${site}/customizer.html`);
    p.append("billing_address_collection", "auto");
    p.append("phone_number_collection[enabled]", "true");
    ["AU", "NZ", "US", "GB", "CA"].forEach((c, i) => p.append(`shipping_address_collection[allowed_countries][${i}]`, c));
    p.append("line_items[0][quantity]", "1");
    p.append("line_items[0][price_data][currency]", "aud");
    p.append("line_items[0][price_data][unit_amount]", String(line.amount));
    p.append("line_items[0][price_data][product_data][name]", line.name);
    p.append("line_items[0][price_data][product_data][description]", line.desc);
    if (/^https:\/\//.test(artwork) && !/\.svg(\?|$)/i.test(artwork)) {
      p.append("line_items[0][price_data][product_data][images][0]", artwork);
    }
    for (const k of Object.keys(line.meta)) {
      p.append(`metadata[${k}]`, line.meta[k]);
      p.append(`payment_intent_data[metadata][${k}]`, line.meta[k]);
    }

    try {
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
        body: p,
      });
      const session = await res.json();
      if (!res.ok) return json({ error: session.error?.message || "Stripe error" }, 502);
      return json({ url: session.url, amount: line.amount, currency: "aud" });
    } catch {
      return json({ error: "Payment service unavailable" }, 502);
    }
  }

  return json({ error: "Not found" }, 404);
};

export const config = { path: ["/api/pricing", "/api/verify", "/api/checkout"] };
