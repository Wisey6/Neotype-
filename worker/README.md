# Neotype checkout Worker

A tiny Cloudflare Worker that turns the customizer into a real self-serve
checkout. The browser sends only the chosen options; the Worker validates them,
**recomputes the price server-side** (so it can't be tampered with), and creates
a **Stripe Checkout Session**. Stripe hosts the payment page and takes the card;
the only fee is Stripe's standard card fee — no platform markup.

## What you need
- A **Cloudflare** account (free) with `wrangler` installed: `npm i -g wrangler`
- A **Stripe** account (Ian's) with a secret key

## Deploy (about 10 minutes)

```bash
cd worker
npm install

# 1. Log in to Cloudflare
wrangler login

# 2. Store the Stripe SECRET key (starts sk_test_… then sk_live_…). Never commit it.
wrangler secret put STRIPE_SECRET_KEY

# 3. (optional) edit wrangler.toml if the domains/URLs differ
#    ALLOWED_ORIGIN / SUCCESS_URL / CANCEL_URL

# 4. Ship it
wrangler deploy
```

`wrangler deploy` prints a URL like
`https://neotype-checkout.<subdomain>.workers.dev`. Copy it.

## Wire it to the site
In `customizer.html`, set:

```js
window.NEOTYPE_CHECKOUT = {
  workerUrl: "https://neotype-checkout.<subdomain>.workers.dev",
  uploadcareKey: "your_uploadcare_public_key",
  currency: "aud"
};
```

Commit + push. The customizer's checkout button now sends customers to Stripe.

## Test before going live
1. Keep Stripe in **Test mode** and put the **test** secret key in the Worker.
2. On the site, build a sticker and check out with test card
   `4242 4242 4242 4242`, any future expiry, any CVC.
3. Confirm the payment appears in the **Stripe dashboard** with the sticker
   spec + artwork link in the payment's **metadata**.
4. Swap the Worker secret for the **live** `sk_live_…` key
   (`wrangler secret put STRIPE_SECRET_KEY` again) and you're live.

## Pricing admin (client edits prices, no redeploy)

`admin.html` lets Ian change any price from the browser. It reads/writes the
price list in a Cloudflare **KV** store via this Worker. To enable it:

```bash
# 1. Create the KV store, then paste the printed id into wrangler.toml
wrangler kv namespace create PRICING_KV

# 2. Set the admin password (guards saving)
wrangler secret put ADMIN_PASSWORD

# 3. Deploy
wrangler deploy
```

Then set `workerUrl` in **admin.html** (same Worker URL as checkout). Ian opens
`neotype.au/admin.html`, enters the password, edits numbers, hits Save — the
site and checkout use the new prices immediately. Until KV is set up, everything
uses the built-in DEFAULT_PRICING and the site is unaffected.

## Keeping the price in sync
The pricing constants at the top of `src/index.js` **must match**
`assets/js/customizer.js` (`FINISH`, `SHAPE`, `SIZES`, `QTYS`, `MIN_ORDER`,
`ratePerM2`). If the price model changes on the site, update it here too and
re-deploy, otherwise Stripe will reject mismatched orders.

## Order notifications
Ian gets each order in the **Stripe dashboard** (with metadata) and via Stripe's
built-in payment emails (Stripe → Settings → Emails). Want a nicer branded email
with the artwork link? Add a Stripe **webhook** to this Worker later
(`checkout.session.completed` → send an email). Not required for launch.
