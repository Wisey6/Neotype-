# Neotype Phase 2: Client Feedback — Discovery Notes
Date: 2026-08-19 · Goal: turn Ian's nine-point feedback into a scoped, buildable plan

## Summary / key decisions

| # | Ask | Decision |
|---|---|---|
| 5 | Add to cart | **Full multi-item cart** — stickers + banners + corflute, one payment |
| — | Order shape | **One order, N line items.** One card, one due date, one proof cycle |
| 8 | Price floor | **Get Ian's cost per m² first.** Model already caps, at 2× where he's pointing |
| 1 | "Samples" | **Demo art for the preview only** — never orderable, never satisfies artwork |
| 7 | Blog | **5–8 evergreen guides**, one per real search intent. Not a page of filler |
| 3/4 | Option control | *Open — resume here* |
| 2 | Upload button | Not broken. Affordance problem — see below |
| 6 | Socials | Not yet discussed |
| 9 | Custom qty / custom size | Not yet discussed |


### The raw feedback, verbatim
1. Stickers customizer — option to either upload design, **or have samples**
2. **Missing upload button**
3. Turn on/off options (gloss/holo etc) — "out of stock type shit"
4. Add options or modify
5. **Add to cart** instead of straight to checkout
6. Socials — IG, FB links
7. **Blog tab** ("what ?") — helps with SEO. Reference: kingsofneon.com.au/pages/learning-hub —
   "just a page full of words/sentences that relates, so it search engine optimization type shit"
8. **Custom size**, W × H, priced per sqm, price shrinks as qty goes up.
   Reference: eprintonline pricing — "sort of caps out to 10c somehow, not sure"
9. **Custom quantity** for ordering

---

## Pre-answered by reading the code (not asked)

### #2 — "Missing upload button" is a perception problem, not a bug
The upload works today. `customizer.html:139` renders a `.dropzone` with a hidden
`<input type="file">`, and `customizer.js:612–613` binds click and Enter/Space to
open the picker. Same pattern on banners and corflute (`largeformat.js:219`).

So nothing is broken. What's wrong is the **affordance**:
- It reads as a dashed drop area, not a button. Copy is "Drop your file or browse" —
  "browse" is the clickable part and it's the least prominent word.
- On a phone there is no drag-and-drop, so "Drop your file" describes something the
  user cannot do, and the actual action is buried.
- The label says **"optional for now"**, which invites skipping it entirely.

Likely fix: a real, filled button labelled "Upload artwork" as the primary element,
with drag-and-drop demoted to a hint. Needs confirming against how Ian hit it.

---

## Q&A log
_(appended one answer at a time)_

### Q1 — What "add to cart" actually means
- **Asked:** does Ian want a real multi-item cart, sticker variants only, or just a review step before Stripe?
- **Decided: full multi-item cart.** Stickers, banners and corflute together in one
  purchase, one payment, one order in /admin.
- **Consequences to design for:**
  - Stripe Checkout takes multiple `line_items` — the session already builds one, so
    this is an extension rather than a rewrite, but every price must still be
    computed server-side. The browser must never post a total.
  - The order record is currently one product per order (`toOrder` flattens
    quantity/size/finish/shape onto the order). A cart order has N items, so either
    the record grows an `items[]` array or one purchase writes N order rows.
    **This is the key schema decision** — it changes /admin, the pipeline cards,
    the emails and Analytics.
  - Artwork is currently one file per order. A cart needs one file per line.
  - The pipeline stage (new → proof → approved → shipped) is per-order today. With
    multiple items, does a proof cover the whole order or each item? Ian works the
    order as one job, so per-order is probably right, but it needs saying.
- **Flags:** schema shape (items[] vs N rows) → decide with Tyler before building


### Q2 — Order shape for a multi-item purchase
- **Asked:** one order with 3 line items, three separate orders, or one order splittable on the floor?
- **Decided: one order, N line items.** One pipeline card, one due date, one proof
  cycle, one "Mark shipped". Expandable to see each item and download each file.
- **Why it's right:** matches how Ian works — one customer, one job bag, one parcel —
  and one payment stays one row, so Analytics doesn't multiply orders.
- **What this settles:**
  - Order record grows `items[]`; `toOrder` stops flattening one product onto the order.
  - Artwork moves from one file per order to one per item.
  - Pipeline stage stays **per-order**, not per-item.
  - Due date comes from the **longest** turnaround in the order — the parcel ships
    when the slowest item is ready. (Needs confirming, but it's the only reading
    that doesn't promise a date the shop can't hit.)
- **Back-compat:** every existing order has no `items[]`. /admin must render old
  records as a single implicit item, exactly as the missing-`status` case is handled
  today, or the dashboard breaks on historical orders.
- **Flags:** none — schema flag from Q1 is now resolved

### Q3 — The "caps out to 10c" price floor
- **Asked:** drop the floor to hit ~10c, leave pricing and fix presentation, or get Ian's cost first?
- **Decided: get Ian's actual cost per m² before touching the numbers.**

**The model already caps out.** `ratePerM2 = base + extra · e^(−area/decay)`
= `85 + 120·e^(−A/0.5)`, which asymptotes to **$85/m²**. Ian's instinct is right —
it just caps higher than he expects. Measured at current settings:

| size | 15 | 100 | 500 | 1000 | floor |
|---|---|---|---|---|---|
| 2″ | 120c | 40.4c | 24.3c | 22.1c | **21.9c** |
| 3″ | 120c | 71.2c | 49.6c | 49.4c | **49.4c** |

Flat by 500. The discount exists; it bottoms out at roughly 2× where Ian is pointing.

**Why a flat 10c cap cannot exist in a per-sqm model.** A 3″ sticker is ~2.2× the
area of a 2″, so any per-m² floor produces a different per-sticker floor at each
size. To hit 10c on a 2″ the floor would need to be ~$39/m², which puts a 3″ at
~23c, not 10c. eprintonline's "10c" is almost certainly *one size at max qty*, not
a universal cap. Worth checking which size their 10c refers to.

**Why this is Ian's call, not a UI tweak.** Halving the floor halves revenue on
every large order — 1000 × 3″ goes from **$494 to roughly $250**. That is a margin
decision and it needs his real cost behind it.

- **Action:** ask Ian for material + machine cost per m², set the floor from that
  with a deliberate margin, then show him the new curve *before* it goes live.
- **Note:** option 3 is still worth doing regardless — the per-sticker price and a
  savings tier table are currently invisible on the customizer, so a customer at
  500 units cannot see that they are getting a discount at all.
- **Flags:** cost per m² → Ian; which size eprintonline's 10c refers to → Ian

### Q4 — What "or have samples" means
- **Asked:** ready-made designs to buy, a physical sample pack, or demo art to preview with?
- **Decided: demo art for the preview.** Placeholder artwork so the customizer isn't
  empty before a file is uploaded — the customer can play with finish, shape and size
  and see what they're choosing. Nothing is sold and nothing is printed from it.
- **Scope: small.** A handful of sample marks bundled as static assets, a picker
  beside the dropzone, and the preview renders the chosen one. No storage, no
  licensing, no ordering path.
- **Must not be confusable with ordering it.** The single biggest risk is a customer
  configuring a demo mark, checking out, and expecting that design printed. Guard
  rails needed:
  - the demo art must be visibly labelled as a preview, not a file they supplied
  - selecting a demo must **not** satisfy the artwork requirement at checkout
  - the order must never carry a demo as `artwork` — /admin already warns
    "No artwork file — chase the customer for it", and that must still fire
- **Ties to #2 (missing upload button):** demo art makes the upload affordance *more*
  important, not less — if a sample fills the preview, an unclear upload control
  becomes much easier to skip past entirely. These two should be designed together.
- **Flags:** none

### Q5 — The blog / learning hub
- **Asked:** 5–8 evergreen guides, a real blog with cadence, or one long hub page?
- **Decided: 5–8 evergreen guides, written once**, on the same template as
  `custom-stickers-brisbane.html` — which is already built, already indexed, and
  already proves the pattern.

**Push back on the brief itself.** Ian's description — *"just a page full of
words/sentences that relates, so it search engine optimization type shit"* — is the
2010 playbook. Google's helpful-content system now actively demotes thin pages
written for search engines rather than people. Word count is not the ranking signal;
answering a real question better than the competition is. A page of filler would
cost effort and could drag the whole domain down.

**What actually ranks:** one page per question a real customer types.
Candidate set, each a genuine search intent:
- how to set up artwork for die-cut stickers (bleed, cut line, 300 DPI)
- vinyl vs holographic vs glitter — which survives outdoors in Queensland sun
- what file formats a printer actually wants, and why PDF beats JPG
- how the proofing process works and why nothing prints before approval
- sticker sizes explained, with what fits on a laptop / bottle / hard hat
- corflute vs banner for a real estate sign

**Why not one long page:** one page targets one intent. Six focused pages can rank
for six different searches; one long page competes with itself and ranks for none
of them well.

**Why not a dated blog:** cadence is a commitment. Three posts abandoned in 2026
signals a dead business to customers and to Google. Evergreen guides have no
expiry and need no upkeep.

- **Still true:** the highest-leverage SEO action remains the Google Business
  Profile (task #25), which is off-site and outranks anything written on the site.
- **Flags:** who writes the guides — Tyler drafting, Ian reviewing for accuracy? → Tyler + Ian

### Q6 — Scope of option control (ASKED, NOT ANSWERED — session paused here)
- **Asked:** on/off toggles only, toggles plus rename/reprice, or full add-your-own options?
- **Not answered.** Resume here.
- **Constraint found while preparing the question, worth keeping either way:**
  every finish has hand-authored CSS. `.fin-chrome` is an animated gradient
  (`styles.css:350`), `.fin-glitter` a radial with an overlay (`:341`), and the
  customizer preview has its own separate treatment (`.cz-chrome`, `:389`).
  A finish added purely as config would render with **no swatch and no preview**.
  So "add options" cannot be a data-only feature — it needs CSS per option, which
  means it is not something Ian can complete on his own from /admin.
- **Recommendation standing:** on/off toggles solve the stated pain (selling
  holographic he cannot print) at a fraction of the cost, and repricing already
  exists in the Pricing tab today.

---

## Open flags (pending input)
- Which device/browser was Ian on when he couldn't find the upload button? → Ian
- Who writes the 5–8 guides, and who checks them for print accuracy → Tyler + Ian
- Material + machine cost per m², to set the new price floor → Ian
- Which sticker size eprintonline's "10c" actually refers to → Ian
