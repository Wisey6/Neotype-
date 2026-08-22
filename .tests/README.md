# Tests

Cloudflare Pages publishes the whole repository, this directory included. Two
attempts to prevent that both failed, each verified on a preview deploy:

| Attempt | Result |
|---|---|
| Put it in a dot-directory | Served — a leading dot means nothing to Pages |
| `.assetsignore` at the root | Served — that is a Workers Static Assets feature, not Pages |

Pages has no repo-level exclude. What works is `_redirects`, which is documented
to be consulted *"regardless of whether or not an asset matches the incoming
request"* — so `/.tests/*` 301s to the homepage while the files stay in the repo.
That is shipped; see the comment in `_redirects` before adding a new internal
document, because a new one needs a line there in the same commit.

When you check it, check the **content type**, not the status code — every
missing path on this host answers `200` with `text/html`, so a status code alone
tells you nothing.

Run from the repo root:

    node .tests/email-test.mjs

**email-test.mjs** drives a real HMAC-signed Stripe webhook against a stubbed KV
namespace and a stubbed Resend, and asserts:

- Ian's notification goes to ENQUIRY_TO with Reply-To set to the customer
- the customer's confirmation goes to the customer with Reply-To set to ENQUIRY_TO
- both messages carry a plain-text part
- replaying the same webhook event sends nothing (the de-dup flags hold)

No network, no credentials, nothing to configure.

**visual-verify.mjs** drives a real Chromium against a locally served copy of the
site and asserts the layout numbers rather than eyeballing screenshots — logo and
nav heights, the newsletter form's absence, the footer column count, the upload
control, and the mobile header's share of the viewport. It also writes PNGs.

    python3 -m http.server 8901 &
    mkdir -p /tmp/pw && (cd /tmp/pw && npm i playwright-core)
    NODE_PATH=/tmp/pw/node_modules node .tests/visual-verify.mjs ./shots

`playwright-core` is deliberately kept OUT of `package.json`. Cloudflare runs
`npm install` whenever this repo declares a dependency, and that install step is
what stalled production deploys for a day. Both browser tests skip with a message
rather than crashing when it is missing, because ERR_MODULE_NOT_FOUND reads as a
broken test and a broken test gets deleted.

Written after the doubled logo silently pushed the /admin sidebar behind the sticky
header: the change looked fine on the page it was made for and broke a different
page two files away. Measurements catch that; a glance does not.

**stock-toggle.mjs** covers the availability switches end to end: that
`pricing-core` refuses to price a switched-off option for both stickers and large
format, that the switch in /admin flips and reaches the save payload, and that the
button disappears in the customizer.

    NODE_PATH=/tmp/pw/node_modules node .tests/stock-toggle.mjs ./shots

The server-side half matters most. Hiding a button stops an honest customer and
nobody else — a stale tab or a hand-made request still reaches /api/checkout.

**lf-quantity.mjs** covers banner and corflute quantity. The preset row used to
be the whitelist too, so seven banners was unbuyable — you rounded to five or
ten. It asserts every integer up to the ceiling prices, that the ceiling still
refuses everything past it, that more never costs more per unit, and then drives
both builders in Chromium.

    NODE_PATH=/tmp/pw/node_modules node .tests/lf-quantity.mjs

Its last third is the part worth keeping. `largeformat.js` rebuilds the whole
panel when the live price list arrives, replacing every element and with them
every listener attached to one — which had left the banner and corflute pages
with a dead upload box, dead size fields and a **dead checkout button** a few
hundred milliseconds after load, on every real visit. Nothing threw, and the
panel looked perfectly normal. Those checks run deliberately *after* the rebuild.
