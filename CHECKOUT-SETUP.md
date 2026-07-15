# Turning on checkout & payments

The customizer is **checkout-ready but switched off**. Today, clicking *Add to
cart* just shows a confirmation — no order reaches Ian. Follow the steps below
to take real orders and card/PayPal payments. Nothing here touches the design;
it's paste-a-key-and-go.

## What you get once it's on

Every order lands in Ian's **Snipcart dashboard** and as an **email**, carrying:

- the money (paid by card or PayPal, straight to Ian's account),
- the full spec — finish, cut, size, quantity, background, cut colour, area,
- a **link to the customer's uploaded artwork** (the actual print file),
- the customer's name, email and shipping address.

Ian still sends a proof and runs the file through his cutter/RIP as usual — the
site's job is to collect the order, file and payment reliably.

## The 3 accounts you need

| # | Service | Why | Cost |
|---|---------|-----|------|
| 1 | **Snipcart** (snipcart.com) | Cart, checkout, order dashboard, emails | 2% per transaction (or a small monthly min). Free while in Test mode. |
| 2 | **Stripe** and/or **PayPal** | Actually takes the payment | Standard card fees (~1.75% + 30c AU). No monthly fee. |
| 3 | **Uploadcare** (uploadcare.com) | Hosts the customer's uploaded artwork so Ian can download it | Free tier covers a small shop. |

## Activation steps (about 30 minutes)

1. **Create a Snipcart account**, then in **Dashboard → Payment gateway**,
   connect **Stripe** (and/or PayPal). Log in to / create Stripe when prompted.
2. In Snipcart **Dashboard → API keys**, copy the **PUBLIC** key (starts with
   a long string — the public key is safe to put on the site).
3. **Create an Uploadcare account** and copy its **Public key**.
4. Open **`customizer.html`**, find this block near the bottom, and paste the
   two keys in:

   ```js
   window.NEOTYPE_CHECKOUT = {
     snipcartKey: "PASTE_SNIPCART_PUBLIC_KEY_HERE",
     uploadcareKey: "PASTE_UPLOADCARE_PUBLIC_KEY_HERE",
     currency: "aud"
   };
   ```

5. In the Snipcart dashboard, add **neotype.au** (and the github.io URL) under
   **Domains & URLs** so checkout is allowed on the live site.
6. Commit and push. The *Add to cart* buttons now open a real cart.
7. **Test first:** keep the Snipcart account in **Test mode** and use Stripe's
   test card `4242 4242 4242 4242` to place a full order end to end. When the
   order (with the artwork link) arrives correctly, switch Snipcart to **Live**.

## One thing to harden before you scale

Prices are calculated in the browser. In Test/early-live that's fine because
**Ian approves every proof before printing**, so a tampered price is caught. To
make pricing tamper-proof at volume, add a small **Snipcart order-validation
webhook** (a tiny serverless function — Cloudflare Workers free tier) that
re-computes the price server-side. Ask the developer to wire this when order
volume justifies it; the pricing formula lives in `assets/js/customizer.js`
(`orderTotal` / `ratePerM2`).

## If you'd rather use the old Shopify store

neotype.au was previously on Shopify. If that store still exists, this site can
instead feed orders into Shopify (using its checkout and payments) rather than
Snipcart. That's a different integration — tell the developer and share the
Shopify store details.
