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
     POST /api/stripe-webhook → Stripe reports a paid order (signature verified)
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
     Secret        STRIPE_WEBHOOK_SECRET  whsec_… from the Stripe webhook endpoint
     Secret        RESEND_API_KEY     optional — emails enquiries to ENQUIRY_TO
     Plain var     ENQUIRY_TO         where enquiries and orders go, AND the
                                        address customers reply to. MUST be a
                                        real, monitored mailbox — see below.
     Plain var     ENQUIRY_FROM       verified Resend sender (neotype.au — see note below)

   ENQUIRY_TO does two jobs: it is the recipient of every enquiry and order
   notification, and it is the Reply-To on the customer's confirmation. Both
   break the same way if it names an address that does not exist as a mailbox.

   That happened on 19 Aug 2026: the variable held order@neotype.au, which
   Microsoft 365 rejects with 550 5.1.10 RESOLVER.ADR.RecipientNotFound. Order
   notifications bounced for as long as it was set that way, and the bounce goes
   to the sending domain rather than to anyone watching, so nothing surfaced it —
   orders kept reaching KV and /admin exactly as normal. It was only found when
   somebody replied to a customer confirmation and read the NDR.

   Sending does not require the mailbox to exist. Resend verifies the DOMAIN, so
   any local part on neotype.au authenticates and leaves successfully. The
   address only fails on the way back. Verifying that mail sends therefore proves
   nothing about whether it can be received or replied to — those need a real
   mailbox or alias in Microsoft 365, and a test that actually replies.

   Mail is sent from neotype.au, verified in Resend on the client's own account
   (DKIM at resend._domainkey, SPF and MX on the send subdomain, all in
   Cloudflare DNS since the nameserver move). Nothing here uses any other domain.

   The fallbacks above are deliberately a VERIFIED sender. If ENQUIRY_FROM is
   ever unset, Resend rejects mail from an unverified sender and order emails
   stop with no error anywhere the shop can see — orders still reach KV and
   /admin, so the loss is silent. Never point a fallback at a domain that is not
   verified in the Resend dashboard.

   Both send paths mail ENQUIRY_TO and nothing else; the customer's confirmation
   is success.html, not an email. Both set reply_to so each side can reply without
   looking up an address.

   ENQUIRY_TO should be the orders@neotype.au alias, but the hardcoded fallbacks
   below deliberately stay on kiko@neotype.au: that is a real mailbox rather than
   an alias, and an alias can be removed by an admin without anyone touching this
   repo. A fallback should be the address most likely to still exist. The
   customer's confirmation is success.html, not an email. Both set reply_to to
   the customer, so Ian hits Reply and it leaves from his own mailbox.

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
      if (!res.ok) console.error("resend enquiry failed", res.status, await res.text());
    } catch (err) { console.error("resend enquiry threw", err && err.message); }
  }

  // Only a total failure is worth telling the customer about.
  if (!stored && !emailed) return json({ error: "Couldn't send that — please email support@neotype.au." }, 502);
  return json({ ok: true });
}

// ---- orders ----------------------------------------------------------------
/* Orders are recorded from TWO independent paths, because either one alone
   loses orders:

     1. POST /api/stripe-webhook — Stripe tells us, server to server. This is
        the reliable path: it fires even if the customer pays on a phone and
        closes the tab immediately, which is common enough that a browser-only
        design would quietly drop real orders.
     2. GET /api/order — the success page confirms the payment so it can show a
        genuine receipt, and records the order as a side effect. This is the
        fallback if the webhook secret isn't configured yet.

   Both write the SAME key, so whichever arrives first wins and the second is a
   harmless overwrite rather than a duplicate.

   Stripe remains the source of truth for money. This is Ian's working view. */

// The KV key MUST be a pure function of the session, or the two write paths
// (and a page reload) create duplicate orders instead of overwriting one.
// `s.created` is a fixed Stripe field; never substitute the current time here.
function orderKey(session) {
  const created = new Date((session.created || 0) * 1000).toISOString();
  return `order:${created}:${session.id}`;
}

