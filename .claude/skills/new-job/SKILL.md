---
name: new-job
description: Turn a goal — or a pile of meeting notes and actionable items — into WiseAI job goal files in this repo. Use when the user wants to define new work, set a goal, brief a piece of work, break down meeting outcomes, or says "new job", "add a goal", "brief this", "here's what we agreed", or pastes a list of things to do. Writes .wiseai/jobs/<slug>.md, optionally under a milestone in .wiseai/milestones/<slug>.md, and validates them.
---

# Turn a goal into jobs

A **job** is one goal an agent iterates on until a critic judges it good enough. This skill writes
the goal files that define them.

Two shapes of input arrive here, and they need different handling:

- **One clear outcome** — "make the timer accurate". One job. Skip to *Writing one job*.
- **A pile of actionable items** — meeting notes, a client's wish list, a punch list. Several
  jobs, and usually a **milestone** that they add up to. Start at *Splitting the work*.

Read the input before deciding which. If it contains more than one thing that could succeed or
fail independently, it is the second shape even if the user described it as one goal.

---

## Splitting the work

### Why splitting is not optional

It is tempting to write one big job — it feels faster and it matches how the meeting felt. It
produces a job that cannot work.

The critic scores against `## Outcome` and returns one weighted number. If that Outcome covers six
unrelated things, the number averages six unrelated judgements: the deposit flow can be perfect and
the confirmation email broken, and the score reads 0.7 either way. The loop then feeds "0.7, do
better" back to the agent, which has no idea which part to fix, so it rewrites everything and the
next score is 0.68. That is how a job burns its whole budget converging on nothing.

**The test for whether two items belong in the same job:** could one be finished and impressive
while the other is still broken? If yes, they are two jobs.

### 1. Read the context first

- `.wiseai/context/*.md` — project-specific context, if present
- `.wiseai/milestones/*.md` — milestones already in flight; the new items may belong to one
- `.wiseai/jobs/*.md` — existing jobs, for house style and to avoid duplicating one
- `README.md` and the project structure — what this codebase actually is

### 2. Propose the split before writing anything

List the jobs you intend to create, one line each, and say what the milestone is. Then stop and
let the user react. **Do not write files yet.**

> From those notes I'd make this a milestone — **party-booking-launch: parents can book a party
> end to end without phoning the venue** — with five jobs under it:
>
> 1. `deposit-taken-online` — a parent can pay a deposit and get confirmation without staff involvement
> 2. `lane-availability-live` — the booking form only offers slots that are actually free
> 3. `confirmation-email-reads-well` — the email answers "what do I do now" without a phone call
> 4. `staff-see-todays-parties` — a staff member can see the day's bookings at a glance mid-shift
> 5. `deposit-refund-path` — a cancelled booking refunds without a manual bank transfer
>
> Two things I left out: "look into the POS integration" is research, not a goal with a finished
> state — an agent cannot iterate toward it. And "make the whole thing nicer" I'd fold into #3
> unless you meant something specific.
>
> Does that match what you agreed?

Notice what that does: it names what was **dropped** and why. Actionable items from a meeting are
never uniformly actionable — some are research, some are decisions only a human can make, some are
one line of an existing job. Silently dropping them is how a client's "you said you'd do X" lands
badly three weeks later.

**Items that should not become jobs:**

- **Research and investigation.** "Look into whether Stripe supports this" has no finished state a
  critic could score. Tell the user it's a question to answer, not work to iterate on.
- **Decisions.** "Decide on the pricing tiers" is theirs to make. A job can implement the decision
  afterwards.
- **Things needing access you don't have.** A job that cannot start is worse than no job.
- **One-liners inside another job.** "Also fix the typo in the header" is not a goal.

### 3. Write the milestone file

`.wiseai/milestones/<slug>.md`. This is the thread that holds the jobs together — what the client
actually wanted, in their terms.

```markdown
---
title: Parents can book a party end to end
---

## The outcome

A parent finds the party page on their phone, picks a date and a time that is genuinely
available, pays a deposit, and receives a confirmation that answers every question they would
otherwise have phoned about. Nobody at the venue touches anything until the party arrives.

Today every booking involves at least one phone call, usually two, and Saturday mornings are
spent on the phone rather than on the floor.

## How we will know

Bookings taken outside opening hours, with no follow-up call. Currently zero.

## Jobs

- deposit-taken-online
- lane-availability-live
- confirmation-email-reads-well
- staff-see-todays-parties
- deposit-refund-path
```

The milestone is **not** scored. No criteria, no threshold, no budget — the jobs carry all of
that. It exists so the hub can report progress and so the next person to read the repo knows what
the six jobs were for.

### 4. Write each job

Each one gets `milestone: <slug>` in its front matter, and is otherwise an ordinary job — see
*Writing one job* below. Write them one at a time, properly. Five thin briefs are worse than two
good ones: a thin brief produces confident scores that mean nothing, and the user finds out
several iterations and some spend later.

If you cannot write a real Outcome for one of them, say so rather than padding it:

> I can't write a scoreable Outcome for `deposit-refund-path` — I don't know what the refund
> policy is or who currently does it by hand. Can you tell me what should happen when a parent
> cancels four days out?

