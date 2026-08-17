# Cloudflare Pages cutover runbook

Moving neotype.au from Netlify to Cloudflare Pages + Workers KV.

**Why:** Netlify's free plan is 300 credits/month with a **hard cap and no
overage**, and a production deploy costs 15 credits — about 20 deploys a month.
Netlify's own docs: when the allowance runs out, *"all of your web projects are
paused and visitors will find a `Site not available` page… they will not receive
new web requests, web traffic, or form submissions."* For a live storefront
taking card payments, a cap whose failure mode is total outage isn't acceptable.

---

## 🔴 Read this first — Ian's email is broken, and it's not the hosting

The apex TXT record on neotype.au is:

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

**Fix (do this now, independent of any hosting change).** In GoDaddy DNS, edit
that TXT record on `@` to:

```
v=spf1 include:spf.protection.outlook.com ~all
```

Use `~all` (softfail) for the first week, then tighten to `-all` once you've
confirmed mail flows. Leave the other apex TXT record, `MS=ms80978019`, alone —
that's Microsoft's domain verification.

Also missing and worth adding after mail is confirmed working (see `MAIL-DNS.md`):
DKIM (`selector1`/`selector2` CNAMEs, tenant-specific — get them from the M365
admin centre) and a DMARC record starting at `p=none`.

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

**My recommendation: Option B**, unless you specifically want the bare domain
served directly. The credit problem we're solving is a billing problem; it isn't
worth putting the client's business email in the blast radius to fix it. You can
always move nameservers later, calmly, once the site is stable on Pages.

---

## Full DNS inventory (as it stands today)

Anything marked **KEEP** must survive the move untouched or mail breaks.

| Type | Name | Value | Purpose |
|---|---|---|---|
| A | `@` | `75.2.60.5` | Netlify — replaced by Pages |
| CNAME | `www` | `beamish-biscotti-7be2b5.netlify.app` | Netlify — replaced by Pages |
| MX | `@` | `neotype-au.mail.protection.outlook.com` (priority 0) | **KEEP — M365 mail** |
| TXT | `@` | `MS=ms80978019` | **KEEP — M365 domain verification** |
| TXT | `@` | `v=spf1 include:secureserver.net -all` | **FIX — see above** |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | **KEEP — Outlook client setup** |
| SRV | `_sip._tls` | `100 1 443 sipdir.online.lync.com` | **KEEP — Teams** |
| SRV | `_sipfederationtls._tcp` | `100 1 5061 sipfed.online.lync.com` | **KEEP — Teams federation** |

Not currently set: DKIM (`selector1._domainkey`, `selector2._domainkey`) and
`_dmarc`. There are no AAAA records — correct, they were removed earlier.

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
```bash
npx wrangler kv namespace create NEOTYPE
```
Copy the id it prints into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`, then commit that change. Also bind it in
the dashboard: Settings → Bindings → KV namespace, variable name `NEOTYPE`.

This one namespace holds both the price list (key `pricing`) and every enquiry
(keys `enquiry:<timestamp>:<id>`).

### 3. Secrets and variables
Settings → Variables and Secrets. Add to **Production** *and* **Preview**:

| Name | Kind | Value |
|---|---|---|
| `ADMIN_PASSWORD` | Secret | the `/admin` password — **pick a new one**, the old one was pasted in chat |
| `STRIPE_SECRET_KEY` | Secret | `sk_test_…` first, `sk_live_…` when going live |
| `RESEND_API_KEY` | Secret | optional — enables enquiry emails |
| `ENQUIRY_TO` | Plain | `kiko@neotype.au` |
| `ENQUIRY_FROM` | Plain | verified sender, e.g. `site@send.neotype.au` |

Cloudflare has no secret scanner, so the `SECRETS_SCAN_OMIT_PATHS` workaround
that was needed on Netlify is gone.

### 4. Enquiry email
Netlify Forms has no Cloudflare equivalent, so `/api/enquiry` now handles it:
**every enquiry is written to KV first**, then emailed. If the mail key is
missing or the provider is down, the enquiry is still stored — an enquiry is
never silently dropped.

To turn on the email, create a [Resend](https://resend.com) account (free tier
covers this volume) and verify a **subdomain** — `send.neotype.au`, not the root.
That matters: verifying the root would mean adding Resend to the root SPF record,
right next to the M365 mail we just fixed. A subdomain keeps them separate.

Until that's set up, enquiries accumulate in KV and can be read with:
```bash
npx wrangler kv key list --binding NEOTYPE | grep enquiry
```

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
| — | `wrangler.toml` |

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
4. Submit the enquiry form; confirm it appears via `wrangler kv key list`.
5. With `sk_test_…` set, buy something with card `4242 4242 4242 4242`; confirm
   you land on the success page and Stripe shows the order metadata.

Only after all five pass, change DNS.

## Rollback

DNS is the switch. Option B: delete the `www` CNAME to Pages and point it back at
`beamish-biscotti-7be2b5.netlify.app`, and turn off GoDaddy forwarding. Option A:
change the nameservers back to `ns67`/`ns68.domaincontrol.com`. Keep the Netlify
project alive until you no longer need this.