/* Stripe reports payment across TWO fields and both are needed:
     session.status         open | complete | expired
     session.payment_status paid | unpaid | no_payment_required

   `complete` + `unpaid` is an async method (BECS Direct Debit, bank transfer)
   sitting with the customer's bank — the money is coming and MUST NOT be
   described as "not charged". `open` means they never finished; nothing charged.

   Reading payment_status alone conflates those two, which is how the success page
   came to tell an async-paying customer to pay again. */
/* Ian's production pipeline, in order. Deliberately four stages, not six: the
   site promises a free proof and no printing until the customer approves, and
   printing sits between "approved" and "shipped" without needing its own click.
   A pipeline nobody keeps current is worse than no pipeline. */
const ORDER_STAGES = ["new", "proof", "approved", "shipped"];

function paymentState(s) {
  if (s.payment_status === "paid" || s.payment_status === "no_payment_required") return "paid";
  if (s.status === "complete") return "pending";
  return "incomplete";
}

function toOrder(s, status) {
  const m = s.metadata || {};
  return {
    status: status || paymentState(s),   // "paid" | "pending" | "failed"
    // A short reference the customer can quote. Strip non-alphanumerics first,
    // or a short session id leaks part of its "cs_test_" prefix into the ref.
    ref: String(s.id).replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase(),
    session: s.id,
    when: new Date((s.created || 0) * 1000).toISOString(),
    amount: s.amount_total,
    currency: (s.currency || "aud").toUpperCase(),
    email: (s.customer_details && s.customer_details.email) || "",
    name: (s.customer_details && s.customer_details.name) || "",
    phone: (s.customer_details && s.customer_details.phone) || "",
    product: m.product || "", size: m.size || "", quantity: m.quantity || "",
    finish: m.finish || "", shape: m.shape || "", turnaround: m.turnaround || "",
    area_m2: m.area_m2 || "", artwork: m.artwork || "",
    source: "stripe",
  };
}

/* Orders that didn't come through the website — phone, walk-in, an invoice Ian
   raised himself. Ian types them in so the dashboard reflects the whole business
   and not just the online slice. Stored with the same shape so every view,
   chart and pipeline column treats them identically. */
async function createManualOrder(env, body) {
  if (!env.NEOTYPE) return { error: "Storage unavailable", code: 500 };
  const amount = Math.round(Number(body.amount) * 100);
  if (!isFinite(amount) || amount < 0) return { error: "Enter a valid amount", code: 400 };
  const name = str(body.name, 120).trim();
  if (!name) return { error: "Enter a customer name", code: 400 };

  const when = str(body.when, 40) || new Date().toISOString();
  if (isNaN(new Date(when))) return { error: "Enter a valid date", code: 400 };
  const id = "man_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const turnaround = str(body.turnaround, 40) || "Standard (~4 days)";

  const order = {
    // Manual orders are ones Ian has already been paid for (or is invoicing
    // himself), so they enter as paid — the pipeline is what he tracks here.
    status: "paid",
    stage: ORDER_STAGES.includes(str(body.stage, 20)) ? body.stage : "new",
    ref: id.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase(),
    session: id, when: new Date(when).toISOString(),
    amount: amount, currency: "AUD",
    email: str(body.email, 200).trim(), name: name, phone: str(body.phone, 40).trim(),
    product: str(body.product, 40) || "other", size: str(body.size, 60).trim(),
    quantity: str(body.quantity, 20).trim(), finish: str(body.finish, 60).trim(),
    shape: "", turnaround: turnaround, area_m2: "",
    artwork: /^https?:\/\//.test(body.artwork || "") ? str(body.artwork, 480) : "",
    note: str(body.note, 600).trim(),
    source: "manual",
  };
  await env.NEOTYPE.put(`order:${order.when}:${id}`, JSON.stringify(order));
  return { order: order };
}

// Every write for one session uses the same key, so a status change overwrites
// the record rather than adding a second one.
//
// It MERGES over what's already stored, because the owner's own workflow fields
// (`stage`) live on the same record. A pending → paid transition rebuilding the
// record from the Stripe session alone would silently reset a job Ian had already
// moved to "Approved".
async function saveOrder(env, session, status) {
  if (!env.NEOTYPE) return;
  const key = orderKey(session);
  let existing = null;
  try { existing = await env.NEOTYPE.get(key, { type: "json" }); } catch (_) {}
  const next = toOrder(session, status);
  if (existing && existing.stage) next.stage = existing.stage;
  await env.NEOTYPE.put(key, JSON.stringify(next));
  return next;
}

