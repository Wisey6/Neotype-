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

## 2. Set the environment variables

**Site settings → Environment variables.** Add:

| Key | Value |
|---|---|
| `ADMIN_PASSWORD` | the password for the pricing admin page |
| `SITE_URL` | `https://neotype.au` |
| `STRIPE_SECRET_KEY` | Stripe secret key — **add this last**, see step 5 |

Redeploy after adding them.

## 3. Point the domain at Netlify

**Domain management → Add a domain → `neotype.au`.** Netlify shows the DNS
records to use. In GoDaddy, replace the current GitHub Pages records with those
(Netlify will either give you an A record or ask you to use their nameservers —
either is fine; nameservers are simpler).

Netlify issues the HTTPS certificate automatically, so the "Not secure" warning
goes away on its own.

> The old GitHub Pages setup can be switched off once the domain resolves to
> Netlify. Keep the repo — it's still the source of truth for the code.

## 4. Turn on enquiry emails

Enquiries are handled by **Netlify Forms** — already wired into the contact
form, nothing to configure in the code.

Go to **Forms → enquiry → Settings → Form notifications → Add notification →
Email notification**, and enter Ian's address. Every enquiry now arrives in his
inbox (and is stored in the dashboard as a backup).

## 5. Connect Stripe and test

1. Ian creates the **Stripe** account and completes verification (business
   details + the bank account he gets paid into).
2. Copy the **test** secret key (`sk_test_…`) into the `STRIPE_SECRET_KEY`
   environment variable and redeploy.
3. Build a sticker on the live site and pay with test card
   `4242 4242 4242 4242` (any future expiry, any CVC).
4. Check the payment appears in the Stripe dashboard with the full spec and the
   artwork link in its **metadata**.
5. Swap in the **live** key (`sk_live_…`) and redeploy. You're taking orders.

## 6. Artwork uploads (optional but recommended)

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
