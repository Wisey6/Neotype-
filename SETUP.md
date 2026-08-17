# Going live — setup guide

The site is a static site plus **one serverless function** (`netlify/functions/api.mjs`)
that handles pricing, the admin login and Stripe checkout. Everything runs on
**Netlify**, so there's one account, one dashboard and one bill.

| What | Where it runs | Cost |
|---|---|---|
| Website (all pages, all builders) | Netlify hosting | Free tier |
| Enquiry form | Netlify Forms | Free tier (100 subs/mo) |
| Pricing + admin + checkout | Netlify Functions | Free tier |
| Price storage | Netlify Blobs | Free tier |
| Card payments | Stripe | ~1.75% + 30c per sale |
| Customer artwork files | Uploadcare | Free tier |

---

## 1. Create the Netlify site

Sign in to **netlify.com** with Ian's account, then either:

- **Connect the Git repo** (recommended) — Netlify redeploys automatically on
  every push, or
- **Drag-and-drop** the project folder onto the Netlify dashboard.

No build settings needed — `netlify.toml` already sets `publish = "."` and points
at the functions folder. Netlify installs the one dependency (`@netlify/blobs`)
automatically.

> **Check the production branch is `main`.** Site configuration → Build & deploy
> → Branches. If Netlify picked up a feature branch when the repo was connected,
> the live site rebuilds from that branch — so deleting it during cleanup would
> stop deploys, and anyone inheriting the repo would reasonably assume `main` is
> production.

## 2. Set the environment variables

**Site settings → Environment variables.** Add:

| Key | Value | When |
|---|---|---|
| `ADMIN_PASSWORD` | the password for the pricing admin page | now |
| `STRIPE_SECRET_KEY` | Stripe secret key | last — see the Stripe step |

Redeploy after adding them. Environment variables are read at build time, so a
change only takes effect on the next deploy.

> **Do not set a `SITE_URL`.** Nothing reads it. Stripe's return pages use the origin each request
> actually arrived on, so production returns to `neotype.au` and a deploy
> preview returns to its own preview URL. Hardcoding a site URL (or using
> Netlify's built-in `URL`, which is production even inside previews) would send
> preview test orders to the live site.

## 3. Make the site public

New Netlify projects can be **password/member protected**. If the site shows
_"This project is private. Only project members can view this site"_, turn that
off before pointing the domain at it — otherwise visitors hit an access wall.

**Site configuration → Access & security → Visitor access → set to public.**

## 4. Point the domain at Netlify

> ### ⚠️ Do NOT switch to Netlify nameservers
> `neotype.au` runs **Microsoft 365 email** (`kiko@neotype.au`). Its MX,
> SPF/verification TXT and `autodiscover` records live at GoDaddy. Moving
> nameservers to Netlify drops all of them and **Ian's email stops working**.
> Keep DNS at GoDaddy and change only the website records, as below.

In Netlify: **Domain management → Add a domain → `neotype.au`**. When it offers
"Use Netlify DNS / nameservers", decline it and choose the **external DNS**
option so it shows you records instead.

Then in **GoDaddy → DNS**, change only these:

| Type | Name | Change to |
|---|---|---|
| A | `@` | the single IP Netlify shows (currently `75.2.60.5`) — **delete the four `185.199.108–111.153` GitHub records** |
| CNAME | `www` | your Netlify subdomain (e.g. `beamish-biscotti-7be2b5.netlify.app`) — replaces `wisey6.github.io` |

**Leave every other record alone** — MX, both TXT records, `autodiscover`,
`email`, `lyncdiscover`, `msoid`, `_domainconnect`. Those are mail and Microsoft
services, nothing to do with the website.

Netlify issues the HTTPS certificate automatically once the records resolve, so
the "Not secure" warning clears itself.

## 5. Only after Netlify is serving the domain

Check `https://neotype.au` actually shows the Netlify version (the products
section and `/api/pricing` returning JSON are good tells). **Then**, and not
before:

1. Repo **Settings → Pages → Unpublish site** (turns off GitHub Pages).
2. Delete the `CNAME` file from the repo — it only exists for GitHub Pages.

Doing either of these *before* DNS has moved leaves the site 404ing in the gap.

## 6. Turn on enquiry emails

Enquiries are handled by **Netlify Forms**. The contact form is already wired in
code (`name="enquiry"`, `data-netlify="true"`, honeypot) — but two switches in
the dashboard have to be on or submissions silently go nowhere.

**a. Enable form detection.** New projects often ship with it off; the Forms page
then shows an _"Enable form detection"_ button instead of your form. Turn it on,
then **trigger a redeploy** — Netlify only scans for forms at deploy time, so
without a fresh deploy the form stays unregistered. When it's working, Forms
lists `enquiry` as active.

**b. Add an email notification.** Detection alone only stores submissions in the
dashboard — nobody gets told. Go to **Forms → enquiry → Settings → Form
notifications → Add notification → Email notification** and enter the address
that should receive enquiries (`kiko@neotype.au`).

> Worth doing in that order, then sending one real test submission — it proves
> capture *and* delivery in a single check.

## 7. Connect Stripe and test

1. Ian creates the **Stripe** account and completes verification (business
   details + the bank account he gets paid into).
2. Copy the **test** secret key (`sk_test_…`) into the `STRIPE_SECRET_KEY`
   environment variable and redeploy.
3. Build a sticker on the live site and pay with test card
   `4242 4242 4242 4242` (any future expiry, any CVC).
4. Check the payment appears in the Stripe dashboard with the full spec and the
   artwork link in its **metadata**.
5. Swap in the **live** key (`sk_live_…`) and redeploy. You're taking orders.

## 8. Artwork uploads (optional but recommended)

Create a free **uploadcare.com** account, copy the **Public key**, and paste it
into the `uploadcareKey` field near the bottom of `customizer.html`,
`banners.html` and `corflute.html`:

```js
window.NEOTYPE_CHECKOUT = { uploadcareKey: "your_public_key", currency: "aud" };
```

Without it, orders still work — they just carry the file *name* instead of a
downloadable link, so the customer would need to email the artwork separately.

---

## The pricing admin

Once deployed, Ian opens **neotype.au/admin**, enters `ADMIN_PASSWORD`, and can
change any price — dollar amounts and percentage uplifts, with live example
prices showing what customers will pay. Saving takes effect immediately, with no
redeploy and no developer.

See `PRICING.md` for what each number does.

## Local development

```bash
npm install
npx netlify dev     # serves the site + functions at localhost:8888
```

Opening the `.html` files directly from disk also works for design work — the
builders detect there's no API and fall back to demo behaviour.
