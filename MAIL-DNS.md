# Email DNS — needs attention (separate from the website)

Found while moving the site to Netlify. **Nothing here was changed** — this is
Ian's mail configuration and his call. It predates the website work and is
unrelated to it, but it affects the business directly, so it's written down
rather than lost in a chat log.

## The problem

`neotype.au` receives mail on **Microsoft 365**:

```
MX  →  neotype-au.mail.protection.outlook.com
```

But the SPF record still authorises **GoDaddy** mail servers:

```
TXT →  v=spf1 include:secureserver.net -all
```

`secureserver.net` expands to GoDaddy's sending servers — it does **not** include
Microsoft's. So mail sent from Microsoft 365 as `kiko@neotype.au` is not
SPF-authorised, and the `-all` at the end is a **hard fail** instruction:
strict receivers (Gmail, Outlook.com, corporate filters) are told to reject it.

There is also:
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

**1. Correct the SPF record.** Replace the existing TXT:

```
v=spf1 include:spf.protection.outlook.com -all
```

If anything else legitimately sends as `@neotype.au` (a CRM, a newsletter tool),
add its include before the `-all` rather than creating a second SPF record —
a domain must have exactly one.

**2. Turn on DKIM.** In the Microsoft 365 Defender portal
(Email & collaboration → Policies → Email authentication → DKIM), enable signing
for `neotype.au`. It will give two CNAME records to add:

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

Do SPF first — it's the one actively hard-failing. DKIM next. DMARC last, and
leave it at `p=none` for a few weeks before tightening.

> If Ian has an IT provider managing his Microsoft 365, hand them this page —
> it's a routine change for them.
