# Start here

**You are Claude, opened in a fresh copy of this repository, and someone has
asked you to "make sure it all works and is up and running".**

Read this before doing anything. The most important fact is the one that is not
visible from the files:

> ## This repository is not connected to anything yet
>
> The live shop at **https://www.neotype.au** is served by a Cloudflare Pages
> project bound to a *different* Git repository. Pushing to this one changes
> nothing on the internet. Nothing you do here can break the live site, and
> nothing you do here reaches it either, until a Pages project is pointed at
> this repository.
>
> That is the actual job. It is not a deploy — it is an adoption.

---

## What this is

A static storefront and owner dashboard for **Neotype Studio**, a sticker,
banner and corflute printer in Brisbane. Six public pages, one owner dashboard
at `/admin`, and a single Cloudflare Pages Function that does pricing, checkout,
artwork upload, order recording and email.

- **No build step.** No bundler, no framework, no dependencies. `git push` is
  the deploy. `package.json` declares no dependencies *on purpose* — see the
  comment in it before adding any.
- **One source of truth for every price**: `assets/js/pricing-core.js`. The
  browser, the Pages Function and the admin previews all read it, so the price
  shown is by construction the price charged.
- **The browser never sets the amount.** `/api/checkout` re-prices server-side
  before creating the Stripe session.

Read `README.md` next, then `CLOUDFLARE.md` — the latter is the real runbook and
is more current than anything you will infer from the code.

---

## Before you touch anything: work out which job you are doing

Ask the person who gave you this. Do not guess — the two paths differ in whether
the shop stops taking money.

### Path A — a private copy, live site untouched

Right for learning the code, trying changes, or reviewing. Deploy this repo to a
**new Pages project on its own `*.pages.dev` address** and leave the custom
domain where it is.

Safe, reversible, no downtime. Everything below still applies except
"Move the custom domain".

### Path B — this repository becomes the live site

Right when ownership is genuinely moving. This is a **cutover with real
downtime risk**, and the order matters. Do not start it casually, and do not
start it on an evening when someone needs the shop working.

---

## First, settle one question: same Cloudflare account, or a different one?

This decides whether you are doing a configuration job or a data migration, and
nothing else in this document makes sense until it is answered.

**KV namespaces and R2 buckets belong to a Cloudflare account.** They cannot be
shared across accounts, and a Pages project can only bind storage that lives in
its own account.

| | What it means |
|---|---|
| **Same account** as the existing Pages project | Your new project can bind the **existing** `NEOTYPE` KV namespace and `ART` bucket. Live prices, every order, every enquiry and all artwork carry straight over. This is a configuration job. |
| **A different account** | You get an **empty** KV namespace. The shop will serve the shipped default prices, `/admin` will show no orders and no enquiries, and no artwork will resolve. Nothing is lost from the old account — but nothing arrives in the new one either. This is a migration, and it needs a deliberate export and import that nobody has written yet. |

**How to tell:** in the Cloudflare dashboard, look at Storage & Databases → KV.
If a namespace called `NEOTYPE` is listed and already holds a `pricing` key, you
are in the right account. If the list is empty, you are not.

If it turns out to be a different account, **stop and say so** rather than
standing up an empty shop that looks fine. Serving default prices to real
customers is worse than serving nothing, because nobody notices.

---

## What a working deployment needs

A Pages project pointed at this repo will build and serve the HTML immediately.
It will **not** work as a shop until all of the following exist. Every one of
them is configured in the Cloudflare dashboard, not in this repository — there
is deliberately no `wrangler.toml`, because one would lock these out of the UI.

### Project settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | *(empty)* |
| Build output directory | `/` |

### Bindings

| Binding | Type | Holds |
|---|---|---|
| `NEOTYPE` | KV namespace | the price list (key `pricing`), every order (`order:…`), every enquiry (`enquiry:…`), and artwork if R2 is absent |
| `ART` | R2 bucket | customer artwork. **Optional** — without it artwork goes to KV, capped at 25 MB and expiring after 90 days |

