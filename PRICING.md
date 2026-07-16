# Adjusting prices

All sticker pricing is driven by a few numbers. To change prices you edit those
numbers — no formulas to untangle. **Two files must stay in sync** so the price
the customer sees matches what Stripe charges:

1. `assets/js/customizer.js` — what the customer sees (top of file, "Pricing model")
2. `worker/src/index.js` — what Stripe charges (top of file, same constants)

Change both to the same values and re-deploy the Worker (`cd worker && wrangler deploy`).

> Tip: keep this simple — if you only ever change the numbers below and keep the
> two files identical, pricing stays correct.

## The knobs

### 1. Base rate (the big lever)
```js
function ratePerM2(totalArea) { return 85 + 120 * Math.exp(-totalArea / 0.5); }
```
- `85` = the floor price per square metre (A$) for large orders. Raise this to
  make everything more expensive.
- `120` = the extra per-m² added to small orders (the "small order" premium that
  fades as the order gets bigger). This is what creates the bulk discount.
- `0.5` = how fast the discount kicks in. Bigger number = discount arrives slower.

### 2. Minimum order
```js
var MIN_ORDER = 18;   // no order is charged less than A$18
```

### 3. Finish multipliers (price × these)
```js
"vinyl-matte": 1.00   // baseline
"vinyl-gloss": 1.05   // +5%
"holographic": 1.50   // +50%
"glitter":     1.45
"chrome":      1.60
"clear":       1.15
```
e.g. change `holographic` to `1.60` to charge 60% more for holographic.

### 4. Shape multipliers (price × these)
```js
die: 1.00, kiss: 1.02, circle: 0.97, square: 0.95,
rect: 0.96, rounded: 0.97, sheet: 1.10
```

### 5. Sizes & quantities offered
```js
SIZES = [2, 3, 4, 5]                       // inches
QTYS  = [15, 50, 100, 200, 300, 500, 1000] // quantity buttons
```
If you add a size/qty here, add the matching button in `customizer.html`.

## Worked examples (current settings)
| Order | Price |
|---|---|
| 100 × 3″ vinyl matte, die-cut | ~A$71 |
| 100 × 3″ holographic, die-cut | ~A$107 |
| 15 × 4″ vinyl matte, circle | ~A$26 |
| 15 × anything (hits the floor) | A$18 |

## Want to switch to your printer's exact rate card?
If eprintonline (or whoever prints) gives you a fixed A$/m² table, we can drop
the formula entirely and use their exact numbers per size/quantity. Send the
rate card and the developer will wire it in.
