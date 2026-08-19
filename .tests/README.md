# Tests

Kept in a dot-directory on purpose. Cloudflare Pages builds this repo from the
root with no build step, so anything in a normally-named folder is published on
neotype.au — a `test/` directory ends up served at `https://neotype.au/test/`.
Dot-directories are excluded from the deployed output, which keeps test code off
the client's production site.

Run from the repo root:

    node .tests/email-test.mjs

**email-test.mjs** drives a real HMAC-signed Stripe webhook against a stubbed KV
namespace and a stubbed Resend, and asserts:

- Ian's notification goes to ENQUIRY_TO with Reply-To set to the customer
- the customer's confirmation goes to the customer with Reply-To set to ENQUIRY_TO
- both messages carry a plain-text part
- replaying the same webhook event sends nothing (the de-dup flags hold)

No network, no credentials, nothing to configure.