### Variables and secrets

Set on **Production *and* Preview**.

| Name | Kind | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | Secret | the `/admin` password. Cannot be read back once saved |
| `STRIPE_SECRET_KEY` | Secret | `sk_live_…` for real money, `sk_test_…` to rehearse |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_…`, from the webhook endpoint below |
| `RESEND_API_KEY` | Secret | order and enquiry email, **and the `/admin` recovery codes** |
| `ENQUIRY_TO` | Plain | where enquiries land |
| `ENQUIRY_FROM` | Plain | a verified Resend sender |
| `ADMIN_EMAIL` | Plain | optional; where sign-in codes go. Falls back to `ENQUIRY_TO` |

**You cannot read any existing secret out of the old project.** Cloudflare does
not return them — not to the owner, not to support, not to you. Every secret
above has to be supplied fresh by a human who holds it, or reissued from the
service that owns it (Stripe, Resend). If you find yourself planning to "copy
the secrets across", stop and ask.

### The Stripe webhook

Orders are recorded by two independent paths and you want both: the webhook
(reliable, server-to-server) and the success page (fallback, only if the
customer stays on it). Both write the same key, so whichever lands first wins.

Stripe → Developers → Webhooks → add an endpoint at `/api/stripe-webhook` on
the host this project serves, subscribed to **all three** of:

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
```

Then put its signing secret in `STRIPE_WEBHOOK_SECRET`.

> **A webhook fails silently.** Orders simply stop being recorded and nobody
> notices until a customer asks where their job went. `CLOUDFLARE.md` §3b
> explains why the existing one is deliberately pointed at a `pages.dev`
> hostname rather than the custom domain, and that reasoning still holds. If the
> host changes, this endpoint must change with it.

---

## Path B only — moving the custom domain

Read this whole section before starting. **A custom domain can be attached to
only one Pages project at a time.** `www.neotype.au` is currently attached to
the old one, so the sequence is forced:

1. Stand the new project up on its own `*.pages.dev` address and get it
   **completely working there** — every check in the next section passing —
   while the live site carries on untouched.
2. Move the Stripe webhook, or add a second endpoint, so orders are recorded on
   the new host too. Confirm with a test event before relying on it.
3. Only then: remove `www.neotype.au` from the old project and add it to the
   new one. **The shop is down between those two steps**, and a fresh
   certificate has to issue. Do it deliberately, not at a busy hour.
4. Re-check everything below against the custom domain.
5. Leave the old project in place, unbound, until you are sure. It is the
   rollback.

DNS lives in Cloudflare and is shared, not per-project — `neotype.au` also runs
Microsoft 365 email. **Do not edit MX, SPF, DKIM or the Microsoft records.**
`MAIL-DNS.md` records the time they were broken and repaired; do not repeat it.

---

## How to know it actually works

Do not report success on "the page loaded". Check these, against whatever host
the project serves, and paste the real output rather than describing it.

```sh
BASE=https://<the-host-you-deployed>

# every public page answers
for p in / /customizer /banners /corflute /custom-stickers-brisbane /success /admin; do
  printf '%-32s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")"
done

# the price list is being served from KV, not the shipped defaults
curl -s "$BASE/api/pricing" | head -c 200

# the private routes refuse anonymous callers — 401, never 200
for p in /api/orders /api/enquiries; do
  printf '%-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")"
done

# archive/delete routes exist and are gated — 401, not 404
for p in /api/order-archive /api/order-purge /api/orders-sweep \
         /api/enquiry-archive /api/enquiry-purge /api/enquiries-sweep; do
  printf '%-26s %s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$p" \
       -H 'Content-Type: application/json' -d '{}')"
done

# the webhook is alive and verifying signatures — 400 "Bad signature", not 404
curl -s -X POST "$BASE/api/stripe-webhook" \
  -H 'Content-Type: application/json' -d '{}'

# checkout produces a real Stripe session
curl -s -X POST "$BASE/api/checkout" -H 'Content-Type: application/json' \
  -d '{"product":"stickers","w":75,"h":75,"qty":100,"finish":"vinyl-matte","shape":"die","turnaround":"standard"}' \
  | head -c 120

# internal documents must NOT be readable — every one a 301.
# Print the first bytes of the body too: on Pages a 200 has two different
# causes and the status code alone cannot tell them apart.
for p in /START-HERE.md /OWNERSHIP.md /KNOWN-ISSUES.md /CLOUDFLARE.md /handover.html; do
  printf '%-22s %-4s %s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")" \
    "$(curl -s "$BASE$p" | head -c 14 | tr -d '\n')"
done
```