/* ---- the work-order email ------------------------------------------------
   Stripe's own notification is a payment receipt: it says money arrived, not
   what to print. This is the email Ian actually works from — the spec, the
   customer, when it's due, and a link to the artwork file.

   Two rules it must obey:
     • It can never break a payment. Every failure is swallowed; an order that
       is recorded but unannounced is recoverable, a webhook that 500s because
       an email provider was down is not.
     • It must not send twice. `completed` and `async_payment_succeeded` can
       both fire for one order, so a KV flag marks a session as announced. */
function orderEmailHtml(o, site) {
  const row = (k, v) => v
    ? `<tr><td style="padding:6px 14px 6px 0;color:#6c7f86;font-size:14px">${k}</td>
         <td style="padding:6px 0;font-weight:600;font-size:14px">${escapeHtml(v)}</td></tr>`
    : "";
  const spec = [o.quantity, o.size, o.finish, o.shape].filter(Boolean).join(" · ");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#1b2228">
    <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#04a49f;margin:0 0 4px">New order</p>
    <h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(spec || o.product || "Order")}</h1>
    <p style="font-size:26px;font-weight:700;margin:0 0 18px">$${((o.amount || 0) / 100).toFixed(2)} ${escapeHtml(o.currency || "AUD")}</p>
    <table style="border-collapse:collapse;margin-bottom:20px">
      ${row("Reference", o.ref)}${row("Customer", o.name)}${row("Email", o.email)}
      ${row("Phone", o.phone)}${row("Turnaround", o.turnaround)}
    </table>
    ${/^https?:\/\//.test(o.artwork || "")
      ? `<p style="margin:0 0 18px"><a href="${escapeHtml(o.artwork)}"
           style="background:#04a49f;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">
           Download the artwork</a></p>`
      : `<p style="margin:0 0 18px;color:#b8811d;font-weight:600">⚠ No artwork file — chase the customer for it.</p>`}
    <p style="margin:0 0 6px"><a href="${site}/admin" style="color:#04a49f">Open the dashboard →</a></p>
    <p style="font-size:12px;color:#8ea4ab;margin:18px 0 0">
      Sent by neotype.au when the payment cleared. Stripe holds the money record.</p>
  </div>`;
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- the customer's confirmation -----------------------------------------
   Until now the customer's only confirmation was success.html — fine while they
   still have the tab open, useless the moment they close it, and nothing they
   can forward or search for later. This is the copy of the order that lives in
   their inbox.

   Reply-To is ENQUIRY_TO, the mirror of notifyOrder: Ian's notification replies
   to the customer, the customer's confirmation replies to Ian. Neither side ever
   has to find an address.

   The footer names support@neotype.au as well as inviting a reply. Reply-To is
   built from ENQUIRY_TO, so a single wrong variable turns "just reply to this
   email" into an instruction that bounces the customer — which is what happened
   on 19 Aug, when it pointed at an address with no mailbox. A second, literal
   address means a misconfiguration costs the customer a click rather than the
   ability to reach the shop at all.

   Deliberately promises nothing the shop hasn't already promised on the success
   page — a proof within a business day, and nothing printed before approval. An
   order confirmation is the worst possible place to invent a commitment. */
function customerEmailHtml(o, site) {
  const row = (k, v) => v
    ? `<tr><td style="padding:6px 14px 6px 0;color:#6c7f86;font-size:14px">${k}</td>
         <td style="padding:6px 0;font-weight:600;font-size:14px">${escapeHtml(v)}</td></tr>`
    : "";
  const spec = [o.quantity, o.size, o.finish, o.shape].filter(Boolean).join(" · ");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#1b2228">
    <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#04a49f;margin:0 0 4px">Order received</p>
    <h1 style="font-size:22px;margin:0 0 4px">Thanks${o.name ? ", " + escapeHtml(String(o.name).split(" ")[0]) : ""} — we've got your order.</h1>
    <p style="font-size:15px;color:#42525a;margin:0 0 18px">
      A real person will email your <b style="color:#04a49f">free digital proof</b> shortly,
      usually within a business day. Nothing goes to the press until you approve it.</p>
    <table style="border-collapse:collapse;margin-bottom:20px">
      ${row("Reference", o.ref)}${row("Item", spec || o.product)}
      ${row("Total paid", "$" + ((o.amount || 0) / 100).toFixed(2) + " " + (o.currency || "AUD"))}
      ${row("Turnaround", o.turnaround)}
    </table>
    <p style="font-size:14px;color:#42525a;margin:0 0 6px">
      Reply to this email if anything's wrong or you want to change something —
      or write to <a href="mailto:support@neotype.au" style="color:#04a49f">support@neotype.au</a>.</p>
    <p style="margin:0 0 6px"><a href="${site}" style="color:#04a49f">neotype.au</a></p>
    <p style="font-size:12px;color:#8ea4ab;margin:18px 0 0">
      Neotype Studio · Brisbane · Mon–Fri, 8am–5pm AEST. Your payment receipt comes from Stripe separately.</p>
  </div>`;
}

