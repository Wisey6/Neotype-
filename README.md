# Neotype

Marketing site and live sticker customizer for **Neotype**, a custom sticker studio.

> *A neotype is the specimen chosen to define a species when the original is
> lost — a new defining mark.* That idea drives the whole design: every sticker
> is a type specimen, and the site is built to look like a **print proof sheet**.

## What's here

A clean, responsive, single-page site built with **static HTML, Tailwind (via
CDN) and vanilla JavaScript** — no build step, deployable to any static host.

Sections, top to bottom:

1. **Hero** — the thesis: a cluster of die-cut stickers that peel on load.
2. **Finishes** — six materials (vinyl, holographic, glitter, chrome, clear,
   sheets), each with a CSS-rendered finish swatch so you see the material.
3. **Customizer** — the centerpiece. Pick a finish, shape/cut, size and
   quantity; the preview and the **live price** update on every click. Includes
   drag-and-drop artwork upload with an image preview.
4. **How it works** — the four-step proof workflow.
5. **Stats** — turnaround, rating, orders, reorder rate.
6. **Gallery** — a "specimen sheet" wall of sample marks.
7. **FAQ** — accordion covering files, minimums, durability, proofs, shapes.
8. **Footer** — links, newsletter, legal.

## Design system

| Role | Choice |
| --- | --- |
| Ink | `#121016` |
| Paper | `#EFEEE9` |
| Signature accent | Ultra-blue `#2E2BF5` |
| Functional CMYK | Cyan `#00AEEF` · Magenta `#EC008C` · Yellow `#FFD400` |
| Display type | Bricolage Grotesque |
| Body / UI type | Inter |
| Spec / label type | Space Mono |

**Signature motifs:** die-cut (dashed) contour outlines, corner registration /
crop marks, and a recurring CMYK color bar.

## The pricing model

Every price — stickers, banners and corflute — comes from one file,
**`assets/js/pricing-core.js`**. The browser loads it as a script, the Netlify
Function imports it, and the admin page's live examples call it, so the price a
customer is shown is by construction the price their card is charged.

Stickers are priced by area with a fading small-run premium
(`$/m² = 85 + 120 × e^(−area/0.5)`), then finish, cut and turnaround
multipliers, never below a A$18 minimum. Banners and corflute are priced per
square metre with a quantity discount. Full details and every adjustable number
are in **`PRICING.md`**.

Payment is real: `/api/checkout` re-prices the order **server-side** and creates a
Stripe Checkout Session, so the amount charged never comes from the browser. Ian
can change any price from `neotype.au/admin` with no redeploy.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## File layout

```
index.html               # home
customizer.html          # sticker builder
banners.html             # banner builder
corflute.html            # corflute builder
admin.html               # /admin — Ian's pricing editor (password guarded)
success.html             # post-payment landing
assets/
  css/styles.css         # design system + signature motifs + responsive + a11y
  js/pricing-core.js     # ★ every price and formula — the single source of truth
  js/customizer.js       # sticker builder: state, live quote, artwork preview
  js/largeformat.js      # banner + corflute builders (driven by LF_META)
  js/admin.js            # pricing editor with live example prices
  js/checkout.js         # artwork upload + hand-off to /api/checkout
  js/main.js             # nav, scroll reveals, FAQ, toasts, "from $X" teasers
netlify/functions/api.mjs # /api/pricing, /api/verify, /api/checkout (Stripe)
netlify.toml             # hosting config, headers, /admin rewrite
```

Docs: **`PRICING.md`** (how to change prices) · **`SETUP.md`** (deploy + DNS) ·
**`MAIL-DNS.md`** (email records).

## Accessibility & quality

- Responsive down to mobile; controls use `aria-pressed` / `aria-expanded`.
- Visible keyboard focus; `prefers-reduced-motion` honored.
- Fonts loaded from Google Fonts; everything else is self-contained.
