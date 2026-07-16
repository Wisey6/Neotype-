# Turning on checkout & payments (Stripe direct)

The customizer is **checkout-ready but switched off**. Today, clicking checkout
just shows a confirmation — no order or payment reaches Ian. This site takes
card payments **directly through Stripe**, so the only fee is Stripe's standard
card fee — **no cart-platform markup**.

## How it works

```
Customer designs → uploads artwork → clicks checkout
        │
        ├─ artwork uploaded to a file host (Uploadcare) → link
        │
        ├─ options sent to a tiny Cloudflare Worker, which RECOMPUTES the price
        │  server-side (so it can't be tampered with) and creates a Stripe
        │  Checkout Session
        │
        └─ customer is sent to Stripe's secure page, pays by card
                 │
                 └─ payment + full spec + artwork link land in Ian's Stripe
                    dashboard; customer gets a receipt and a thank-you page
```

Ian still emails a proof and prints as usual — this collects the order, file and
money automatically.

## What Ian gets per order
- The payment (card), straight to his Stripe balance → his bank.
- The full spec (finish, cut, size, qty, background, cut colour) in the Stripe
  payment's **metadata**.
- A **link to the customer's uploaded artwork** (the print file).
- Customer name, email, phone and shipping address (collected by Stripe).

## Accounts needed

| Service | Why | Cost |
|---|---|---|
| **Stripe** | Takes the card payment, dashboard, receipts | ~1.75% + 30¢ per AU card. No monthly fee. |
| **Cloudflare** | Runs the tiny price/checkout Worker | Free tier is plenty. |
| **Uploadcare** | Hosts the customer's artwork so Ian can download it | Free tier covers a small shop. |

There is **no 2% platform fee** — that's the point of this route.

## Setup (about 30–40 min, done by the developer)

1. **Stripe:** create the account, finish verification (business details + bank
   account for payouts). Copy the **secret key** (`sk_test_…`, later `sk_live_…`).
2. **Deploy the Worker** in the `worker/` folder — full steps in
   `worker/README.md`. In short:
   ```bash
   cd worker && npm install
   wrangler login
   wrangler secret put STRIPE_SECRET_KEY   # paste Stripe secret key
   wrangler deploy                          # prints the Worker URL
   ```
   The Stripe secret key lives only in the Worker — never on the website.
3. **Uploadcare:** create the account, copy the **Public key**.
4. In **`customizer.html`**, fill in the config block near the bottom:
   ```js
   window.NEOTYPE_CHECKOUT = {
     workerUrl: "https://neotype-checkout.<subdomain>.workers.dev",
     uploadcareKey: "PASTE_UPLOADCARE_PUBLIC_KEY",
     currency: "aud"
   };
   ```
5. Commit + push. Checkout is now live-ready.

## Test before going live
1. Keep Stripe in **Test mode**; put the **test** secret key in the Worker.
2. Build a sticker on the site and check out with test card
   `4242 4242 4242 4242` (any future expiry, any CVC).
3. Confirm the payment shows in the **Stripe dashboard** with the sticker spec +
   artwork link under the payment's metadata, and that the thank-you page loads.
4. Swap the Worker's secret for the **live** key and you're taking real orders.

## Keep prices in sync
The price formula lives in **two** places that must match:
`assets/js/customizer.js` (what the customer sees) and `worker/src/index.js`
(what Stripe charges). If you change pricing, update both and re-deploy the
Worker, or Stripe will charge a different amount than the site showed.

## Banners & corflute
The banner and corflute pages check out through the **same Worker and Stripe
account** — no extra setup. Once `workerUrl` is configured in each page's
`NEOTYPE_CHECKOUT` block, all three products take payment.

## Enquiry form (contact form → Ian's email)
The homepage contact form is off until you connect **Web3Forms** (free):
1. Sign up at **web3forms.com**, enter Ian's email, copy the **access key**.
2. In `index.html`, set:
   ```js
   window.NEOTYPE_CONTACT = { web3formsKey: "PASTE_WEB3FORMS_ACCESS_KEY" };
   ```
3. Push. Enquiries now email Ian. (Until then, the form just shows a friendly
   thank-you and sends nothing.)

## Nice-to-have later
- A branded order email to Ian with the artwork link (add a Stripe webhook to
  the Worker: `checkout.session.completed`). Not needed for launch — Stripe's
  own payment emails + dashboard already carry everything.