/* Mail the customer their own copy of the order. Failures are logged and
   swallowed: the shop already has the order, and throwing here would turn a
   missing courtesy email into a failed webhook that Stripe then retries. */
async function confirmCustomer(env, order, site) {
  if (!order || !order.email) return;
  if (!env.RESEND_API_KEY) {
    console.error("confirmCustomer skipped: RESEND_API_KEY is not bound", order.ref || order.session);
    return;
  }
  const flag = `confirmed:${order.session}`;
  try {
    if (env.NEOTYPE && (await env.NEOTYPE.get(flag))) return;
  } catch (_) { /* a duplicate confirmation beats none at all */ }

  const spec = [order.quantity, order.size, order.finish].filter(Boolean).join(" · ");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.ENQUIRY_FROM || "Neotype orders <orders@neotype.au>",
        to: [order.email],
        reply_to: env.ENQUIRY_TO || "kiko@neotype.au",
        subject: `Your Neotype order ${order.ref} — we've got it`,
        html: customerEmailHtml(order, site),
        // a text part materially helps deliverability on a young sending domain
        text: `Thanks — we've got your order.\n\n` +
          `A real person will email your free digital proof shortly, usually within a\n` +
          `business day. Nothing goes to the press until you approve it.\n\n` +
          `Reference: ${order.ref}\n` +
          `Item: ${spec || order.product || ""}\n` +
          `Total paid: $${((order.amount || 0) / 100).toFixed(2)} ${order.currency || "AUD"}\n` +
          (order.turnaround ? `Turnaround: ${order.turnaround}\n` : "") +
          `\nReply to this email if anything's wrong, or write to support@neotype.au\n` +
          `\nNeotype Studio, Brisbane\n`,
      }),
    });
    if (res.ok && env.NEOTYPE) {
      await env.NEOTYPE.put(flag, "1", { expirationTtl: 60 * 60 * 24 * 30 });
    }
    if (!res.ok) console.error("resend customer failed", res.status, await res.text(), order.ref);
  } catch (err) {
    console.error("resend customer threw", err && err.message, order.ref);
  }
}

