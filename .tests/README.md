# Tests

Cloudflare builds this repo from the root with no build step, so every file is
published on neotype.au unless `.assetsignore` excludes it. That file is what
keeps this directory off the live site — **not** the leading dot. Dot-directories
are served like any other folder here; that was checked on a preview deploy,
where `.tests/email-test.mjs` came back with `application/javascript`.

If you add another folder that shouldn't ship, add it to `.assetsignore` and
verify on the preview URL before merging. Check the **content type**, not the
status code: every missing path on this host answers `200` with `text/html`, so
a status code alone tells you nothing.

Run from the repo root:

    node .tests/email-test.mjs

**email-test.mjs** drives a real HMAC-signed Stripe webhook against a stubbed KV
namespace and a stubbed Resend, and asserts:

- Ian's notification goes to ENQUIRY_TO with Reply-To set to the customer
- the customer's confirmation goes to the customer with Reply-To set to ENQUIRY_TO
- both messages carry a plain-text part
- replaying the same webhook event sends nothing (the de-dup flags hold)

No network, no credentials, nothing to configure.