---

## Writing one job

### Pick the slug

Lowercase letters, numbers, and dashes. It becomes the filename, the job's identity in the hub,
and its git branch. Derive it from the outcome, not the implementation:
`timer-shows-accurate-remaining`, not `fix-settimeout-bug`.

Check `.wiseai/jobs/` first. If the slug exists, the user is probably revising an existing job —
ask before overwriting.

### `## Outcome` is what the critic reads

Copy `.wiseai/jobs/_TEMPLATE.md` and fill it in. Write the Outcome for someone who has never seen
this project. Describe the result, not the task. Aim for at least 100 words — not as padding, but
because a result worth an agent's time usually takes that long to describe honestly.

> **Weak:** "Fix the upstairs timer so it shows the right time."
>
> **Strong:** "A staff member glancing at the upstairs screen mid-shift can tell at once how long
> a lane has left, without doing arithmetic. The countdown moves every second and matches the
> booking system exactly — no drift across a two-hour session, no jump when the page is left open
> and returned to. When a lane is nearly up, that's obvious from across the room rather than
> something you have to walk over and read. The current display drifts by several minutes over a
> session and reads as a static number, which staff have learned not to trust."

Notice what the strong version carries: who uses it, what "correct" means precisely, what failure
currently looks like, and what would make it good rather than merely working. A critic can score
against that. It cannot score against the weak one.

**`## Done means`** should be checkable statements a reasonable person would agree on.

> **Weak:** "The timer works properly."
>
> **Strong:** "A timer started at 90 minutes reads 89:59 one second later, and 00:00 at exactly
> ninety minutes. Reloading the page mid-session shows the same remaining time, not a restart."

**Leave `status: draft`.** Always. The user flips it to `ready` themselves once they've read it
back. Writing a file must never be enough to start spending money — that switch is the whole
safety catch, and setting it for the user removes their last chance to catch a bad brief.

### Derive the criteria

The `## Criteria` section is the rubric the critic scores each iteration against. Derive it from
`## Outcome` — not from the user's chat messages, and not from what you happen to know about the
codebase. If it is not in the Outcome, it is not a criterion.

**First, check the Outcome can support a rubric.** If you cannot pull 3–6 *distinct, independently
judgeable* dimensions out of it, stop and say so:

> "This Outcome tells me what to build but not what makes it good — I can only get one real
> criterion out of it, which means the score will be close to a coin flip. Can you say more about
> what would make you look at the result and think it was genuinely well done?"

Then offer a sharper Outcome and let them react. **Do not derive criteria from a brief that cannot
support them.** A weak rubric does not fail loudly; it produces confident scores that mean
nothing.

Format — one `###` block per criterion, weights summing to exactly 1.00:

```markdown
## Criteria

### brand-voice · 0.35 · Sounds like the venue wrote it
Good looks like: copy a regular would recognise as the venue's own voice — plain, warm, unfussy.
Avoid: corporate filler; exclamation marks; generic hospitality phrasing.

### booking-clarity · 0.40 · A parent can book in under a minute
Good looks like: every required field is obvious, and the next step is never ambiguous.
Avoid: unexplained jargon; validation errors that don't say how to fix them.
```

Rules that matter:

- **Weights must sum to 1.00.** The validator blocks otherwise, and for a real reason: weights
  share a scale with `score_threshold`, so a rubric summing to 0.6 can never clear an 0.8 threshold
  and the job would loop to its budget cap looking like a bad agent rather than a bad rubric.
- **Criteria must be independent.** If two always move together, they are one criterion with a
  bigger weight. Splitting them just double-counts.
- **Weight by what matters to the client, not by effort.** The hard part is often not the important
  part.
- **`Good looks like:` is what the critic reads.** Write the bar, not the task.

### Validate

```bash
node .wiseai/validate.mjs
```

Expect exactly one error per file — `status is draft` — which is correct. Anything else needs
fixing before you hand it over.

If it warns an Outcome is thin, **fix it rather than reporting the warning**. That warning is the
system telling you the brief will not score well; passing it to the user as a note is passing on
your own unfinished work.

---

## Hand it over

Show the user each criterion with its weight and say, in a sentence each, why you weighted it that
way. Invite correction explicitly — "tell me if any of these are weighted wrong, or if I've
invented one you don't care about."

Be clear about what they are agreeing to: **once a job starts running, its criteria freeze.** Every
score from then on is measured against exactly those, and a rubric that does not match what they
meant produces scores that look precise and mean nothing. This review is the last cheap moment to
catch that.

Then tell them the sequence, which is the same whether it is one job or six:

1. Read the files back.
2. Set `status: ready` on the ones to start — **they can start them a few at a time**, and
   should. Each job has its own budget, so marking six ready commits six budgets at once.
3. Commit and push. The hub picks them up from there.

Don't set `status: ready` for them.

## What this skill does not do

- **It does not dispatch anything.** Creating a brief and starting work are separate decisions.
- **It does not set `status: ready`.**
- **It does not invent budgets or deadlines.** If the user cares, they'll say.
- **It does not score anything.** Scores live in the hub and never enter this repo.
