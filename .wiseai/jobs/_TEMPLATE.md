---
title:
status: draft          # draft | ready — only `ready` can be dispatched
budget_usd: 25
max_iterations: 5
score_threshold: 0.80
# milestone: <slug>   # optional — the larger goal this job is one step toward,
#                     # matching .wiseai/milestones/<slug>.md
---

## Outcome

<!-- What does a successful, impressive result look like? Write it for someone
     who has never seen this project. This is the text the critic scores
     against, so vague here means meaningless scores later. -->

## Constraints

<!-- What must it not do? Existing behaviour to preserve, files to leave alone,
     conventions to follow. -->

## Done means

<!-- Concrete, checkable statements. Good: "a timer started at 90 minutes shows
     89:59 after one second". Bad: "the timer works properly". -->

## Criteria

<!-- Derived from ## Outcome, then corrected by you. Weights must sum to 1.00.
     Ask Claude to derive these once the Outcome is written; review them before
     setting status: ready, because once a job dispatches they are frozen and
     every score is measured against them.

### example-id · 0.50 · Short name for this criterion
Good looks like: what a passing result does, specifically.
Avoid: ways this is typically missed; semicolon-separated.
-->
