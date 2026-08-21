# Neotype

Site, live price calculators and order dashboard for **Neotype Studio**, a
custom sticker, banner and corflute printer in Brisbane.

> *A neotype is the specimen chosen to define a species when the original is
> lost — a new defining mark.*

Live at **[neotype.au](https://www.neotype.au)**. Hosted on Cloudflare Pages.

## What it does

Six pages of static HTML and vanilla JavaScript, plus one Cloudflare Pages
Function. No build step, no framework, no bundler — `git push` is the deploy.

| Page | What it is |
| --- | --- |
| `index.html` | Home: finishes, how it works, gallery, FAQ, contact form |
| `customizer.html` | Sticker builder — live preview, live price, artwork upload |
| `banners.html` | Banner builder |
| `corflute.html` | Corflute sign builder |
| `custom-stickers-brisbane.html` | Local SEO landing page |
| `success.html` | Where Stripe returns the customer after paying |
| `admin.html` | `/admin` — the owner's dashboard. Not linked from anywhere |

A customer configures a job, uploads artwork, and pays through Stripe Checkout.
The order lands in `/admin` with the artwork attached, and two emails go out:
one to the studio, one confirming to the customer.

## Two rules the code is built around

**1. One source of truth for every price.** Every figure — stickers, banners,
corflute — comes from `assets/js/pricing-core.js`. The browser loads it as a
script, the Pages Function imports it as a module, and the admin page's live
examples call it. The price a customer is shown is by construction the price
their card is charged.

**2. The browser never sets the amount.** `/api/checkout` re-prices the order
server-side from the same file before creating the Stripe session, so a tampered
page cannot buy anything cheaply.

Prices are stored in Workers KV and edited from `/admin`, so changing them needs
no redeploy and no developer. `PRICING.md` explains every adjustable number.

## The pricing model

Stickers price by area with a fading small-run premium —
`$/m² = 85 + 120 × e^(−area/0.5)` — then finish, cut and turnaround multipliers,
never below the A$18 minimum. Quantity is anything from 15 to 5,000.

There is also an **optional quantity-band table**: a flat rate per cm² that
steps down as the order grows, replacing the curve entirely when switched on.
It ships off. The band editor in `/admin` shows every representative order
before and after so the change is visible before it is made — a per-cm² rate
keyed on quantity cannot distinguish a 2″ sticker from a 5″ one, so switching
over cuts small stickers and raises large ones at low quantity.

Banners and corflute price per square metre with a quantity discount.

## Signing in to /admin

Two ways, because one of them can fail permanently:

- **The password** — `ADMIN_PASSWORD`, a Cloudflare Secret.
- **An emailed code** — six digits sent to the studio mailbox, good for ten
  minutes and five attempts, which buys a 30-day session.

The second exists because a Cloudflare Secret cannot be read back once set. A
forgotten password is not a reset, it is a lockout that would otherwise need a
developer and the Cloudflare dashboard. The code is only ever sent to the
address in config, never to one named in the request.

## Run it locally

```bash
python3 -m http.server 8901     # then http://localhost:8901
```

Pages under `/api` won't answer — the Function needs Cloudflare, or `wrangler
pages dev`. Everything else works, and the price calculators run entirely in the
browser from `pricing-core.js`.

## Layout

```
functions/api/[[route]].js   the entire backend: pricing, checkout, artwork,
                             Stripe webhook, orders, enquiries, admin sign-in
assets/
  css/styles.css             the identity — dark, teal, glitch
  css/admin.css              the dashboard
  js/pricing-core.js         ★ every price and formula. Shared, UMD, no deps
  js/customizer.js           sticker builder
  js/largeformat.js          banner + corflute builders (driven by LF_META)
  js/checkout.js             artwork upload, hand-off to /api/checkout
  js/admin.js                the dashboard
  js/main.js                 nav, reveals, FAQ, toasts, live "from $X" teasers
.tests/                      test suites — see .tests/README.md
```

## Design

Dark synthwave: `#212830` ground, `#06e4dd` teal and `#764cd9` purple as the
brand pair, with Rubik for display and body, Varela Round for UI, Comfortaa for
soft accents. Recurring motifs are die-cut dashed contours, a CMYK bar, and a
glitch treatment on the wordmark. No CSS framework — `styles.css` owns all of it.

## Tests

```bash
python3 -m http.server 8901 &        # the browser suites need this
node .tests/<suite>.mjs
```

Function suites run under plain Node against stubbed KV and Stripe. Browser
suites drive real Chromium via Playwright and **skip** rather than fail when it
isn't present — `playwright-core` is deliberately not in `package.json`, because
declaring it makes Cloudflare run `npm install` on deploy.

## Docs

`PRICING.md` — how to change prices ·
`CLOUDFLARE.md` — hosting, DNS, bindings, the runbook ·
`SETUP.md` — deployment ·
`MAIL-DNS.md` — email records

## Accessibility

Responsive to mobile. Controls carry `aria-pressed` / `aria-expanded`, focus is
always visible, `prefers-reduced-motion` is honoured. Fonts come from Google
Fonts; nothing else is fetched from a third party.
