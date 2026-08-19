# Cloudflare Pages cutover runbook

Moving neotype.au from Netlify to Cloudflare Pages + Workers KV.

**Why:** Netlify's free plan is 300 credits/month with a **hard cap and no
overage**, and a production deploy costs 15 credits — about 20 deploys a month.
Netlify's own docs: when the allowance runs out, *"all of your web projects are
paused and visitors will find a `Site not available` page… they will not receive
new web requests, web traffic, or form submissions."* For a live storefront
taking card payments, a cap whose failure mode is total outage isn't acceptable.

---

## ✅ Ian's email — SPF fixed 17 Aug 2026

This was broken by DNS, not by hosting. The apex TXT record *was*:

```
v=spf1 include:secureserver.net -all
```

That is **GoDaddy's** SPF record with a **hard fail** (`-all`), on a domain whose
mail is **Microsoft 365**. Microsoft sends from `spf.protection.outlook.com`,
which is not in that include — so the record actively tells every receiving mail
server to **reject** mail sent from `kiko@neotype.au`. This is the most likely
cause of "I can't send any emails."

It is a GoDaddy registration default that needed replacing when mail moved to
Microsoft 365. It is **not** something the Netlify or DNS work in this project
caused — those changes were A, AAAA and CNAME records only, and never touched
TXT.

**Fixed.** The record now reads `v=spf1 include:spf.protection.outlook.com ~all`,
confirmed against both authoritative nameservers directly. `MS=ms80978019` is
untouched. Tighten `~all` to `-all` after a week of clean sending.

**Still outstanding:** DKIM (`selector1`/`selector2` CNAMEs, tenant-specific —
from the M365 admin centre) and a DMARC record starting at `p=none`. Whether
those are urgent depends on the symptom — `MAIL-DNS.md` has the one test that
tells you which problem you actually had.

Also noted: a stale `email → email.secureserver.net` CNAME from GoDaddy's old
mail service. It authorises nothing (that was the SPF include, now removed) so
it's untidy rather than risky. Ask Ian whether he ever uses GoDaddy webmail
before deleting it.

---

## ⚠️ The DNS decision you have to make

Cloudflare's documentation is explicit: *"To use a custom apex domain (for
example, `example.com`) with your Pages project, configure your nameservers to
point to Cloudflare's nameservers."* Subdomains can stay on external DNS via a
CNAME; **the apex cannot.**

neotype.au's nameservers are currently GoDaddy (`ns67`/`ns68.domaincontrol.com`).
So there are two ways to do this, and they carry very different risk:

### Option A — Move nameservers to Cloudflare (needed for `neotype.au` bare)

Cleanest end state and the only way the bare apex serves from Pages. But it means
re-creating **every** DNS record, including the Microsoft 365 mail records.
Cloudflare's onboarding scans and imports existing records automatically, but the
import routinely misses TXT and SRV records — and those are exactly the mail ones.
This is the operation that breaks `kiko@neotype.au` if it's done carelessly.

Do it in this order, and do not deviate:

1. Add `neotype.au` to Cloudflare (**do not** change nameservers at GoDaddy yet).
2. Let Cloudflare's scan run, then compare its record list against the inventory
   below, line by line. Add anything it missed **by hand**.
3. Fix the SPF record while you're in there (see above).
4. Verify the staged zone answers correctly *before* cutting over, by querying
   Cloudflare's assigned nameservers directly:
   ```bash
   # replace with the two nameservers Cloudflare assigns you
   dig @kate.ns.cloudflare.com neotype.au MX +short
   dig @kate.ns.cloudflare.com neotype.au TXT +short
   dig @kate.ns.cloudflare.com autodiscover.neotype.au CNAME +short
   dig @kate.ns.cloudflare.com _sipfederationtls._tcp.neotype.au SRV +short
   ```
   All four must return the values in the inventory. **If any is empty, stop.**
5. Only then change the nameservers at GoDaddy.
6. Send a test email from `kiko@neotype.au` to an outside address (Gmail) and
   reply to it. Check the received headers show `spf=pass`.

### Option B — Keep GoDaddy nameservers (mail never touched)

Make `www.neotype.au` the real site — a CNAME to `<project>.pages.dev`, which
Cloudflare supports from external DNS — and use **GoDaddy's domain forwarding**
to send bare `neotype.au` → `https://www.neotype.au`.

