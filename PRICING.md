# Adjusting prices

**Two ways to change prices:**

1. **No code — the admin page (this is the one for Ian).** Ian opens
   `neotype.au/admin`, enters the admin password, edits any number, and hits
   Save. Every example price on the page updates as he types, so he can see what
   customers will pay before saving. Prices go live on the site **and at
   checkout** immediately — no developer, no redeploy. Saved values override the
   code defaults below.

2. **In code (the defaults / fallback).** The numbers below are the built-in
   defaults, used until the admin saves an override.

---

## One file holds every price

> **`assets/js/pricing-core.js` is the single source of truth.** Nothing else
> contains pricing maths. The browser loads it, the Netlify Function imports it,
> and the admin page's example prices come from it — so the price a customer sees
> is by construction the price their card is charged. There is nothing to "keep
> in sync" any more.

`banners.html` / `corflute.html` hold only presentation (titles, blurbs, size
preset buttons). The old `rate` / `min` / `choices` / `qtys` blocks in those
pages are gone.

## The knobs

### 1. Sticker rate (the big lever) — `stickers.rate`
```js
rate: { base: 85, extra: 120, decay: 0.5 }
// $/m² = base + extra × e^(−area / decay)
```
- `base` — the floor price per square metre (A$) on large orders. Raise this to
  make everything more expensive.
- `extra` — the extra per-m² added to small orders, fading as the order grows.
  This is what creates the bulk discount.
- `decay` — how fast the discount arrives. Bigger = slower. **Not a dollar
  amount** (the admin page renders it without a `$`).

### 2. Minimums
```js
stickers.min = 18   banner.min = 35   corflute.min = 30
```
No order is charged less than its product's minimum. The homepage "from $X"
teasers read these live from `/api/pricing`, so they can't drift.

### 3. Sticker finish / laminate multipliers
```js
"vinyl-matte": 1.00   // baseline
"vinyl-gloss": 1.05   // +5%
"satin":       1.03
"holographic": 1.50   // +50%
"glitter":     1.45
"chrome":      1.60
"clear":       1.15
```
Laminate is **not** a separate control — it's merged into this one list, shown to
customers as "Finish / laminate".

### 4. Sticker shape / cut multipliers
```js
die: 1.00, kiss: 1.02, circle: 0.97, square: 0.95,
rect: 0.96, rounded: 0.97, sheet: 1.10
```

### 5. Turnaround (all three products)
```js
standard: 1.00   // ~4 business days, included
"2day":   1.25   // +25%
nextday:  1.50   // +50%
```

### 6. Sizes & quantities offered
```js
SIZES = [2, 3, 4, 5]                       // inches
QTYS  = [15, 50, 100, 200, 300, 500, 1000] // sticker quantity buttons
LF_META.banner.qtys   = [1, 2, 3, 5, 10, 25]
LF_META.corflute.qtys = [1, 2, 5, 10, 25, 50, 100]
```
These live in `pricing-core.js` and are **not** admin-editable, because the
server validates against the same lists the buttons are built from — that's what
stops a hand-crafted request buying 500 banners at the bulk rate.

## Worked examples (current defaults)
| Order | Price |
|---|---|
| 100 × 3″ matte, die-cut | A$71 |
| 100 × 3″ holographic, die-cut | A$107 |
| 100 × 3″ matte, die-cut, 2-day | A$89 |
| 15 × anything (hits the minimum) | A$18 |
| Banner 3 × 1 m, hemmed + eyelets, qty 1 | A$87 |
| Corflute 900 × 600 mm, 3 mm single, qty 1 | A$31 |

Totals are whole dollars, and the amount charged is that same whole dollar
figure — the big number on screen is exact, not rounded for display.

## Banners & corflute (large format)

`price = width_m × height_m × rate × quantity × bulk-discount × option-multipliers`,
never below `min`. The bulk discount is `0.6 + 0.4 × e^(−(qty−1)/20)`, so the
per-unit price falls as quantity rises.

Per product:
- `rate` — A$ per m² (banner **29**, corflute **58**)
- `min` — minimum charge (banner **35**, corflute **30**)
- `wRange` / `hRange` — allowed size range in metres
  (banner 0.3–6 × 0.3–3 · corflute 0.3–2.4 × 0.3–1.2)
- option groups, each option with its multiplier:
  - **banner** — material, finishing, eyelets, rope, turnaround
  - **corflute** — thickness, print sides, eyelets, turnaround

Example — make double-sided corflute cost more: change `corflute.sides.double`
from `1.65` to `1.80`. Or just do it from `/admin` with no code at all.

## Where these rates came from

Calibrated against real AU vendors: banner against **eprintonline** (their page
quotes A$86.88 for a 3 × 1 m banner; ours returns A$87.00 — a 0.1% match),
corflute against **Vistaprint AU** sizes and options.

> ### ⚠️ Do not "fix" the rates from eprintonline's page source
> Their calculators expose `prod_baseprice` — `36.40` for stickers, `57` for
> banners. **These are setup figures, not per-m² rates.** Proof: at $57/m² a
> 3 × 1 m banner would be $171, double their own published quote. Applying the
> sticker `36.40` as a rate would cut sticker prices 57–70% (100 × 3″ from $71 to
> $21), almost certainly below cost. This has been checked twice; don't
> re-litigate it without new evidence.

## Want to use a printer's exact rate card instead?
If eprintonline (or whoever prints) gives you a fixed A$/m² table per
size/quantity, the formula can be dropped and their exact numbers used. Send the
rate card and the developer will wire it in.
