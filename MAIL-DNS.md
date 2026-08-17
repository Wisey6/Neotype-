# Email DNS

Separate from the website. Found while moving the site off GitHub Pages; it
predates the website work and is unrelated to it, but it affects the business
directly, so it's written down rather than lost in a chat log.

## ✅ Step 1 done — SPF fixed (17 Aug 2026)

The apex TXT record now reads:

```
v=spf1 include:spf.protection.outlook.com ~all
```

Confirmed against both authoritative nameservers (`ns67`/`ns68.domaincontrol.com`)
directly, not just a public resolver. The `MS=ms80978019` verification record is
untouched.

`~all` (softfail) is deliberate as a landing spot: if any legitimate sender we
haven't discovered yet still sends as `kiko@neotype.au`, it softfails rather than
being rejected while we watch. Tighten to `-all` after a week of clean sending.

**Still outstanding: DKIM and DMARC** — see below. Whether they're urgent depends
on the symptom (see "Which problem is it?").

## Which problem is it?

The fix above only addresses one of two possible symptoms. Send one test email
from `kiko@neotype.au` to a Gmail address, then in Gmail open the message →
⋮ menu → **Show original**, and read the top three lines:

| What you see | What it means | What to do |
|---|---|---|
| `SPF: PASS`, mail in the inbox | It was the hardfail. **Fixed.** | Tighten to `-all` in a week |
| `SPF: PASS` but mail in **spam** | Reputation/alignment, not SPF | Do DKIM + DMARC below |
| `SPF: SOFTFAIL` or `FAIL` | Something else sends as this domain | Find that sender before anything else |

Until that test is run, treat the mail work as **in progress, not finished**.

## The original problem (for the record)

`neotype.au` receives mail on **Microsoft 365**:

```
MX  →  neotype-au.mail.protection.outlook.com
```

The SPF record used to authorise **GoDaddy** mail servers instead:

```
TXT →  v=spf1 include:secureserver.net -all
```

`secureserver.net` expands to GoDaddy's sending servers — it does **not** include
Microsoft's. So mail sent from Microsoft 365 as `kiko@neotype.au` is not
SPF-authorised, and the `-all` at the end is a **hard fail** instruction:
strict receivers (Gmail, Outlook.com, corporate filters) are told to reject it.

Still true today:
- **no DKIM** — `selector1`/`selector2._domainkey` are absent, so there's no
  cryptographic signature to fall back on when SPF fails
- **no DMARC** — no `_dmarc.neotype.au` record, so no policy and no reporting

### Why it matters here
Neotype's workflow is *email the customer a proof and wait for approval*. If
those emails land in spam or bounce, orders stall and it looks like the customer
never replied. Worth fixing before pushing volume through the site.

**Inbound mail is unaffected** — the MX records are correct, so enquiry
notifications sent *to* `kiko@neotype.au` arrive fine. This is purely about mail
sent *from* the domain.

## The fix (in GoDaddy DNS)

**1. Correct the SPF record — but soft-fail first.** Replace the existing TXT
with this, note the `~all` (tilde), not `-all`:

```
v=spf1 include:spf.protection.outlook.com ~all
```

`~all` is *softfail*: unrecognised senders are delivered but marked, rather than
rejected outright. That matters because nobody has yet audited what else sends
as `@neotype.au` — an invoicing tool, a proofing system, a booking platform.
Going straight to `-all` before DKIM exists means any legitimate-but-unlisted
sender disappears silently, which is the exact failure this document is trying
to prevent.

This is also strictly safer than today: the domain is *already* on `-all`, so
anything other than GoDaddy is already hard-failing. `~all` relaxes that while
the correct senders are identified.

Watch for about a week (the DMARC reports in step 3 will show you what's
sending), add an `include:` for anything legitimate you find, and only then
tighten the tail to `-all`.

A domain must have exactly **one** SPF record — add includes to this line rather
than creating a second TXT.

**2. Turn on DKIM.** In the Microsoft 365 Defender portal
(Email & collaboration → Policies → Email authentication → DKIM), enable signing
for `neotype.au`. It then gives you two CNAME records to add.

The targets are **tenant-specific** and cannot be worked out in advance — they
contain Ian's Microsoft tenant name, so they only exist once DKIM is switched
on. They look like this, with `<tenant>` replaced by the real value the portal
displays:

```
selector1._domainkey  →  selector1-neotype-au._domainkey.<tenant>.onmicrosoft.com
selector2._domainkey  →  selector2-neotype-au._domainkey.<tenant>.onmicrosoft.com
```

**3. Add DMARC**, starting in monitor-only mode so nothing breaks:

```
Type: TXT   Name: _dmarc   Value: v=DMARC1; p=none; rua=mailto:kiko@neotype.au
```

Once SPF and DKIM are confirmed passing (the reports will tell you), tighten to
`p=quarantine` and later `p=reject`.

## Order

1. **SPF with `~all`** — fixes the active hard-fail immediately and safely.
2. **DMARC at `p=none`** — start collecting reports so you can see every source
   sending as `@neotype.au`. (Bring this forward of DKIM: it's the instrument
   that tells you what else is out there.)
3. **DKIM** — enable in the Defender portal and add the two CNAMEs it gives you.
4. **Then tighten**: SPF `~all` → `-all`, and DMARC `p=none` → `p=quarantine` →
   `p=reject`, one step at a time, checking reports between each.

> If Ian has an IT provider managing his Microsoft 365, hand them this page —
> it's a routine change for them.