async function notifyOrder(env, order, site) {
  if (!order) return;
  /* No key means no notification, and the order still lands in KV and /admin —
     so from the shop's side this is indistinguishable from a working system that
     nobody emailed. That is exactly how it went unnoticed once. Say so. */
  if (!env.RESEND_API_KEY) {
    console.error("notifyOrder skipped: RESEND_API_KEY is not bound", order.ref || order.session);
    return;
  }
  // don't announce the same order twice
  const flag = `notified:${order.session}`;
  try {
    if (env.NEOTYPE && (await env.NEOTYPE.get(flag))) return;
  } catch (_) { /* if the check fails, a duplicate is better than a silent miss */ }

  const spec = [order.quantity, order.size, order.finish].filter(Boolean).join(" · ");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.ENQUIRY_FROM || "Neotype orders <orders@neotype.au>",
        to: [env.ENQUIRY_TO || "kiko@neotype.au"],
        reply_to: order.email || undefined,
        subject: `New order ${order.ref} — ${spec || order.product} — $${((order.amount || 0) / 100).toFixed(0)}`,
        html: orderEmailHtml(order, site),
        // HTML-only mail scores worse with Microsoft 365 filters, and this is the
        // one message the business cannot afford to have junked
        text: `New order ${order.ref}\n\n` +
          `Item: ${spec || order.product || ""}\n` +
          `Total: $${((order.amount || 0) / 100).toFixed(2)} ${order.currency || "AUD"}\n` +
          (order.name ? `Customer: ${order.name}\n` : "") +
          (order.email ? `Email: ${order.email}\n` : "") +
          (order.phone ? `Phone: ${order.phone}\n` : "") +
          (order.turnaround ? `Turnaround: ${order.turnaround}\n` : "") +
          (/^https?:\/\//.test(order.artwork || "")
            ? `\nArtwork: ${order.artwork}\n`
            : `\nNo artwork file — chase the customer for it.\n`) +
          `\nDashboard: ${site}/admin\n`,
      }),
    });
    if (res.ok && env.NEOTYPE) {
      // keep the flag well past any retry window, but not forever
      await env.NEOTYPE.put(flag, "1", { expirationTtl: 60 * 60 * 24 * 30 });
    }
    /* A rejected send skips the dedupe flag, so the next event retries it. Log
       the reason too: a 403 from an unverified sender and a 200 look identical
       from outside this function. */
    if (!res.ok) console.error("resend order failed", res.status, await res.text(), order.ref);
  } catch (err) {
    /* an order recorded but unannounced is recoverable; throwing here is not */
    console.error("resend order threw", err && err.message, order.ref);
  }
}

// The success-page URL carries the session id, so it ends up in browser history,
// Referer headers, and anywhere the customer pastes their confirmation link.
// Ian sees the full record in /admin; the public endpoint shows only enough for
// the customer to recognise their own order.
function maskEmail(e) {
  const at = String(e || "").indexOf("@");
  if (at < 1) return "";
  return e[0] + "•••" + e.slice(at);
}
function publicOrder(o) {
  return {
    status: o.status,
    ref: o.ref, when: o.when, amount: o.amount, currency: o.currency,
    email: maskEmail(o.email),
    product: o.product, size: o.size, quantity: o.quantity,
    finish: o.finish, shape: o.shape, turnaround: o.turnaround,
    artwork: o.artwork,
  };
}

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
  const state = paymentState(s);
  // An abandoned checkout is not an order — say so and store nothing.
  if (state === "incomplete") return json({ state: "incomplete", paid: false }, 200);

  // "pending" is recorded too: the customer has committed and their bank is
  // processing, so Ian needs to see it coming.
  const order = toOrder(s, state);
  // a storage failure must not break the customer's confirmation
  try {
    const saved = await saveOrder(env, s, state);
    // Belt and braces: if the webhook secret isn't configured, this is the only
    // path that will ever tell Ian an order came in. notifyOrder de-duplicates,
    // so when the webhook IS live this is a no-op rather than a second email.
    if (state === "paid") {
      await notifyOrder(env, saved, url.origin);
      await confirmCustomer(env, saved, url.origin);
    }
  } catch (_) {}
  // `paid` is kept alongside `state` so an older cached success.html still works
  return json({ state: state, paid: state === "paid", order: publicOrder(order) });
}

/* ---- Stripe webhook ------------------------------------------------------
   Verifies Stripe's signature before trusting the body. Without this check the
   endpoint would let anyone POST fabricated orders into Ian's list.

   Stripe-Signature looks like `t=<unix>,v1=<hex>`; the signed payload is
   `<t>.<raw body>`, HMAC-SHA256 with the endpoint's signing secret. */
