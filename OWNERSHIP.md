# Ownership and handover

Who owns the accounts this business runs on, what each one holds, and the order
to move them in.

`handover.html` is the *operating* guide — how Ian runs the shop day to day.
This is the *ownership* one: what makes the business his rather than someone
else's. They are deliberately separate documents, because one is read once and
the other is read whenever something breaks.

Everything marked **verified** below was checked against production on
25 Aug 2026. Everything marked **from the runbook** comes from `CLOUDFLARE.md`
and needs a human with console access to confirm.

> **Where this got to — 25 Aug 2026.** Ian has **Claude** set up with the
> **GitHub**, **Cloudflare** and **Resend** connectors, and has set his own
> admin password and signed off the prices.
>
> **A connector is not access.** It signs in *as Ian* and shows him exactly what
> his own account can see. Verified on 25 Aug: this repository still has
> **one** collaborator, `Wisey6` — so Ian's GitHub connector authenticates
> correctly and then shows him nothing. The same question is open for Cloudflare
> and Resend and has not been verified here.
>
> The site itself is unaffected by any of it: all pages 200, checkout still
> creating live Stripe sessions, every mail record in place.

---

## The short version

If Ian owns **Cloudflare**, **Stripe** and the **domain**, he owns the shop.
Every other row below can wait a week without costing anything.

The GitHub repository is the *least* important item on this list. Code can be
re-cloned from any backup; a Stripe account with the live keys in it cannot.

---

## The accounts

Two different things, and it is worth keeping them apart. **Connector** is
whether Ian's Claude can reach the service. **Access** is whether his login can
see Neotype's data once it gets there. A connector without access is a door onto
an empty room.

| Account | What it holds | Connector | Access |
|---|---|---|---|
| **GitHub** | The source code | ✅ | ❌ **Not a collaborator** — verified 25 Aug, `Wisey6` is the only one |
| **Cloudflare** | The site itself, the KV namespace holding orders and prices, the R2 bucket holding artwork, DNS, and every secret | ✅ | ⬜ Confirm he is a **member of the account holding the Pages project** |
| **Resend** | Order email, enquiry email, and the `/admin` recovery codes | ✅ | ⬜ Confirm it is the account where **`send.neotype.au` is already verified** |
| **Microsoft 365** | `kiko@neotype.au` | — | ✅ Already his |
| **Stripe** | The money. Live keys, and the webhook that records orders | — | 🔄 **Being added** |
| **GoDaddy** | The domain registration for `neotype.au` | — | ✅ Confirmed |
| **Google Business Profile** | The local listing | — | ⬜ **Transfer primary owner** |

The Resend row is the one most easily got wrong. `send.neotype.au` is verified
in **one** Resend account. Signing up a fresh account on a `neotype.au` address
produces a connector that works and a domain that cannot send until DKIM, SPF
and the feedback MX are re-issued and DNS catches up — during which order
confirmations and enquiry notifications stop, silently. Enquiries themselves
survive it, because `/api/enquiry` writes to KV before it tries to email, but
nobody is told they arrived.

Resend is easy to file under "just email" and skip. It was not skipped, and that
matters more than it looks: Resend is what delivers the six-digit code that gets
you back into `/admin` when the password is lost. Without it, a forgotten
password is a lockout rather than an inconvenience.

**Stripe is now the important one.** It is the only remaining account that holds
money rather than infrastructure, and the one thing on this list that cannot be
rebuilt from anything else.

---

## The order to do it in

**1. Set `ADMIN_PASSWORD` to something Ian chose.** ✅ *Done — Ian set his own.*
Cloudflare → Pages → Settings → Variables and Secrets. Add it as a **Secret**,
to **both** Production and Preview. Then have Ian sign in with it.

While he is signed in, run the one test that has never been exercised in
production: switch a finish off, save, reload, confirm it is still off.

A Secret cannot be read back once saved — not by Ian, not by Cloudflare
support, not by whoever typed it. Write it down somewhere real. The recovery
path is described in `CLOUDFLARE.md` §3c and is worth testing once while
someone is watching.

**2. Confirm the prices.** ✅ *Done — Ian signed these off.*
The live table currently reads $150/m² base for stickers, $200 premium,
$50/m² for banners with a $60 minimum, and $58/m² for corflute. A 75 × 75 mm
die-cut matte run of 100 prices at $127. Ian has already set these through
`/admin` and they stuck — this is a yes/no, not a task, but nobody has said the
yes out loud yet.

**3. Move the accounts.** The table above. The domain is confirmed and Stripe is
underway; the Google listing has not started. GitHub, Cloudflare and Resend have
connectors in place and need their **access** confirmed.