- Mail records are never touched. Zero risk to Ian's email.
- Costs one redirect hop on the bare domain, and the bare domain then depends on
  GoDaddy's forwarding service.

**Option B is what was done** (17 Aug 2026): `www.neotype.au` is a CNAME to
`neotype.pages.dev` and is Active in Pages with a valid Cloudflare certificate;
the bare apex uses GoDaddy forwarding. Mail was never touched.

Treat the apex forwarding as a **bridge, not the end state**. It costs a redirect
hop and leaves `https://neotype.au` dependent on GoDaddy's forwarding certificate.
Moving nameservers to Cloudflare (Option A) removes both — and doing it *now that
`www` already points at Pages* is zero-downtime, because GoDaddy's zone and
Cloudflare's would both serve a working site throughout propagation. Do it on a
quiet day, with the verification in Option A step 4, not under pressure.

---

## Nameserver move to Cloudflare — step by step (Option A)

Decided 18 Aug 2026. Follow in order. The one irreversible-feeling step is #7,
and everything before it is staging that changes nothing live.

### Why the apex must be rebuilt in the same operation

The apex `A` records (`15.197.225.128`, `3.33.251.168` as of 18 Aug — they
rotate) are GoDaddy's **domain forwarding** service. That service only runs off
GoDaddy's own nameservers. The moment the nameservers move, those IPs stop
resolving to anything useful, so copying them into Cloudflare achieves nothing.
The apex is replaced with a CNAME to `neotype.pages.dev`, which Cloudflare
flattens at the apex — this is the upgrade the move buys, not a side effect.

### 1. Add the zone — nameservers stay at GoDaddy

Cloudflare → **Add a site** → `neotype.au` → **Free** plan. Let the scan run.
**Do not** change nameservers at GoDaddy yet. Nothing is live until step 7.

### 2. Check the scan against this list, by hand

Cloudflare's importer routinely misses `TXT` and `SRV` — which is to say, it
misses exactly the mail records. Anything below that isn't there, add manually.

| Type | Name | Value | Proxy | Keep? |
|---|---|---|---|---|
| MX | `@` | `neotype-au.mail.protection.outlook.com` prio **0** | n/a | **KEEP — mail** |
| TXT | `@` | `MS=ms80978019` | n/a | **KEEP — M365 verify** |
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com ~all` | n/a | **KEEP** |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | **DNS only** | **KEEP — Outlook** |
| SRV | `_sip._tls` | `100 1 443 sipdir.online.lync.com` | n/a | **KEEP — Teams** |
| SRV | `_sipfederationtls._tcp` | `100 1 5061 sipfed.online.lync.com` | n/a | **KEEP — Teams** |
| CNAME | `www` | `neotype.pages.dev` | Proxied | the live site |
| CNAME | `email` | `email.secureserver.net` | — | **drop** — stale GoDaddy webmail |
| A | `@` | GoDaddy forwarding IPs | — | **drop** — replaced in step 4 |

**Every Microsoft CNAME must be grey-cloud (DNS only):** `autodiscover`,
`lyncdiscover`, `msoid`. Cloudflare's import sets CNAMEs to proxied by default,
and proxying these breaks them — Cloudflare terminates TLS with its own
certificate for `*.neotype.au` and routes to its edge, while Outlook and Teams
clients are expecting Microsoft's endpoints and Microsoft's certificate. The
failure is quiet: existing sessions keep working and only new sign-ins and client
setups fail, so it can go unnoticed for weeks.

Cloudflare flags these itself with an orange warning triangle in the DNS table.
That triangle is the signal, and it means the proxy toggle is wrong.

### 3. Add the Resend records while the zone is staged

| Type | Name | Value | Prio |
|---|---|---|---|
| TXT | `resend._domainkey` | (paste from Resend — use its copy button) | — |
| MX | `send` | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | — |

Never add a second `v=spf1` record at the root. Two SPF records at one name is a
permanent error and mail from the domain starts failing. Resend's SPF belongs on
`send`, and it is consulted there because the return-path is `send.neotype.au` —
the root record is never queried for Resend's mail.

### 4. Rebuild the apex

Delete both apex `A` records. Add:

| Type | Name | Value | Proxy |
|---|---|---|---|
| CNAME | `@` | `neotype.pages.dev` | **Proxied** |

Cloudflare flattens this at the apex, so `https://neotype.au` serves the site
directly with no redirect hop and no dependency on GoDaddy's forwarding cert.

