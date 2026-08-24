# Known issues in /admin

Found by driving the dashboard in a real browser on 24 Aug 2026, the night
before handover. Everything here is reproducible; nothing here is speculation.

**What was fixed that night** are the four that could cost money or lock Ian
out — they are marked FIXED below and shipped in PR #17. The rest were left
alone deliberately: none of them touch payment, pricing or access, and
handover night is the wrong time to change code that is working.

Severity is the auditor's, kept as reported. `blocker` here means "a user hits
a dead end", not "the site is down" — the site is not down.

## Sign in and session

### ✅ FIXED — Once a code has been emailed there is no way to send another — and the app's own error text tells you to

- **Severity:** blocker (shipped in PR #17)
- **Reproduce:** Go to http://127.0.0.1:8901/admin.html. Click #admForgot ("Forgotten the password? Email me a code instead"). Stub POST /api/admin-code -> 200 {ok:true,sentTo:"k•••@neotype.au"}. The code box opens and #admForgot is set hidden=true, disabled=true, textContent="Sending…" (assets/js/admin.js:1257). Now make the code fail: stub POST /api/admin-code/verify -> 429 {error:"Too many wrong codes — that on
- **Observed:** #admCodeMsg reads "Too many wrong codes — that one is dead. Send a new one." but the only visible, enabled controls on the page are #admPass, #admUnlock, #admRemember, #admCode and #admCodeGo (enumerated via document.querySelectorAll('button,a,input') filtered on offsetParent!==null && !disabled). There is no send-a-code control anywhere. The same dead end is reached with no wrong guesses at all —
- **Expected:** A failed or expired code must leave a way to request a new one: either never hide #admForgot (relabel it "Send another code" and re-enable it, letting the server's 60s send-gap do the rate limiting), or re-show and re-enable it whenever /admin-code/verify returns a non-200. This is the forgotten-password recovery path itself, so the one screen that must never dead-end is the one that does.
- **Where:** `assets/js/admin.js:1257`

### ✅ FIXED — Any non-401 failure from /verify leaves Unlock stuck on "Checking…" forever with no message at all

- **Severity:** blocker (shipped in PR #17)
- **Reproduce:** Stub POST /api/verify -> 500 {"error":"boom"}. Go to /admin.html, type the correct password into #admPass, click #admUnlock. Reproduced identically with 502 {"error":"bad gateway"} and with 200 {"ok":false}. Cause: unlock() at assets/js/admin.js:1298-1310 only branches on r.status===401; a 5xx with a JSON body parses fine, d.ok is falsy, and neither .then branch does anything — while go() (assets/
- **Observed:** #admUnlock stays {disabled:true, text:"Checking…"} indefinitely. document.querySelectorAll('.adm-lockmsg').length is 0 — no error, no toast, nothing. Clicking #admUnlock again does nothing because it is disabled. (Pressing Enter in #admPass does still re-fire the request, and succeeds once the server recovers — but nothing on screen suggests that, and the button reads as a hung app.)
- **Expected:** Treat any non-OK response the same as the network catch already does: re-render the lock screen with "Couldn't reach the admin service — check your connection." and a live Unlock button. As written, every Cloudflare 5xx or KV outage looks to Ian like the dashboard has frozen mid-sign-in.
- **Where:** `assets/js/admin.js:1298`

### "Stay signed in" silently unticks itself after a wrong password, so the retry is not remembered

- **Severity:** major
- **Reproduce:** Go to /admin.html with empty localStorage. Tick #admRemember. Type a wrong password into #admPass. Click #admUnlock (or press Enter — same result). Ran twice, false both times. Cause: the 401 branch calls lockScreen(...) (assets/js/admin.js:1305), which rebuilds the whole screen and recomputes the checkbox's checked attribute from rememberedPassword()||rememberedToken() (assets/js/admin.js:1199) —
- **Observed:** The lock screen returns with "Incorrect password — please try again." and #admRemember is unchecked. Typing the correct password now signs you in but localStorage is {} — the device is not remembered, and nothing said so. Ian, who ticked the box precisely so he would not have to retype on his phone at the bench, has to notice the tick vanished and re-tick it.
- **Expected:** The tick is a stated preference, not a readout of stored state. Carry the checkbox value across a failed attempt (read it before re-rendering and re-apply it), so a typo does not silently discard the choice.
- **Where:** `assets/js/admin.js:1305`

### Enter in the code box fires a redeem on every press even while one is in flight, burning the server's 5 tries

- **Severity:** major
- **Reproduce:** Open the code box (#admForgot). Stub POST /api/admin-code/verify to respond after a 1500ms delay with 401 {error:"Wrong code — 4 tries left."}. Focus #admCode, type 111111, press Enter three times in quick succession. Cause: the keydown handler at assets/js/admin.js:1290 calls redeem() unconditionally, and redeem() (assets/js/admin.js:1266) has no in-flight guard — it only disables the #admCodeGo 
- **Observed:** #admCodeGo.disabled is true 120ms after the first Enter, yet three separate POSTs to /api/admin-code/verify are sent (counted server-side in the stub). The real Function counts each one against CODE_TRIES=5 (functions/api/[[route]].js:305-318), so one impatient double-tap on a mistyped code burns three of the five attempts, and a second mistype kills the code outright — at which point defect 1 lea
- **Expected:** redeem() should return immediately if a request is already in flight (e.g. `if (go.disabled) return;` at the top), so Enter and click share the same lock.
- **Where:** `assets/js/admin.js:1290`

### The code box eats a digit whenever the pasted code carries a space, then tells the user they didn't enter six digits

- **Severity:** major
- **Reproduce:** Open the code box. Insert text into #admCode (real paste / keyboard.insertText) and click #admCodeGo. Measured field values and whether a request was sent: " 123456" -> field " 12345", 0 requests, "Enter all six digits."; "12 34 56" -> field "12 34 ", 0 requests, same message; "1 2 3 4 5 6" -> field "1 2 3 ", 0 requests, same message. ("123456" and "123456 " both work.) Cause: #admCode carries max
- **Observed:** A correct six-digit code pasted with a leading or grouping space is rejected as incomplete, with no network request, and the message blames the user for not entering six digits.
- **Expected:** Strip non-digits on input (an input listener that does value = value.replace(/\D/g,'').slice(0,6)) or raise maxlength and normalise in redeem(), so a code copied out of an email — where a leading space or a selection that grabs surrounding whitespace is routine on mobile — still signs you in.
- **Where:** `assets/js/admin.js:1205`

### "Stay signed in" stores the raw admin password in localStorage, unlike the code path which stores a revocable token

- **Severity:** major
- **Reproduce:** Go to /admin.html, tick #admRemember, sign in with the password. Read localStorage: it holds {"neotype.admin.key":"the-real-password"} — the credential itself, in clear text (assets/js/admin.js:1174). Contrast the email-code path: signing in with a code stores {"neotype.admin.tok":"<64 hex>"} (assets/js/admin.js:1177), and Sign out on that path was observed to POST /api/admin-signout with X-Admin-
- **Observed:** The remembered credential is the permanent Cloudflare ADMIN_PASSWORD secret. Anything that can read this origin's localStorage — an XSS anywhere on neotype.au, a browser extension, anyone who opens devtools on the unlocked phone — walks away with a credential that opens every admin API from any device and cannot be revoked without changing the Cloudflare secret. Sign out clears it only on that one
- **Expected:** Exchange the password for a session token on first sign-in and remember that instead, so "Stay signed in" is bounded and revocable exactly like the email-code session already is. Flagging despite the deliberate trade-off documented at assets/js/admin.js:1155-1163, because the safer mechanism already exists in the same file and the comment's stated risk ("anyone with the unlocked device can open /a
- **Where:** `assets/js/admin.js:1174`

### The 6-digit code box accepts letters, then claims six characters aren't six digits

- **Severity:** minor
- **Reproduce:** Open the code box, focus #admCode, type "abcdef". Click #admCodeGo.
- **Observed:** The field visibly holds six characters ("abcdef"), and #admCodeMsg says "Enter all six digits." — the box looks full while the app says it isn't. inputmode="numeric" only hints at a numeric keypad on mobile; on a desktop keyboard nothing is filtered and there is no pattern attribute.
- **Expected:** Reject non-digits as they are typed (the same input filter that fixes the whitespace defect), so the field can never show something the Sign in button will refuse.
- **Where:** `assets/js/admin.js:1205`

### A successful sign-out is reported in error red

- **Severity:** minor
- **Reproduce:** Sign in, click #admSignOut in the rail. Inspect the message element: getComputedStyle on .adm-lockmsg.
- **Observed:** "Signed out on this device." renders with class "opt-help adm-lockmsg" and computed color rgb(180, 35, 24) — the --bad red used for "Incorrect password" and "Couldn't reach the admin service". signOut() calls lockScreen(msg) with no tone argument (assets/js/admin.js:1189), and in fact tone is never passed at any of the six lockScreen call sites, so the .adm-lockmsg.is-ok green rule at assets/css/a
- **Expected:** Pass "ok" for the sign-out confirmation so it renders green, or drop the unused is-ok rule and style confirmations distinctly from errors.
- **Where:** `assets/js/admin.js:1189`

### A remembered password that has stopped working drops you to a bare lock screen with no explanation

- **Severity:** minor
- **Reproduce:** In the browser console: localStorage.setItem("neotype.admin.key","old-password"). Reload /admin.html with POST /api/verify returning 401 (i.e. the password was changed since the device was remembered). Cause: boot calls unlock(saved, true, true) with silent=true, so the 401 branch runs lockScreen("") (assets/js/admin.js:1305, 1336).
- **Observed:** document.querySelectorAll('.adm-lockmsg').length is 0 — no message at all. The stored password is cleared and #admRemember is now unticked, with nothing said about either. The user sees a dashboard they were signed into yesterday asking for a password again for no visible reason.
- **Expected:** Say what happened, as the token path in the same file already does — it renders "That sign-in has expired — use your password, or email yourself a new code." (assets/js/admin.js:1324, verified). The silent flag was presumably meant to avoid accusing the user of mistyping on a first load; "The saved sign-in for this device no longer works." would do the job without that.
- **Where:** `assets/js/admin.js:1336`

### No sign-in error is announced to a screen reader; the empty-password case produces nothing at all

- **Severity:** minor
- **Reproduce:** (a) Load /admin.html, leave #admPass empty, click #admUnlock. (b) Type a wrong password and click #admUnlock. (c) Open the code box and submit a wrong code. Inspect: #toast (admin.html:34) getAttribute('role')/'aria-live'/'aria-atomic' — all null. #admCodeMsg aria-live/role — both null. #admPass aria-invalid and aria-describedby after a failed attempt — both null.
- **Observed:** (a) The empty-password path is toast-only (assets/js/admin.js:1211): no network request is made, no DOM error appears, focus does not move, and #toast has no live-region role — so a screen-reader user gets absolutely no feedback that the Unlock button did anything. (b) The wrong-password error text exists but the whole lock screen is re-rendered and focus is programmatically moved to #admPass, wit
- **Expected:** Give #toast role="status" aria-live="polite", give #admCodeMsg aria-live="polite", and on a failed password attempt set aria-invalid="true" on #admPass plus aria-describedby pointing at the message element (give it an id). Without these, the sign-in screen is unusable non-visually: three separate failure modes are completely silent.
- **Where:** `admin.html:34`

### Polish, not defects

- Tab order puts "Stay signed in" after the Unlock button: #admPass -> #admUnlock -> #admRemember -> #admForgot. A keyboard user types the password, presses Tab once, lands on Unlock and never meets the option they were meant to opt into. Moving the checkbox before the button in the DOM would match th
- After a wrong code, #admCode keeps the rejected value and focus stays on #admCodeGo (verified). Refocusing the field and selecting its contents would save a manual clear before the next attempt.
- #admForgot keeps textContent="Sending…" and disabled=true after a successful send — only `hidden` conceals it (assets/js/admin.js:1245, 1257). If it is ever re-shown (the fix for defect 1), it will read "Sending…" unless the label and disabled flag are reset too.
- Reloading to escape defect 1 hides the code box again (#admCodeBox.hidden is true after reload, verified). A user who already has a valid code sitting in their inbox must click "Forgotten the password?" a second time, which requests a *new* code — and the server refuses it for 60s via the SEND_GAP (
- /api/pricing is fetched with no auth headers at all (assets/js/admin.js:1140) — it is the one dashboard fetch that does not go through authHeaders(). Harmless if that GET is genuinely public, but it makes authHeaders()'s "one place that decides how a request proves who it is" comment less true than 
- The lock screen has no <form> element, so Enter-to-submit, mobile keyboards' "Go" key and password-manager submit heuristics all depend entirely on the two hand-rolled keydown handlers. Wrapping the fields in a form with a submit handler would get those behaviours for free and remove the empty-passw
- load()'s failure path shows "Couldn't reach the pricing service — is the site deployed?" on the *lock* screen (assets/js/admin.js:1142) — after a sign-in that actually succeeded. It reads as though the password were the problem, and with a remembered password it loops: reload -> auto sign-in -> /pri
- The masked address in "Code sent to k•••@neotype.au" is helpful, but the message does not say what to do if that inbox is not one Ian can reach right now — the recovery path has no second escape hatch, so a bounced Resend key means the dashboard is unreachable until someone edits the Cloudflare proj

## Orders panel and the manual order form

### ✅ FIXED — Any API error on GET /api/orders renders as "Nothing yet" — the panel and the dashboard both state the business has zero orders and $0 revenue

- **Severity:** blocker (shipped in PR #17)
- **Reproduce:** Stub GET **/api/orders to return HTTP 401, 429 or 500 (any non-2xx). Sign in, click [data-view="orders"]. Reproduced identically with 401 (run4), 429 and 500 (run5).
- **Observed:** #admOrdersFull renders the empty state verbatim: "All orders — Nothing yet. Paid orders appear here automatically with the customer's artwork attached. Stripe stays the record for the money itself." The search box is not rendered, the truncation notice is suppressed, #admToday reads "No orders yet. When one comes in it lands here…", and the dashboard tiles read 0 To make / 0 Late / 0 Due today / $
- **Expected:** A non-2xx response is not an empty inbox. Distinguish the two: keep the last known list (or show nothing at all) and say "Couldn't load your orders — try again" with a retry, and for 401 send the user back to the sign-in card. Never print "Nothing yet" or a $0 revenue tile off the back of a failed fetch.
- **Where:** `assets/js/admin.js`

### A network failure while loading orders leaves the Orders panel completely blank with no message

- **Severity:** major
- **Reproduce:** Stub GET **/api/orders with route.abort("failed"). Sign in, click [data-view="orders"]. Confirmed twice (run4, run10).
- **Observed:** #admOrdersFull.innerHTML.length === 0. The whole panel is the heading, the lead paragraph, then the "+ Add an order…" summary — an empty void where the list should be, no search box, no error. The only error message ("Couldn't load your orders — check your connection and reload.") is written to #admToday, which lives in the hidden #panel-dash, so a user standing on Orders never sees it. Cause: adm
- **Expected:** The failure message belongs in the panel the user is looking at. Render an error state inside #admOrdersFull (and every other order-backed panel), with a Retry control.
- **Where:** `assets/js/admin.js`

### Search only covers the loaded window but presents itself as a search over all orders, and the no-match message actively misdirects

- **Severity:** major
- **Reproduce:** Stub GET /api/orders with {orders:[3 orders], total:640, capped:true}. Click orders, type a reference that isn't in the loaded three (e.g. "NT-0042") into #admOrderQ. Confirmed twice (run2, run10).
- **Observed:** Panel reads: "All orders · 0 of 3 match “NT-0042” · Nothing matches that. Try just the reference, or part of the customer's email. · Showing the most recent 3 of 640 orders." The advice is exactly what the user already did, and the order does exist — it just wasn't fetched. The server caps at 200 records (functions/api/[[route]].js, `const LIMIT = 200`), so from order 201 onward every search for a
- **Expected:** When ORDER_META.capped is true and a query returns nothing, say so honestly — "No match in the most recent 200 orders. Older orders aren't loaded; search Stripe for <query>" — with a link out. Better: pass the query to the server and search the full key set. The generic "try just the reference" line must not be shown while the list is truncated.
- **Where:** `assets/js/admin.js`

### An expired artwork file still gets a live "⬇ Download artwork" button right next to the notice saying it's gone

- **Severity:** major
- **Reproduce:** Stub an order with status "paid", artwork "https://…", when = 95 days ago, and artExpires: 90. Click orders. Confirmed three times (run1 NT-1005, run2 A-90, run5 E-1).
- **Observed:** .adm-ord-art contains an enabled anchor `<a class="btn btn--ghost btn--sm" href="https://n.au/expired">⬇ Download artwork</a>` immediately followed by `.adm-art-gone` reading "This file has expired — ask the customer to send it again". The link has no target, no aria-disabled and no visual difference from a working one, so clicking it navigates the whole admin tab to a 404. The code comment at adm
- **Expected:** When artWarn() determines the file is gone, do not render a download control at all — replace it with the warning, the same way an unpaid order replaces the button with the hold notice. If the button is kept for the "deleted in N days" case, it should at least carry target="_blank" so a dead file doesn't blow away the dashboard.
- **Where:** `assets/js/admin.js`

### The manual form's Phone and Note fields are write-only — the values are stored and then never displayed or searchable anywhere in /admin

- **Severity:** major
- **Reproduce:** Stub an order with phone:"0412 345 678" and note:"Paid by bank transfer, wants them by Friday". Click orders. Then search #admOrderQ for "0412" and for "bank transfer". Confirmed twice (run1 search, run6 DOM dump).
- **Observed:** Neither string appears anywhere in #admOrdersFull.innerHTML (checked directly, not just visible text). Search returns "0 of 3 match “0412”" and "0 of 3 match “bank transfer”". grep confirms admin.js never reads o.phone or o.note — the only `.note` reference (:547) is the dashboard tile caption. The server does persist both (functions/api/[[route]].js createManualOrder). So the two free-text fields
- **Expected:** Render phone and note on the order card (note is the whole reason a manual order exists), and add both to the orderMatches() haystack at admin.js:915 so the number a customer quotes down the phone actually finds the job. Either that, or drop the fields from the form rather than pretending to capture them.
- **Where:** `assets/js/admin.js`

### An artwork link typed without a scheme is silently discarded, and the order then tells Ian to chase the customer for the file he just supplied

- **Severity:** major
- **Reproduce:** Open details.mf-card, fill #mfName and #mfAmount, put "drive.google.com/abc" in #mfArtwork, click #admManualSave. Inspect the POST body (run3).
- **Observed:** Payload contains artwork:"drive.google.com/abc" — no client-side check fires (see the no-<form> defect: type="url" validation never runs). The server drops it: `artwork: /^https?:\/\//.test(body.artwork || "") ? str(body.artwork,480) : ""` (functions/api/[[route]].js, createManualOrder). The stored order has artwork:"", and ordersTable then renders "⚠ No artwork file — chase the customer for it" (
- **Expected:** Validate the URL in saveManual() before POSTing and refuse with "Artwork links need to start with https://", or normalise a bare host to https://. A field that accepts input and silently discards it, then blames the customer for the missing file, is worse than no field.
- **Where:** `assets/js/admin.js`

### The manual order form is not a <form>: Enter never submits, and type=email / type=url / min="0" / step="0.01" are decorative

- **Severity:** major
- **Reproduce:** Open details.mf-card, fill #mfName and #mfAmount, focus #mfName, press Enter. Then try #mfAmount = "-50" or "0.001" and #mfEmail = "not-an-email", click #admManualSave. Confirmed twice (run3, run5).
- **Observed:** Enter produces zero network requests and zero toasts — nothing happens at all, in either the name or the amount field. Every field reports closest("form") === null, and #admManualSave has type "submit" with no form to submit to, so no constraint validation ever runs. Observed payloads: amount:"-50", amount:"0.001", amount:"1e9", email:"not-an-email" all POSTed unchallenged. "0.001" survives the se
- **Expected:** Wrap .mf-grid + .mf-actions in a <form> with a submit handler so Enter works and the browser enforces the constraints already declared in the markup, and range-check the amount in saveManual() (reject ≤ 0 with "Enter the amount they paid") rather than relying on the server's `amount < 0` check.
- **Where:** `assets/js/admin.js`

### A lost response after a successful manual-order POST reports failure, and re-clicking creates a duplicate paid order

- **Severity:** major
- **Reproduce:** Stub POST /api/orders to route.abort("failed") (or to return 200 {ok:true} with no `order` key). Fill the form, click #admManualSave. Confirmed twice (run3 modes "abort" and "noorder").
- **Observed:** Toast reads "Couldn't add that order", every field keeps its value and the button re-enables — the exact state that invites a second click. But the request did leave the browser: server-side createManualOrder writes to KV before responding, and it mints a fresh `crypto.randomUUID()` key on every call, so the retry lands as a second order with a different ref, both status "paid". Both then count in
- **Expected:** Send a client-generated idempotency key with the payload and have createManualOrder key on it, so a retry overwrites rather than duplicates (the Stripe path already does exactly this — see the saveOrder comment about one key per session). At minimum, don't let an exception in the success handler fall through to the network-error catch: on an ambiguous failure say "We couldn't confirm that — check 
- **Where:** `assets/js/admin.js`

### Adding an order while a search is active: the toast says it's in the pipeline, but the list still shows only the filtered results and the new order is nowhere on screen

- **Severity:** minor
- **Reproduce:** Type "kelly" into #admOrderQ, scroll to the manual form, add a valid order for a different customer, click #admManualSave. Confirmed in run3.
- **Observed:** Toast: "Added — it's in the pipeline as ABCD1234". #admOrderQ still holds "kelly", the header ticks from "1 of 2 match" to "1 of 3 match", one card is visible, and "ABCD1234" appears nowhere in #admOrdersFull. loadOrders() → renderAll() re-renders the table through the live ORDER_Q filter (admin.js:878-882). Ian is told the order exists and cannot see it — the natural next move is to add it again.
- **Expected:** Clear ORDER_Q on a successful manual add (or scroll the new card into view and flash it). The confirmation must point at something the user can actually see.
- **Where:** `assets/js/admin.js`

### Manual orders are headed with the raw product slug — a card reading "other" or "banner"

- **Severity:** minor
- **Reproduce:** Stub a manual order with product "other" (or "banner") and blank quantity/size/finish/shape — exactly what the form produces when Ian only fills name, amount and product. Click orders. Confirmed twice (run2, run6).
- **Observed:** .adm-enq-top b renders the literal strings "other" and "banner" — lowercase, untranslated — where a website order reads "100 · 75 × 75 mm · Matte · Die-cut". The dropdown Ian picked from says "Other" and "Banners". Cause: admin.js:975 falls back to `o.product` with no label lookup, unlike stageLabel()/PAY_LABEL elsewhere in the same function.
- **Expected:** Map through a PRODUCT_LABEL table the way stage and payment status already are, so a phone order for a banner reads "Banner" or "Banner — Ivy Chen", not "banner".
- **Where:** `assets/js/admin.js`

### Every manual order permanently shows "⚠ No artwork file — chase the customer for it"

- **Severity:** minor
- **Reproduce:** Add any order through the manual form without an artwork URL (the normal case for a walk-in with a USB stick). Confirmed twice (run2, run6).
- **Observed:** The card renders the amber warning "⚠ No artwork file — chase the customer for it" forever. For a website order that message is correct and actionable; for a counter job where Ian already has the file it is a permanent false alarm on every phone order he ever takes, which trains him to ignore the warning on the orders where it matters.
- **Expected:** Suppress the chase-the-customer warning when source === "manual" (or when no artwork was ever expected), or soften it to a neutral "No file attached".
- **Where:** `assets/js/admin.js`

### The Date ordered hint says it "sets the due date" — it does not

- **Severity:** minor
- **Reproduce:** Open details.mf-card and read the <em class="mf-hint"> under #mfWhen (admin.js:841).
- **Observed:** Hint text: "Leave blank for today — this sets the due date." The field sets `when` (the order date). The due date is derived from it: dueInfo() at admin.js:501 adds turnaroundDays() business days on top (1 for Next day, 2 for 2 days, 4 for Standard). So entering Friday with "Next day" produces a job due the following Monday, not Friday. A user recording "customer wants it by Friday" will get a dat
- **Expected:** Reword to what it does — "Leave blank for today — the due date is worked out from this plus the turnaround" — or add a real due-date override field.
- **Where:** `assets/js/admin.js`

### Clearing the search dumps keyboard focus onto <body>

- **Severity:** minor
- **Reproduce:** Type "kelly" into #admOrderQ, then either click #admOrderQX or Tab once and press Enter. Confirmed twice (run1, run5).
- **Observed:** document.activeElement is BODY in both cases. The handler (admin.js:432) sets ORDER_Q = "" and calls renderAll(), which replaces the whole card via innerHTML — the focused button ceases to exist and nothing catches the focus. A keyboard user has to Tab from the top of the document again to get back to the search box. Note the typing path handles this correctly (admin.js:441-451 restores focus and 
- **Expected:** After clearing, move focus to the (rebuilt) #admOrderQ input, the same way the input handler already does.
- **Where:** `assets/js/admin.js`

### Every message this panel produces — validation, success, error — is silent to a screen reader

- **Severity:** minor
- **Reproduce:** Inspect #toast: getAttribute("role") and getAttribute("aria-live") are both null. Then click #admManualSave with the form empty. Confirmed twice (run3, run5).
- **Observed:** The toast div (admin.html:35) has no role="status" and no aria-live, so "Add the customer's name", "Couldn't add that order" and "Added — it's in the pipeline as …" are never announced. On a validation failure nothing else changes either — the button text doesn't change, no field is marked invalid, focus doesn't move — so a non-sighted user clicks Add order and gets absolutely no feedback. The sea
- **Expected:** Put role="status" aria-live="polite" on #toast (or aria-live="assertive" for errors), move focus to the first invalid field on a validation failure and mark it aria-invalid, and wrap the result count in an aria-live="polite" region.
- **Where:** `admin.html`

### A customer with an ordinary long email address makes the whole admin page scroll sideways on a phone

- **Severity:** minor
- **Reproduce:** Load /admin at a 390px viewport with an order whose email is "jessica.mcnaughton@brisbanesignagesolutions.com.au" (50 chars). Click orders. Confirmed twice (run6 @420px, run9 @390px, different data each time).
- **Observed:** documentElement.scrollWidth exceeds clientWidth by 76px at 390px (276px with a 71-char address). Each .adm-enq.adm-ord card measures 466px wide inside a 390px viewport, pushing .adm-enq-when (the order date) and part of .adm-ord-amt off the right edge, and the whole document — rail included — scrolls horizontally. .adm-enq-mail (assets/css/admin.css:384) is display:inline-block with overflow-wrap:
- **Expected:** Give .adm-enq-mail overflow-wrap:anywhere (or word-break:break-word) and max-width:100%. Nothing in the orders panel should be able to force the document wider than the viewport.
- **Where:** `assets/css/admin.css`

### A record missing `amount` or `when` prints "$NaN AUD" and the literal word "undefined" onto the card

- **Severity:** minor
- **Reproduce:** Stub an order with no `amount` key, and one with no `when` key / when:"not-a-date". Click orders. Confirmed in run5.
- **Observed:** Card 1 headline row reads "$NaN AUD"; the dashboard tile simultaneously counts it as $0, so the two disagree. Card 2's date slot reads "undefined" (whenLabel returns its argument unchanged when unparseable, and esc(undefined) stringifies it). No JS error is thrown, so nothing flags it. admin.js:980 `'$' + (o.amount / 100).toFixed(2)` and :984 `esc(whenLabel(o.when))` have no guard, even though the
- **Expected:** Apply the same defence as `status`: default a missing amount to 0 (or render "—"), and render "Date unknown" rather than the raw value when new Date(o.when) is invalid.
- **Where:** `assets/js/admin.js`

### Polish, not defects

- The search placeholder undersells the feature: "Search by reference, name, email, size…" while orderMatches() also indexes finish, product, shape, turnaround, quantity, stage label, payment state and the formatted amount. Worth naming finish and stage explicitly — those are the two Ian would never g
- A whitespace-only query is treated as a real search: typing two spaces yields the Clear button and a header reading "9 of 9 match “ ”". Trim the query before deciding whether one is active.
- The "⬇ Download artwork" anchor has no target="_blank" while the customer email link directly above it does (target="_blank" rel="noopener"). Clicking Download navigates the dashboard away; the inconsistency inside one card is jarring.
- The result count sits at the top of the card and the truncation notice at the bottom, so during a search they read as two unrelated numbers ("1 of 3 match “ivy”" … "Showing the most recent 3 of 640 orders"). Consider merging them into one line.
- After a successful manual add, all text fields clear but #mfProduct and #mfTurn keep their previous selection. Defensible, but nothing in the UI signals it, so the next order silently inherits "Banners / Next day".
- Nothing scrolls to or highlights the newly added order; the toast is the only evidence it exists, and it fades after 3.6s.
- There is no way to edit, void or delete a manual order from /admin — a fat-fingered $2,500 walk-in permanently skews the This month tile and the Analytics revenue with no correction path.
- The Amount field carries no currency prefix inside the input (only the label says AUD) and no thousands formatting, so a four-figure job reads as a bare "1250".
- #admOrderQ has no autocomplete attribute; on a tablet the browser will offer previous unrelated form values in a search box that is re-created on every keystroke.
- The manual form's <details> stays open after a successful add, leaving a large blank form between Ian and the list he was just told to look at.

## Pricing panel

### The "What switching over would change" table and the band preview columns never recompute for anything except band edits — the note above them says they do

- **Severity:** blocker
- **Reproduce:** Sign in → Pricing. Note impact row 6 reads "100 × 75 mm | $70 | $62 | -11%". Now type 500 into `[data-path="stickers.min"]` (Stickers → Minimum order). The three headline Example prices immediately become $500. Re-read impact row 6. Reproduced identically with `[data-mult="stickers.shape.die"]` = 100, and by clicking `label:has([data-off="stickers.finish.vinyl-matte"])` (Matte → Hidden), and by se
- **Observed:** Impact row 6 still reads "$70 | $62 | -11%" and band row 4 still reads "$62.00 for 100". With Matte switched off, pricing-core returns null for the band reference sticker, yet the band table still shows "$62.00 for 100" and every impact row still shows dollars. With maxMm=50, 75 mm stickers price as "Off" everywhere else but the band/impact tables keep quoting them. onEdit (assets/js/admin.js:1074
- **Expected:** With min=$500 the row should read "$500 | $500 | 0%". Every edit that changes a sticker price should call refreshBands(), and rows whose reference sticker can no longer be priced should show "—", not a stale dollar figure. The panel's own copy promises it: "Every price on the site, before and after. Recalculated as you type."
- **Where:** `assets/js/admin.js`

### Toggling the bands switch off and on again silently discards every rate Ian typed, while the input boxes keep showing his numbers

- **Severity:** blocker
- **Reproduce:** Pricing → click `.adm-bandon` (switch on). Type 3.333 into `[data-band="4.rate"]` (the 250+ band). Click `.adm-bandon` twice (off, then on). Read the field, then click Save prices and inspect the POST body.
- **Observed:** The field still displays 3.333, but the POSTed table contains rate 0.0085 (0.850 ¢). Same with two rates at once: fields show 5.000 and 4.000, POST carries 1.100 and 0.700. onEdit's #admBandsOn branch (admin.js:1095-1112) deletes D.stickers.qtyBands on un-check and re-seeds DEFAULT_BANDS on re-check, but never re-renders the row inputs.
- **Expected:** Either the switch preserves the typed band table across an off/on cycle, or the inputs are repainted so the screen and the saved table agree. What is shown must be what is saved — this posts prices Ian never typed and cannot see.
- **Where:** `assets/js/admin.js`

### Typing in any band row turns band pricing on but leaves the switch reading "Using the sliding scale"

- **Severity:** major
- **Reproduce:** Pricing, bands switch in its default off state. Note the first sticker Example price ($70). Click into `[data-band="3.rate"]` and type 1.100. Read the switch label, its pill, and the Example price. Then click the switch once.
- **Observed:** The example drops to $62 (bands are now pricing) and the hidden checkbox becomes checked, but `.adm-stock-txt` still says "Using the sliding scale", the label keeps its `is-off` class (pill grey, knob still translated right), and `.adm-bandtable` keeps `data-dim="1"`. Save posts a full qtyBands array. The follow-on trap: clicking the switch once from that state changes nothing visible at all — the
- **Expected:** Editing a band field should flip the whole switch — words, pill and dimming — to "Bands are pricing the shop", so the control never states the opposite of what is pricing the shop, and so one click always produces one visible change.
- **Where:** `assets/js/admin.js`

### The impact table freezes on the previous keystroke whenever the band table has no "buying one fewer would cost more" boundary

- **Severity:** blocker
- **Reproduce:** Pricing → click `.adm-bandon`. Set all seven `[data-band="N.rate"]` fields to 1.000 (flat rates, so no boundary exists and #admBandWarn hides). Now set `[data-band="6.rate"]` to 5.000. Compare `[data-bandtotal="6"]` with impact row 12 ("2000 × 75 mm").
- **Observed:** `[data-bandtotal="6"]` updates from "$1125.00 for 2000" to "$5625.00 for 2000", but impact row 12 stays at "$675 / -29%" — a value from several keystrokes earlier. pricing-core computes now=$956, withBands=$5,625 (+488%). The whole impact table stops moving for every subsequent keystroke while no boundary exists. Cause: refreshBands (admin.js:245) does `if (!breaks.length) { warn.hidden = true; re
- **Expected:** refreshImpact(probe) must run on every keystroke regardless of whether a boundary warning is showing. This table exists so Ian sees a rise before customers do; here it shows a 29% cut where the truth is a 488% rise.
- **Where:** `assets/js/admin.js`

### ✅ FIXED — Percentage fields accept values below -100%, storing a negative price multiplier

- **Severity:** major (shipped in PR #17)
- **Reproduce:** Pricing → Stickers → Finish. Select `[data-mult="stickers.finish.holographic"]` and type -200. Click Save prices and inspect the POST body.
- **Observed:** The field accepts -200 with no refusal or flag; D.stickers.finish.holographic becomes -1 and that is what is POSTed. Every holographic example collapses to the $18 minimum. -100 likewise stores multiplier 0 (the option becomes free). pctInput (admin.js:130) emits `<input type="number" step="1">` with no min and no max, and onEdit stores 1 + p/100 unconditionally.
- **Expected:** A multiplier at or below zero is never a valid price factor and reaches the Stripe charge path. The field should clamp at -99 (or refuse and say why), and never store a value ≤ 0.
- **Where:** `assets/js/admin.js`

### ✅ FIXED — Every money field accepts negative numbers despite min="0", and the values are stored and saved

- **Severity:** major (shipped in PR #17)
- **Reproduce:** Pricing → Stickers. Type -50 into `[data-path="stickers.rate.base"]`; then -100 into `[data-path="stickers.min"]`; then -29 into `[data-path="banner.rate"]`. Open "Advanced settings" and type -0.5 into `[data-path="stickers.rate.decay"]`. Save prices after each and inspect the POST.
- **Observed:** All are stored and POSTed verbatim: rate.base -50, min -100, banner.rate -29, decay -0.5. Sticker examples collapse to the $18 minimum; every banner example collapses to $35. decay = -0.5 sends the "500 × 75 mm matte" example from $240 to $93,818, and "How fast the bulk discount kicks in" is the plain-English label above it. The min="0" attribute in moneyInput (admin.js:126) is inert — there is no
- **Expected:** A negative rate, minimum or decay is never a real price setting. The field should refuse it (revert, or show a message) rather than storing and saving a number that makes the shop sell at the minimum — or, with a negative decay, quote five figures.
- **Where:** `assets/js/admin.js`

### "Undo changes" drops you back to the sign-in screen and loses every edit if the pricing GET fails

- **Severity:** major
- **Reproduce:** Pricing → make any edit. Simulate a transient failure on the pricing GET (route `**/api/pricing` GET to abort). Click `#admReload` ("Undo changes").
- **Observed:** `#admRoot` is emptied and replaced by the lock screen: password box, "Forgotten the password?", and the message "Couldn't reach the pricing service — is the site deployed?". `#panel-pricing` is gone, the loaded orders are gone, and the admin password has to be typed again. admin.js:1140-1142 — load()'s catch calls lockScreen().
- **Expected:** A failed refetch should leave the form as it is and show a toast ("Couldn't reload — your changes are still here"). One flaky request should not sign a sole trader out of his own dashboard, and the message shouldn't blame deployment for a network blip.
- **Where:** `assets/js/admin.js`

### All 40 percentage inputs and all 14 band inputs have no accessible name

- **Severity:** major
- **Reproduce:** Sign in → Pricing. For every `#panel-pricing [data-mult]` and `[data-band]`, check for a wrapping <label>, a label[for], aria-label, aria-labelledby or title.
- **Observed:** 40 of 40 [data-mult] inputs and 14 of 14 [data-band] inputs have none — a screen reader announces "spin button, 50" with no indication of which option or column. The money fields ([data-path]) and the 41 stock switches ([data-off]) are correctly labelled, so the gap is specific. Compounding it, the 14 "tables" in the panel are div grids with no table semantics (0 <table> elements, 0 role attribute
- **Expected:** Each percentage input needs a name tying it to its row and column (e.g. aria-label="Holographic price change, percent"), and each band input the same ("Band 4 from quantity", "Band 4 rate in cents per cm²"). Without it the pricing panel is unusable by keyboard-and-screen-reader.
- **Where:** `assets/js/admin.js`

### A band row typed out of order is stored as typed but priced in sorted order, so the table on screen no longer reads in the order it prices

- **Severity:** minor
- **Reproduce:** Pricing → switch bands on. Type 5 into `[data-band="3.from"]` (the row that reads 100, sitting below the 50 row). Read the table, then read the first sticker Example price.
- **Observed:** The stored array becomes [{1,0.024},{20,0.018},{50,0.014},{5,0.011},{250,…}] and is POSTed that way. pricing-core's bandsOf() sorts it, so the effective ladder is 1 → 5 → 20 → 50 …, with the 5-19 rate (1.1¢) cheaper than the 20-49 rate (1.8¢). The example price jumps $62 → $79 with no warning. The screen keeps showing 1, 20, 50, 5, 250, 500, 2000 — an order that is not the order used to price.
- **Expected:** Either re-sort the rows on screen when a `from` is changed, or refuse a `from` that is not greater than the row above it and say so — the same way #admBandWarn already names boundary problems.
- **Where:** `assets/js/admin.js`

### Cutter size limits are stored and displayed as though in force when they are inconsistent, but silently do nothing

- **Severity:** minor
- **Reproduce:** Pricing → Stickers → "Advanced settings (usually set once)". Set `[data-path="stickers.minMm"]` = 10 and `[data-path="stickers.maxMm"]` = 5 (a typo for 500, say). Save prices, then read the Example prices.
- **Observed:** maxMm 5 is stored, POSTed and shown in the field, but pricing-core's sizeLimits() sees hi <= lo and silently reverts to 10–300 mm; 75 mm examples keep pricing at $70/$105/$240 and the shop keeps selling up to 300 mm. Same when minMm=400 exceeds maxMm=300. (Valid values do work: minMm=100 or maxMm=50 correctly turn the 75 mm examples to "Off".)
- **Expected:** The panel should flag "Largest must be bigger than smallest — this setting is being ignored" rather than showing a saved figure that a printer would reasonably believe protects his cutter.
- **Where:** `assets/js/admin.js`

### Clearing any numeric field silently keeps the old value, then Save reports success

- **Severity:** minor
- **Reproduce:** Pricing → click `[data-path="stickers.rate.base"]`, select all, Delete. Leave it blank. Click Save prices. Reproduced identically for `[data-mult="…"]` and `[data-band="2.rate"]`.
- **Observed:** The box shows nothing; D still holds 85; the POST carries 85; the toast says "Saved — new prices are live". The box stays blank until a reload, so the panel shows an empty rate for a live $85 setting. onEdit's `if (isFinite(v))` guards drop the edit without any feedback.
- **Expected:** An emptied field should either restore the value it kept (so the screen matches what is saved) or block Save with "Rate per m² can't be blank".
- **Where:** `assets/js/admin.js`

### Band `from` accepts 0 and negatives, and band rate accepts 0 and negatives, despite min="1" / min="0"

- **Severity:** minor
- **Reproduce:** Pricing → bands on. Type 0, then -5, into `[data-band="0.from"]`. Type 0, then -1, into `[data-band="1.rate"]`. Save after each and inspect the POST.
- **Observed:** Stored and POSTed verbatim: {"from":-5,…} and {"from":20,"rate":-0.01}. A negative $/cm² rate takes the 20-49 band's preview to "$18.00 for 20" (the minimum absorbs it) with no refusal, no red, no message. The min attributes at admin.js:195-196 only constrain the spinner arrows.
- **Expected:** A quantity band starting below 1, or priced at or below 0 ¢/cm², should be refused with a reason. These numbers are saved straight onto the money path.
- **Where:** `assets/js/admin.js`

### Order labels use the app's own size notation for a quantity × size pair, so "50 × 100 mm" and "100 × 50 mm" read as sticker dimensions

- **Severity:** minor
- **Reproduce:** Pricing → Stickers. Read the "Example prices" box, then the first column of the impact table.
- **Observed:** Examples read "100 × 75 mm matte, die-cut", "100 × 75 mm holographic", "500 × 75 mm matte, die-cut" — these are 100 and 500 of a 75 × 75 mm sticker. The impact table lists "50 × 100 mm" (50 of a 100 mm sticker) and "100 × 50 mm" (100 of a 50 mm sticker) as separate rows at $65→$70 and $39→$28. "75 × 75 mm" is exactly how the app labels a sticker's size everywhere else (pricing-core sizeLabel, the 
- **Expected:** Write the quantity as a quantity: "100 × 75 mm square" → "100 stickers, 75 × 75 mm", or "×100 @ 75 mm". As written, the two rows that matter most for the band decision look like the same rectangle priced two different ways.
- **Where:** `assets/js/admin.js`

### Below 620px the impact table's "Change" column falls under the "Order" heading — the responsive rule written for it is overridden

- **Severity:** minor
- **Reproduce:** Sign in → Pricing at a 390px or 600px viewport. Inspect `getComputedStyle('.adm-impact .adm-imptr').gridTemplateColumns` and the x/y of each cell.
- **Observed:** Computed columns are "132px 132px", not the 1.3fr 1fr .7fr written at admin.css:617 — `.adm-tr { grid-template-columns: 1fr 1fr }` at admin.css:619 has equal specificity and comes later, so it wins for every .adm-imptr. The "Change" cell wraps to a second grid line at x=57, directly beneath the order label, and the "Change" header wraps beneath "Order". Rows are 76px tall instead of ~42px.
- **Expected:** The rule at line 617 should take effect (raise its specificity, or move it after line 619) so the three visible cells sit in three columns under their own headings.
- **Where:** `assets/css/admin.css`

### Switching every option in a group to Hidden makes the product unorderable with no warning anywhere on the card

- **Severity:** minor
- **Reproduce:** Pricing → Stickers → Finish. Click each of the seven `label:has([data-off="stickers.finish.…"])` in turn.
- **Observed:** All 20 sticker example prices read "Off", the off map POSTs all seven keys, and nothing on the card says the shop can no longer take a sticker order. The card still shows editable rates, an editable band table and an impact table (which, per the first defect, still quotes dollars).
- **Expected:** When every option in a group is hidden the card should say so plainly — "No finish is in stock, so customers can't order stickers at all" — because that is a silent shutdown of a product line, and the only clue is twenty "Off" labels.
- **Where:** `assets/js/admin.js`

### Polish, not defects

- The band table is dimmed to opacity .5 while the switch is off, which reads as disabled, yet its inputs are fully focusable and editable — and editing one is what silently switches band pricing on. Either dim and disable, or don't dim.
- Band row 1 reads "From quantity 1" but its preview says "$20.00 for 15", because QTY_MIN is 15. No customer can ever buy fewer than 15, so the first band's stated start is unreachable; label it "From 15" or explain the floor.
- Within one band row the two preview columns don't multiply out: "135.0c each" × 15 = $20.25, next to "$20.00 for 15". The unit column uses the unrounded total, the money column uses the rounded one.
- The band preview formats always-whole-dollar figures with two decimals ("$675.00 for 2000"), while every other figure on the panel is whole dollars ("$675").
- The sticky save bar always reads "Signed in · changes go live the moment you save" — there is no dirty indicator, so after twenty edits nothing distinguishes a saved panel from an unsaved one.
- The impact table's "Now" column is computed from the working copy including unsaved edits, so with an unsaved rate change it is not what the site charges now. Worth naming it "Before bands" rather than "Now".
- Re-typing a band rate's own displayed value stores float noise (typing 1.800 over 1.800 yields 0.018000000000000002), which then persists in the saved table.
- All 14 tables in the panel are div grids with no table semantics — no <table>, no role, no scope — so column headers are never associated with cells for assistive tech even once the inputs are named.
- On phones the impact table hides the "Now" column entirely (admin.css:618), leaving only the after-price and the % — the before/after comparison the section is named for is unavailable on the device Ian is most likely holding at the bench.
- Only Stickers has an "Advanced settings" disclosure; Banners and Corflute have none, so the details affordance appears once, two thirds of the way down the panel, with nothing signalling why.

## Not audited

The Analytics and Receipts panels, and responsive behaviour below 940px, were
queued but had not returned when the handover deadline hit. They are the two
panels that only ever *read* data, so nothing there can change an order or a
price — which is why they were the ones left running.