async function verifyStripeSig(raw, header, secret) {
  const parts = {};
  String(header || "").split(",").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  if (!parts.t || !parts.v1) return false;

  // reject replays of an old, legitimately-signed event
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts.t}.${raw}`));
  const want = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // constant-time-ish compare: never bail early on the first differing byte
  if (want.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

async function handleWebhook(request, env) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Webhook isn't configured" }, 503);

  const raw = await request.text();
  const ok = await verifyStripeSig(raw, request.headers.get("stripe-signature"), secret);
  if (!ok) return json({ error: "Bad signature" }, 400);

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: "Bad request" }, 400); }

  /* All three checkout.session events matter, and the endpoint subscribes to all
     three. `completed` does NOT mean paid — with an async method the session
     completes while the payment is still with the customer's bank, so without the
     "pending" branch below that order is stored nowhere and Ian never sees it. */
  const s = (event.data && event.data.object) || null;
  let status = null;
  if (s) {
    if (event.type === "checkout.session.completed") {
      status = s.payment_status === "paid" ? "paid" : "pending";
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      status = "paid";              // overwrites the pending record
    } else if (event.type === "checkout.session.async_payment_failed") {
      status = "failed";            // overwrites it too — never silently vanish
    }
  }
  if (status) {
    let saved;
    try { saved = await saveOrder(env, s, status); } catch { return json({ error: "Storage failed" }, 500); }
    // Announce only once the money is real. A pending order isn't work yet, and
    // emailing "new order" for one that later fails would be worse than silence.
    if (status === "paid") {
      const site = new URL(request.url).origin;
      await notifyOrder(env, saved, site);
      await confirmCustomer(env, saved, site);
    }
  }
  // Anything else is acknowledged so Stripe stops retrying it.
  return json({ received: true, recorded: status || null });
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

  // --- Stripe telling us an order was paid (the reliable path) ---
  if (route === "stripe-webhook" && method === "POST") return handleWebhook(request, env);

  // --- inboxes for /admin ---
  // Keys start with an ISO timestamp, so a reverse sort is newest-first.
  if ((route === "enquiries" || route === "orders") && method === "GET") {
    if (!authorised(request, env)) return json({ error: "Unauthorized" }, 401);
    const field = route;
    if (!env.NEOTYPE) return json({ [field]: [] });
    const prefix = route === "orders" ? "order:" : "enquiry:";
    const list = await env.NEOTYPE.list({ prefix });
    const names = list.keys.map((k) => k.name).sort().reverse().slice(0, 100);
    const items = await Promise.all(names.map((n) => env.NEOTYPE.get(n, { type: "json" })));
    // Orders carry their own key so the dashboard can move them along the
    // pipeline without having to reconstruct it (and get it subtly wrong).
    const out = items.map((it, i) => (it && field === "orders" ? Object.assign({ key: names[i] }, it) : it));
    return json({ [field]: out.filter(Boolean) });
  }

  // --- move an order along Ian's pipeline (admin) ---
  if (route === "order-stage" && method === "POST") {
    if (!authorised(request, env)) return json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
    const key = str(body.key, 200);
    const stage = str(body.stage, 20);
    if (!ORDER_STAGES.includes(stage)) return json({ error: "Unknown stage" }, 400);
    // Only ever address a real order key — never an arbitrary KV key.
    // `cs_` is a Stripe session; `man_` is an order Ian typed in himself. A
    // cs_-only pattern here would silently make manual orders unmovable.
    if (!/^order:[0-9TZ.:-]+:(cs|man)_[A-Za-z0-9_]+$/.test(key)) return json({ error: "Unknown order" }, 400);
    if (!env.NEOTYPE) return json({ error: "Storage unavailable" }, 500);
    const rec = await env.NEOTYPE.get(key, { type: "json" });
    if (!rec) return json({ error: "Unknown order" }, 404);
    // An unpaid job must not be walked down the production line.
    if ((rec.status || "paid") !== "paid" && stage !== "new") {
      return json({ error: "That order isn't paid yet" }, 409);
    }
    rec.stage = stage;
    await env.NEOTYPE.put(key, JSON.stringify(rec));
    return json({ ok: true, stage: stage });
  }

  // --- add an order that didn't come through the website (admin) ---
  if (route === "orders" && method === "POST") {
    if (!authorised(request, env)) return json({ error: "Unauthorized" }, 401);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
    const res = await createManualOrder(env, body);
    if (res.error) return json({ error: res.error }, res.code);
    return json({ ok: true, order: res.order });
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