### 5. Verify the staged zone BEFORE cutting over

Cloudflare assigns two nameservers (shown on the zone's overview). Query them
directly — this tests the new zone without anything being live:

```bash
NS=xxx.ns.cloudflare.com     # your assigned nameserver
for r in "neotype.au MX" "neotype.au TXT" "autodiscover.neotype.au CNAME" \
         "_sipfederationtls._tcp.neotype.au SRV" "_sip._tls.neotype.au SRV" \
         "send.neotype.au TXT" "resend._domainkey.neotype.au TXT"; do
  echo "--- $r"; dig +short @"$NS" $r
done
```

**Every one must return a value. If any is empty, stop and fix it.** An empty
answer here becomes broken mail after step 7.

### 6. Keep GoDaddy forwarding for now

Do not cancel it yet. It costs nothing to leave and it is the fallback if the
cutover has to be reversed.

### 7. Change the nameservers at GoDaddy

GoDaddy → **My Products → neotype.au → DNS → Nameservers → Change → I'll use my
own** → enter Cloudflare's two. Propagation is usually under an hour.

Zero downtime by design: `www` already points at Pages, and both zones serve a
working site throughout, so there is no window where the site is down.

### 8. Verify after propagation

```bash
dig +short neotype.au NS                    # → cloudflare
dig +short neotype.au MX                    # → outlook, priority 0
curl -sI https://neotype.au | head -1       # → 200, not a redirect
```

Then the test that actually matters: **send mail from `kiko@neotype.au` to a
Gmail address and reply to it.** Open the received message's headers and confirm
`spf=pass`. Nothing else proves mail survived.

### 9. Only then

- Cancel GoDaddy domain forwarding
- Pages → the project → Custom domains → add `neotype.au` (apex) alongside `www`
- Verify the Resend domain, now that its records resolve

### If mail breaks

Change the nameservers back to `ns67`/`ns68.domaincontrol.com` at GoDaddy. The
old zone is still intact there — GoDaddy does not delete it when you point away.
Recovery is the propagation delay, nothing more.

---

## Full DNS inventory

**Live state as of 17 Aug 2026** — verified against GoDaddy's authoritative
nameservers, not a public resolver. Anything marked **KEEP** must survive any
future change or mail breaks.

| Type | Name | Value | Purpose |
|---|---|---|---|
| A | `@` | `15.197.142.173`, `3.33.152.147` | GoDaddy forwarding → `https://www.neotype.au` |
| CNAME | `www` | `neotype.pages.dev` | **the live site** — Cloudflare Pages |
| MX | `@` | `neotype-au.mail.protection.outlook.com` (priority 0) | **KEEP — M365 mail** |
| TXT | `@` | `MS=ms80978019` | **KEEP — M365 domain verification** |
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com ~all` | **KEEP — fixed 17 Aug** |
| CNAME | `email` | `email.secureserver.net` | stale GoDaddy webmail — safe to drop |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | **KEEP — Outlook client setup** |
| CNAME | `lyncdiscover` | `webdir.online.lync.com` | **KEEP — Teams client discovery** |
| CNAME | `msoid` | `clientconfig.microsoftonline-p.net` | **KEEP — M365 sign-in** |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com` | GoDaddy Domain Connect — drop once off GoDaddy DNS |
| SRV | `_sip._tls` | `100 1 443 sipdir.online.lync.com` | **KEEP — Teams** |
| SRV | `_sipfederationtls._tcp` | `100 1 5061 sipfed.online.lync.com` | **KEEP — Teams federation** |

Not currently set: DKIM (`selector1._domainkey`, `selector2._domainkey`),
`_dmarc`, `enterpriseregistration` and `enterpriseenrollment`. There are no AAAA
records — correct, they were removed earlier.

**How this inventory was built, and why that matters.** The first version was
assembled by querying each record name individually over DNS-over-HTTPS. DNS has
no "list everything" query without a zone transfer, so that method can only ever
find names someone thought to ask for — and it missed `lyncdiscover`, `msoid`
and `_domainconnect`, two of which are load-bearing Microsoft records. They were
caught on 18 Aug by Cloudflare's own zone scan, which reads the registrar's data
rather than guessing names.

Treat this table as a cross-check against a scan, never as the source for a
hand-rebuild of the zone. Anything a scan reports that is not listed here should
be assumed real and researched, not deleted.

---

## Cloudflare setup

### 1. Create the project
Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git →
`Wisey6/Neotype-`.

- Production branch: **`main`**
- Build command: **leave empty**
- Build output directory: **`/`**

Unlike Netlify, git pushes to `main` build automatically — no manual trigger.

### 2. Create the KV namespace (replaces Netlify Blobs)
Dashboard → Storage & Databases → KV → Create namespace, called `NEOTYPE`.
Then bind it: Pages project → Settings → Bindings → Add → KV namespace, with
variable name `NEOTYPE`.

> There is deliberately **no `wrangler.toml`** in this repo. Cloudflare's docs are
> explicit that a Wrangler config file "becomes the source of truth when used,
> meaning that you can not edit the same fields in the dashboard" — so having one
> would lock the bindings and variables out of the dashboard UI and require a
> commit for every change. Since the site has no build step, the file buys us
> nothing. Everything is configured in the dashboard instead.

This one namespace holds the price list (key `pricing`), every enquiry
(`enquiry:<timestamp>:<id>`) and — unless R2 is enabled — customers' artwork
(`art:<uuid>/<filename>`).

### 2b. Artwork storage — R2 is optional
R2 is the better home for print files, but Cloudflare gates it behind a
subscription that wants a card on file (free to 10 GB, but still a card). **You
do not need it.** With only the KV namespace bound, artwork is stored in KV
instead, with two consequences worth knowing:

- **25 MB per file** (KV's hard limit; the site rejects anything larger with a
  message telling the customer to email it in) rather than 50 MB on R2.
- **Artwork expires after 90 days.** By then the job is printed. Ian should save
  the file with the job — this is delivery, not an archive.

If you ever do enable R2, bind the bucket as `ART` and the code switches over on
its own. No code change, no redeploy of anything but the binding.

### 3. Secrets and variables
Settings → Variables and Secrets. Add to **Production** *and* **Preview**:

| Name | Kind | Value |
|---|---|---|
| `ADMIN_PASSWORD` | Secret | the `/admin` password — **pick a new one**, the old one was pasted in chat |
| `STRIPE_SECRET_KEY` | Secret | `sk_test_…` first, `sk_live_…` when going live |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_…` — see "Order recording" below |
| `RESEND_API_KEY` | Secret | optional — enables enquiry emails |
| `ENQUIRY_TO` | Plain | `kiko@neotype.au` |
| `ENQUIRY_FROM` | Plain | verified sender, e.g. `site@send.neotype.au` |

Cloudflare has no secret scanner, so the `SECRETS_SCAN_OMIT_PATHS` workaround
that was needed on Netlify is gone.

### 3b. Order recording — set up the Stripe webhook

Orders are recorded by two independent paths, and **you want both**:

1. **The webhook** (reliable). Stripe tells the site, server to server, so an
   order is recorded even when the customer pays on a phone and closes the tab
   immediately. Without it, that order is invisible in `/admin`.
2. **The success page** (fallback). It confirms the payment so it can show a real
   receipt, and records the order as a side effect. Only works if the customer
   stays on the page.

Both write the same key, so whichever lands first wins — no duplicates.

**To set it up:** Stripe → Developers → **Webhooks** → Add endpoint

- URL: `https://neotype.pages.dev/api/stripe-webhook`

  **Deliberately the `pages.dev` hostname, not `www.neotype.au`.** A webhook fails
  *silently* — orders simply stop being recorded and nobody notices until a
  customer asks where their order went. So it should depend on as little as
  possible. `pages.dev` depends on Cloudflare alone; `www.neotype.au` also depends
  on GoDaddy's DNS, the CNAME, and a certificate. The nameserver move described
  above would hand `www` over mid-propagation while `pages.dev` carries on
  unaffected.

  The trade-off: `pages.dev` is Cloudflare's hostname, so **if this site ever
  moves off Cloudflare Pages, this endpoint must be repointed** or orders stop
  recording. Note it wherever hosting changes get planned.
- Events — **all three**, none optional:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`

  Why all three: **`completed` does not mean paid.** With an async method (BECS
  Direct Debit, bank transfer) the session completes while the money is still with
  the customer's bank. Stripe reports this across two fields — session `status`
  (`open`/`complete`/`expired`) and `payment_status` (`paid`/`unpaid`) — and the
  handler reads both:

  | Event | Stripe says | Order recorded as |
  |---|---|---|
  | `completed` | `payment_status: paid` | **paid** — artwork downloadable, print it |
  | `completed` | `complete` + `unpaid` | **pending** — shown in /admin in amber, *do not print* |
  | `async_payment_succeeded` | — | **paid** (overwrites the pending record) |
  | `async_payment_failed` | — | **failed** (overwrites it, stays visible in red) |

  Drop `async_payment_failed` and a failed payment sits in Ian's list as
  "awaiting payment" forever. Drop the pending branch and an async order is stored
  nowhere at all.

  Every write for one session uses the same key, so these are state changes to one
  record, never duplicates.
- Then copy the endpoint's **signing secret** (`whsec_…`) into
  `STRIPE_WEBHOOK_SECRET` in Cloudflare, and redeploy.

The endpoint verifies Stripe's HMAC signature and rejects anything unsigned,
wrongly signed, tampered with, or replayed after 5 minutes. Without the secret
set, it returns 503 and only the success-page path records orders — so an order
paid on a closed tab would be missed. Set it before going live.

> Do this **again** when you switch from test to live keys: test and live mode
> have separate webhook endpoints and separate signing secrets.

### 4. Enquiry email
Netlify Forms has no Cloudflare equivalent, so `/api/enquiry` now handles it:
**every enquiry is written to KV first**, then emailed. If the mail key is
missing or the provider is down, the enquiry is still stored — an enquiry is
never silently dropped.

To turn on the email, create a [Resend](https://resend.com) account (free tier
covers this volume) and verify a **subdomain** — `send.neotype.au`, not the root.
That matters: verifying the root would mean adding Resend to the root SPF record,
right next to the M365 mail we just fixed. A subdomain keeps them separate.

Until that's set up, enquiries accumulate in KV and can be read in the dashboard:
Storage & Databases → KV → `NEOTYPE` → the keys beginning `enquiry:`.

### 5. Custom domain
Pages project → Custom domains → add `www.neotype.au` (Option B) or
`neotype.au` + `www.neotype.au` (Option A). Cloudflare issues the certificate
automatically; allow a few minutes.

---

## What changed in the code

| Netlify | Cloudflare |
|---|---|
| `netlify/functions/api.mjs` | `functions/api/[[route]].js` |
| `process.env.X` | `env.X` |
| Netlify Blobs (`getStore`) | Workers KV (`env.NEOTYPE`) |
| Netlify Forms (`data-netlify="true"`) | `POST /api/enquiry` → KV + Resend |
| `netlify.toml` headers | `_headers` |
| `netlify.toml` redirects | `_redirects` |

`assets/js/pricing-core.js` is unchanged and still the single source of truth —
it bundles correctly under Cloudflare's bundler, so the browser, the function and
the admin page all price identically.

The Netlify files are **deliberately left in place** so the old site keeps working
as a fallback until the Cloudflare cutover is confirmed. Delete
`netlify.toml` and `netlify/` once you're happy, and cancel the Netlify project
so it stops consuming credits.

---

## Verification before you point DNS at it

Test on the `*.pages.dev` URL first, while neotype.au still serves from Netlify.

1. `https://<project>.pages.dev/api/pricing` returns JSON.
2. All three builders show prices and an itemised breakdown; banner 3 × 1 m
   qty 1 is **$87**.
3. `/admin` loads, the password works, changing a price and saving succeeds, and
   a builder reflects the new price on reload.
4. Submit the enquiry form; confirm an `enquiry:` key appears in the KV namespace.
5. With `sk_test_…` set, buy something with card `4242 4242 4242 4242`; confirm
   you land on the success page and Stripe shows the order metadata.

Only after all five pass, change DNS.

## Rollback

DNS is the switch. Option B: delete the `www` CNAME to Pages and point it back at
`beamish-biscotti-7be2b5.netlify.app`, and turn off GoDaddy forwarding. Option A:
change the nameservers back to `ns67`/`ns68.domaincontrol.com`. Keep the Netlify
project alive until you no longer need this.