**Reading the results.** `401` on the private and archive routes is correct and
`404` means they did not deploy. A `cs_test_…` session id means the test key is
in use; `cs_live_…` means real money. `/api/pricing` returning a base rate of
`85` means KV is not bound or is empty and the shipped defaults are being served
— the live table reads `150`. If you see `85`, re-read the account question at
the top of this document before changing anything: an empty KV usually means the
project is in the wrong Cloudflare account, not that a binding is misspelt.

**Only `301` passes on the internal documents.** This repository ships no
`404.html`, so Pages falls back to serving `index.html` **with a `200`** for any
path it cannot match — a missing file and a leaked one return the same status.
That is why the check prints the body. A `200` whose body starts `<!DOCTYPE
html` means the document is *absent from the deploy*; a `200` whose body starts
with Markdown (`# `) means it is there and its `_redirects` rule is not.
Verified on production, 26 Aug 2026: an invented path returns the homepage with
`200`.

Then run the suite. No network, no credentials:

```sh
node .tests/orders-archive.mjs      # archive/delete/sweep, against a stubbed KV
node .tests/pricing-bands.mjs       # quantity-band pricing
node .tests/email-test.mjs          # a signed webhook end to end
```

The browser tests need Chromium and skip cleanly without it; `.tests/README.md`
explains how to run them. Whole suite is 513 checks across 18 suites.

---

## Things that will bite you

- **Everything in this repository is published.** Cloudflare Pages serves the
  whole tree — a leading dot does not hide a directory, and `.assetsignore` is
  not a Pages feature. Both were tried and verified. `_redirects` is what keeps
  the internal documents unreadable. **Adding a new internal file means adding
  it to `_redirects` and `robots.txt` in the same commit** — the rule is at the
  top of `_redirects`.
- **Do not add an `/admin` rule to `_redirects`.** Pages already serves `/admin`
  from `admin.html`, and a rule targeting `admin.html` causes an infinite
  redirect loop. Verified: 50 redirects, never resolves.
- **Do not add dependencies casually.** Declaring any makes Cloudflare run
  `npm install` on deploy, and that install step once stalled production for a
  day. `playwright-core` is deliberately kept out of `package.json`.
- **Do not edit prices straight into KV.** The `/admin` editor shows what a
  change does *before* it goes live. Writing KV directly skips that.
- **`KNOWN-ISSUES.md` is the honest list** of what is still wrong with
  `/admin` — 37 recorded defects with repro steps, plus the panels that were
  never audited. Read it before concluding you have found a new bug.

---

## The documents, in the order they are worth reading

| File | What it is |
|---|---|
| `README.md` | what the site is and how it is built |
| `CLOUDFLARE.md` | the runbook: hosting, DNS, bindings, secrets, the webhook |
| `OWNERSHIP.md` | which accounts matter and what has moved |
| `handover.html` | the owner's operating guide — how to run the shop day to day |
| `PRICING.md` | how the price model works |
| `MAIL-DNS.md` | the email records, and how they were broken and fixed |
| `KNOWN-ISSUES.md` | what is wrong, and what was deliberately left alone |
| `SETUP.md` | deployment |

---

## If you are unsure, stop and ask

The failure mode here is not a broken build — it is a shop that looks fine and
quietly stops recording orders or sending confirmations. Those failures are
silent by nature. When a step involves the custom domain, the webhook, DNS, or
anything holding money, ask the person before doing it rather than after.
