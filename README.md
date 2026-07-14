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

## The customizer pricing model

Prices are illustrative but consistent (see `assets/js/customizer.js`). Per
sticker: `0.21 × area^0.82 × finish × shape × quantity-discount`, with a `$0.30`
floor. It is front-end only — **no backend, no real payment**. "Add to cart" and
"Get a free proof" fire confirmation toasts; wire them to a real cart/checkout
and proofing backend when ready.

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## File layout

```
index.html
assets/
  css/styles.css        # design system + signature motifs + responsive + a11y
  js/customizer.js       # configurator state + live price + upload preview
  js/main.js             # nav, scroll reveals, FAQ, toasts, newsletter
```

## Accessibility & quality

- Responsive down to mobile; controls use `aria-pressed` / `aria-expanded`.
- Visible keyboard focus; `prefers-reduced-motion` honored.
- Fonts loaded from Google Fonts; everything else is self-contained.
