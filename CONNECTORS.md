# Connectors — giving Ian his own Claude

Ian is setting up Claude Pro on a `neotype.au` address and connecting **GitHub**,
**Cloudflare** and **Resend**.

`OWNERSHIP.md` is the document that decides *which accounts become his*, and in
what order. This one assumes that work is happening and covers the part it
doesn't: which connectors to add, what each one is actually good for, and what
not to do through them.

The two are linked more tightly than they look. A connector is only a doorway —
it reaches each service **as Ian**, using his own login, and can therefore see
exactly what his account can see and nothing more. So every row in
`OWNERSHIP.md` that hasn't happened yet is a connector that authenticates
perfectly and then shows him an empty shelf.

---

## What has to exist first

| Connector | Blocked on | Where it's decided |
|---|---|---|
| **GitHub** | An invite. Today `Wisey6/Neotype-` has exactly **one** collaborator, `Wisey6` | `OWNERSHIP.md` — *"Collaborator now, transfer later"* |
| **Cloudflare** | Being added as a member of the account holding the Pages project, KV, R2 and DNS | `OWNERSHIP.md` — *"Add Ian as a member"* |
| **Resend** | Being added to the **existing** Resend account | `OWNERSHIP.md` — *"Add Ian"* |

### ⚠️ Read that last row as written: *add Ian to* Resend

`send.neotype.au` is verified in **one** Resend account. "Everything on his
`neotype.au` domain" is exactly the instruction that produces a fresh signup
instead — and a new account cannot send from the domain until it is verified
there, which means re-issuing DKIM, SPF and MX and waiting on DNS.

`OWNERSHIP.md` already flags why Resend is the row people wrongly skip: it
carries the six-digit code that gets you back into `/admin` when
`ADMIN_PASSWORD` is lost, and a Secret cannot be read back once saved. So while
that verification gap is open, a forgotten password is a lockout — alongside
silently missing order confirmations and enquiry notifications.

Enquiries themselves survive it. `/api/enquiry` writes every one to KV *before*
it tries to email, so nothing is dropped. But nobody gets told.

---

## Adding them — Ian's side

Claude Pro is enough; custom connectors work on Free, Pro, Max, Team and
Enterprise, and only Free is capped at one.

**Customize → Connectors → `+`**

| Connector | How |
|---|---|
| **GitHub** | From the connectors directory — listed, no URL needed |
| **Cloudflare** | Add custom connector → `https://mcp.cloudflare.com/mcp` |
| **Resend** | Add custom connector → `https://mcp.resend.com/mcp` |

Each opens a browser window to sign in to that service and approve access. That
sign-in is what scopes it.

Cloudflare also publishes narrower servers if the single endpoint is noisier
than he wants — `https://bindings.mcp.cloudflare.com/mcp` for Workers/Pages, KV
and R2, `https://observability.mcp.cloudflare.com/mcp` for logs and analytics.

---

## What each is actually good for

**GitHub** — reading. The code, its history, and why something is the way it is.
`KNOWN-ISSUES.md` is the honest list of what's still wrong with `/admin`, so
"is this a bug or is it me?" is a question he can now answer himself. Raising an
issue is the right way to report one.

**Cloudflare** — the operational view. Whether the last deploy succeeded, what's
in the `NEOTYPE` KV namespace (prices, orders, enquiries) and the `ART` R2
bucket (customer artwork), and the logs when something looks wrong.

**Resend** — the question customers actually ask. *Did my confirmation arrive?*
Delivery logs, bounces, what was sent and when.

---

## The rails

- **`/admin` is still the front door**, and `handover.html` is still the guide to
  it. Prices, quantity bands, orders, enquiries and artwork all live there and
  need no connector at all. Reach for a connector when `/admin` can't answer the
  question, not before.
- **Don't edit KV keys by hand.** Prices written straight into KV bypass the
  editor's before/after preview, which exists so a rate change is visible
  *before* it is live.
- **Don't touch the DNS zone.** `neotype.au` runs Microsoft 365 email. Its SPF,
  MX and verification records have been broken once and repaired already —
  `MAIL-DNS.md` is the record of that. Website records only, and knowingly.
- **Don't change `RESEND_API_KEY` or `ENQUIRY_FROM` casually.** An unverified
  sender means Resend rejects the mail and order emails stop with no error
  anyone sees.
- **Secrets are one-way.** `ADMIN_PASSWORD`, `STRIPE_SECRET_KEY` and
  `STRIPE_WEBHOOK_SECRET` cannot be read back from Cloudflare once saved — not
  by Ian, not by Claude, not by Cloudflare support. Claude can confirm a secret
  *is* set. It cannot say what it says.
- **A push to `main` is a deploy.** No build step, no staging gate between the
  repo and the live storefront. Worth knowing before choosing what the GitHub
  invite carries — which is why `OWNERSHIP.md` says collaborator now, transfer
  later.

---

## Sources

- [Custom connectors on Pro](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Cloudflare's remote MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/)
- [Resend's remote MCP server](https://resend.com/docs/mcp-server)
- [GitHub connector](https://claude.com/connectors/github)