**The registrar and the DNS are two different things, and only one of them
moved.** `neotype.au` is still *registered* at GoDaddy — that is the row above,
and it is what actually owns the name. What moved to Cloudflare on 19 Aug is the
*DNS*: the nameservers are `melinda.ns.cloudflare.com` and
`trevor.ns.cloudflare.com`, **verified 25 Aug**, and every record the site and
the mail depend on is served from there. Losing the GoDaddy login still loses the
domain, whoever serves its DNS.

**4. Back up the repository, and add Ian to it.**
Deliberately last, because it is the only step that can break a working deploy.

```sh
# a full mirror — every branch and tag, and every commit on all of them.
# Verified 24 Aug 2026: 81 commits on main, 101 across all branches.
git clone --mirror https://github.com/Wisey6/Neotype-.git neotype-backup.git
tar czf neotype-backup-$(date +%F).tar.gz neotype-backup.git
```

When the transfer happens, Ian creates an **empty** repository — no README, no
`.gitignore`, nothing that would create a conflicting first commit — and:

```sh
cd neotype-backup.git
git push --mirror https://github.com/<ian>/<repo>.git
```

---

## Do not repoint Cloudflare Pages at a new repository in a hurry

A Pages project is bound to its Git source at creation. Changing that source in
practice means creating a new project, which means re-adding:

- the KV namespace binding (orders and prices)
- the R2 bucket binding (artwork)
- every environment variable and secret in `CLOUDFLARE.md` §3
- the custom domain, and waiting on its certificate

That is an hour of work with real downtime risk. Adding Ian as a **collaborator**
on the existing repository gives him full access with none of it, and turns the
ownership move into something scheduled rather than something survived.

---

## `neotype.pages.dev` is load-bearing — leave it alone

The site answers on two hostnames. `neotype.pages.dev` is not a stale preview:
it is a fully working copy of the shop, on the same KV namespace and the same
Stripe account, and an order placed there is a real, correctly priced order that
lands in `/admin` like any other. **Verified.**

**The Stripe webhook points at `neotype.pages.dev/api/stripe-webhook`, and that
is a deliberate choice, not an oversight.** The reasoning is in `CLOUDFLARE.md`
§3b: a webhook fails *silently*, so it should depend on as little as possible.
`pages.dev` depends on Cloudflare alone. `www.neotype.au` also depends on
GoDaddy's DNS, a CNAME, and a certificate — three more things that can be
mid-change while an order is being paid for.

So:

- **Do not** redirect, block, or noindex `*.pages.dev` at the edge. It would stop
  orders being recorded, and it would do it quietly.
- **Do not** "tidy up" by moving the webhook to `www`. That trades a sturdier
  hostname for a more fragile one.
- SEO duplication is already handled — pages served from `pages.dev` carry a
  canonical tag pointing at `https://www.neotype.au/`. **Verified.**

The one thing that genuinely needs writing down: **if this site ever moves off
Cloudflare Pages, the Stripe webhook endpoint must be repointed, or orders stop
being recorded.** Note it wherever hosting changes get planned.

Branch previews are a separate matter and are safe: they have no live KV binding
and no Stripe key, so a preview quotes the shipped default rates rather than
Ian's, and its checkout answers "Payments aren't switched on yet". **Verified** —
a preview reports a base rate of 85 where production reports 150.

---

## State of the site at handover

All **verified** on 24 Aug 2026:

| | |
|---|---|
| Public pages | 7 of 7 return 200 |
| Checkout | All three products create live `cs_live_…` Stripe sessions |
| `/api/orders`, `/api/enquiries` | 401 without authentication |
| Internal documents | 301 to the homepage |
| Apex domain | `neotype.au` → `www`, query string preserved, `/api/*` correctly excluded |
| Stripe webhook | Live on both hostnames; rejects an unsigned request with 400 |
| Test suite | 513 checks across 18 suites, 0 failures |

## What is deliberately unfinished

- **37 recorded `/admin` defects** in `KNOWN-ISSUES.md`, with repro steps. None
  touch payment, pricing or access, which is why they are recorded rather than
  rushed.
- **Three dashboard panels never audited** — Analytics, Receipts, and the layout
  below 940 px. Named here so nobody reads "the dashboard was checked" into a
  document that did not check them.
- **Email hardening** — DMARC `rua`, Microsoft 365 DKIM, SPF `-all`, and DNSSEC
  are all still open. None of them break anything by being open; see
  `MAIL-DNS.md` for the sequencing.
