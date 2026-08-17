/* ==========================================================================
   Neotype API — one Cloudflare Pages Function serving every /api/* route:

     GET  /api/pricing   → current price list (the site reads this)
     POST /api/pricing   → save prices from the admin page (password guarded)
     POST /api/verify    → check the admin password (login)
     POST /api/checkout  → validate options, price them SERVER-SIDE, and create
                           a Stripe Checkout Session
     POST /api/upload    → store the customer's artwork in R2, return its link
     GET  /api/art/:key  → serve a stored artwork file (random unguessable keys)
     GET  /api/order     → confirm a paid session with Stripe and record the order
     GET  /api/orders    → the order list for /admin (password guarded)
     POST /api/enquiry   → contact form: store the enquiry, email Ian
     GET  /api/enquiries → the enquiry inbox for /admin (password guarded)

   All pricing maths and every allowed option live in assets/js/pricing-core.js,
   which the browser loads too — so the price a customer sees is the price this
   function charges. Do not re-implement any of it here.

   Prices live in Workers KV so the owner can change them from /admin with no
   redeploy. If KV is empty or unbound, the core's defaults are used.

   Bindings — all set in the dashboard (Workers & Pages → project → Settings).
   There is no wrangler.toml on purpose: it would lock these out of the UI.
     KV namespace  NEOTYPE      the price store and the enquiry log
     R2 bucket     ART          customers' uploaded artwork
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

// ---- artwork ---------------------------------------------------------------
// The customer's print file is the whole job — without it Ian has a paid order
// and nothing to print. It's stored before checkout and the order carries a link.
// Keys are random so a stored file can't be found by guessing a URL.
//
// Two storage backends, picked automatically:
//   • R2 bucket bound as ART  — preferred, 50 MB ceiling, no expiry
//   • KV (NEOTYPE) otherwise  — works with no paid subscription, but KV caps a
//     value at 25 MB and free storage at 1 GB, so KV-stored artwork expires
//     after 90 days. By then the job is printed; Ian should keep the file with
//     the job, not rely on this as an archive.
// Enabling R2 later needs no code change — bind it and the R2 path takes over.
const ART_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  pdf: "application/pdf", svg: "image/svg+xml", ai: "application/postscript",
};
const ART_MAX_R2 = 50 * 1024 * 1024;
const ART_MAX_KV = 24 * 1024 * 1024;      // KV's hard limit is 25 MB
const ART_TTL_KV = 90 * 24 * 60 * 60;

async function handleUpload(request, env) {
  const useR2 = Boolean(env.ART);
  if (!useR2 && !env.NEOTYPE) return json({ error: "File storage isn't set up yet" }, 503);
  const max = useR2 ? ART_MAX_R2 : ART_MAX_KV;

  let form;
  try { form = await request.formData(); } catch { return json({ error: "Bad request" }, 400); }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "No file supplied" }, 400);
  if (file.size === 0) return json({ error: "That file is empty" }, 400);
  if (file.size > max) {
    return json({ error: `That file is over ${Math.floor(max / 1048576)} MB — please email it to us and we'll set the order up manually.` }, 413);
  }

  const name = str(file.name || "artwork", 120);
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!ART_TYPES[ext]) return json({ error: "Please upload a PNG, JPG, PDF, SVG or AI file." }, 415);

  // An unguessable key, and a readable filename kept for Ian's benefit.
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60);
  const key = `${crypto.randomUUID()}/${safe}`;
  try {
    if (useR2) {
      await env.ART.put(key, file.stream(), { httpMetadata: { contentType: ART_TYPES[ext] } });
    } else {
      await env.NEOTYPE.put(`art:${key}`, await file.arrayBuffer(), {
        metadata: { ct: ART_TYPES[ext] },
        expirationTtl: ART_TTL_KV,
      });
    }
  } catch {
    return json({ error: "Couldn't store that file — please try again" }, 502);
  }
  return json({ url: `${new URL(request.url).origin}/api/art/${key}`, key });
}

function artHeaders(contentType, etag) {
  const h = new Headers();
  if (contentType) h.set("content-type", contentType);
  if (etag) h.set("etag", etag);
  h.set("cache-control", "private, max-age=3600");
  // never let an uploaded SVG or HTML run as a page on our own origin
  h.set("content-disposition", "attachment");
  h.set("x-content-type-options", "nosniff");
  return h;
}

async function serveArt(env, key) {
  if (env.ART) {
    const obj = await env.ART.get(key);
    if (obj) {
      const h = artHeaders(null, obj.httpEtag);
      obj.writeHttpMetadata(h);
      h.set("content-disposition", "attachment");
      h.set("x-content-type-options", "nosniff");
      return new Response(obj.body, { headers: h });
    }
  }
  if (env.NEOTYPE) {
    const res = await env.NEOTYPE.getWithMetadata(`art:${key}`, { type: "arrayBuffer" });
    if (res && res.value) {
      return new Response(res.value, { headers: artHeaders((res.metadata && res.metadata.ct) || "application/octet-stream") });
    }
  }
  return new Response("Not found", { status: 404 });
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

// ---- orders ----------------------------------------------------------------
// There is no Stripe webhook, so the order is recorded when the customer lands
// back on the success page: we ask Stripe whether that session actually paid,
// and only then store it. Two consequences worth being honest about:
//   • The customer's own browser triggers the record, so if they close the tab
//     the instant they pay, nothing is stored. The payment is still in Stripe —
//     that remains the source of truth for money. This is Ian's convenience
//     view, not the ledger.
//   • Because the record is keyed on the session id, a customer reloading the
//     success page updates rather than duplicates the order.
async function handleOrder(request, env) {
  const id = str(new URL(request.url).searchParams.get("session_id"), 100);
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: "Unknown order" }, 400);
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) return json({ error: "Payments aren't switched on yet" }, 503);

  let s;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    s = await res.json();
    if (!res.ok) return json({ error: "Unknown order" }, 404);
  } catch {
    return json({ error: "Couldn't reach the payment service" }, 502);
  }
  if (s.payment_status !== "paid") return json({ paid: false }, 200);

  const m = s.metadata || {};
  const order = {
    // A short reference the customer can quote. Strip non-alphanumerics first,
    // or a short session id leaks part of its "cs_test_" prefix into the ref.
    ref: id.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase(),
    session: id,
    when: new Date((s.created || 0) * 1000).toISOString(),
    amount: s.amount_total,
    currency: (s.currency || "aud").toUpperCase(),
    email: (s.customer_details && s.customer_details.email) || "",
    name: (s.customer_details && s.customer_details.name) || "",
    product: m.product || "", size: m.size || "", quantity: m.quantity || "",
    finish: m.finish || "", shape: m.shape || "", turnaround: m.turnaround || "",
    artwork: m.artwork || "",
  };

  // store for Ian; a failure here must not break the customer's confirmation
  try { if (env.NEOTYPE) await env.NEOTYPE.put(`order:${order.when}:${id}`, JSON.stringify(order)); } catch (_) {}
  return json({ paid: true, order });
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

  // --- artwork in and out ---
  if (route === "upload" && method === "POST") return handleUpload(request, env);
  if (route.startsWith("art/") && method === "GET") return serveArt(env, route.slice(4));

  // --- order confirmation (public: the customer needs it on the success page) ---
  if (route === "order" && method === "GET") return handleOrder(request, env);

  // --- inboxes for /admin ---
  // Keys start with an ISO timestamp, so a reverse sort is newest-first.
  if ((route === "enquiries" || route === "orders") && method === "GET") {
    if (!authorised(request, env)) return json({ error: "Unauthorized" }, 401);
    const field = route;
    if (!env.NEOTYPE) return json({ [field]: [] });
    const prefix = route === "orders" ? "order:" : "enquiry:";
    const list = await env.NEOTYPE.list({ prefix });
    const items = await Promise.all(
      list.keys.map((k) => k.name).sort().reverse().slice(0, 100)
        .map((n) => env.NEOTYPE.get(n, { type: "json" }))
    );
    return json({ [field]: items.filter(Boolean) });
  }

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
