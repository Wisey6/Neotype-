#!/usr/bin/env node
// Checks WiseAI goal files are well-formed.
//
//   node .wiseai/validate.mjs                     every job file
//   node .wiseai/validate.mjs .wiseai/jobs/x.md   one file
//
// Standalone and dependency-free on purpose: it runs in the client's repo,
// where there is no node_modules and no build step. The hub runs its own copy
// of these rules before dispatch; a conformance test in the WiseAI workspace
// runs both over the same corpus and fails if their verdicts ever differ, so
// "it passed locally but the hub refused it" cannot happen.
//
// Exit codes: 0 = every file dispatchable, 1 = at least one error, 2 = bad usage.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const JOBS_DIR = ".wiseai/jobs";
const REQUIRED_SECTIONS = ["Outcome", "Constraints", "Done means"];
const CRITERION_HEADING = /^###\s+([a-z0-9][a-z0-9-]*)\s*[·|]\s*([0-9.]+)\s*[·|]\s*(.+?)\s*$/;
const GOOD_PREFIX = /^good looks like:\s*/i;
const AVOID_PREFIX = /^avoid:\s*/i;

/** Parses the ## Criteria section. Mirrors packages/shared/src/goal-file.ts. */
export function parseCriteriaSection(section) {
  const issues = [];
  const criteria = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    criteria.push({
      id: current.id,
      name: current.name,
      weight: current.weight,
      whatGoodLooksLike: current.good.join(" ").trim(),
      commonFailures: current.avoid.join(" ").split(";").map((x) => x.trim()).filter(Boolean),
    });
    current = null;
  };

  for (const line of section.split("\n")) {
    const h = CRITERION_HEADING.exec(line);
    if (h) {
      flush();
      const weight = Number(h[2]);
      if (!Number.isFinite(weight)) {
        issues.push({ severity: "error", message: `criterion ${h[1]}: weight is not a number` });
      }
      current = { id: h[1], weight, name: h[3], good: [], avoid: [] };
      continue;
    }
    if (!current) continue;
    const t = line.trim();
    if (t === "") continue;
    if (GOOD_PREFIX.test(t)) current.good.push(t.replace(GOOD_PREFIX, ""));
    else if (AVOID_PREFIX.test(t)) current.avoid.push(t.replace(AVOID_PREFIX, ""));
    else current.good.push(t);
  }
  flush();

  for (const c of criteria) {
    if (c.whatGoodLooksLike === "") {
      issues.push({
        severity: "error",
        message: `criterion ${c.id}: needs a "Good looks like:" line — the critic scores against it`,
      });
    }
  }

  const ids = criteria.map((c) => c.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length > 0) {
    issues.push({ severity: "error", message: `duplicate criterion ids: ${dupes.join(", ")}` });
  }

  if (criteria.length > 0) {
    const total = criteria.reduce((s, c) => s + (Number.isFinite(c.weight) ? c.weight : 0), 0);
    if (Math.abs(total - 1) > 0.001) {
      issues.push({
        severity: "error",
        message: `criterion weights sum to ${total.toFixed(2)}, must be 1.00`,
      });
    }
  }

  return { criteria, issues };
}
const THIN_OUTCOME_WORDS = 100;

export function slugFromPath(path) {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** A leading underscore means "not a job" — _TEMPLATE.md, _notes.md. */
export function isJobFile(path) {
  const base = path.split("/").pop() ?? path;
  return base.toLowerCase().endsWith(".md") && !base.startsWith("_");
}

function splitFrontMatter(raw) {
  const s = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!s.startsWith("---\n")) return null;
  const end = s.indexOf("\n---", 3);
  if (end === -1) return null;
  return { frontMatter: s.slice(4, end), body: s.slice(s.indexOf("\n", end + 1) + 1) };
}

function parseSimpleYaml(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const colon = t.indexOf(":");
    if (colon === -1) continue;
    const key = t.slice(0, colon).trim();
    let value = t.slice(colon + 1).trim();
    const hash = value.indexOf(" #");
    if (hash !== -1) value = value.slice(0, hash).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function parseSections(body) {
  const out = {};
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current !== null) out[current] = buffer.join("\n").trim();
    buffer = [];
  };
  for (const line of body.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      current = m[1];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return out;
}

export function validateGoalFile(path, raw) {
  const issues = [];
  const err = (m) => issues.push({ severity: "error", message: m });
  const warn = (m) => issues.push({ severity: "warning", message: m });

  const fm = splitFrontMatter(raw);
  if (!fm) {
    return {
      issues: [
        {
          severity: "error",
          message: "missing front matter — the file must start with a `---` delimited block",
        },
      ],
      dispatchable: false,
    };
  }

  const f = parseSimpleYaml(fm.frontMatter);

  if (!f.title || f.title.trim() === "") err("front matter: title — title must not be empty");

  if (f.status !== undefined && f.status !== "draft" && f.status !== "ready") {
    err("front matter: status — must be `draft` or `ready`");
  }

  // Optional: the larger goal this job is one step toward. Jobs keep their own
  // narrow rubrics; the milestone is what makes a set of them add up on the hub.
  if (f.milestone !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(f.milestone)) {
    err("front matter: milestone — milestone must be a lowercase slug, e.g. party-booking-launch");
  }

  const budget = f.budget_usd === undefined ? undefined : Number(f.budget_usd);
  if (budget === undefined) err("front matter: budgetUsd — Required");
  else if (!Number.isFinite(budget)) err("front matter: budgetUsd — Expected number, received nan");
  else if (budget <= 0) err("front matter: budgetUsd — budget_usd must be greater than 0");

  if (f.max_iterations !== undefined) {
    const n = Number(f.max_iterations);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 20) {
      err("front matter: maxIterations — must be a whole number between 1 and 20");
    }
  }

  if (f.score_threshold !== undefined) {
    const n = Number(f.score_threshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      err("front matter: scoreThreshold — must be between 0 and 1");
    }
  }

  const sections = parseSections(fm.body);
  for (const name of REQUIRED_SECTIONS) {
    if (sections[name] === undefined) err(`missing required section: ## ${name}`);
    else if (sections[name].trim() === "") err(`section ## ${name} is empty`);
  }

  const slug = slugFromPath(path);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    err(`filename "${slug}" must be lowercase letters, numbers and dashes (it becomes the slug)`);
  }

  const parsedCriteria = parseCriteriaSection(sections.Criteria ?? "");
  issues.push(...parsedCriteria.issues);

  const claimsReady = (f.status ?? "draft") === "ready";

  if (claimsReady && parsedCriteria.criteria.length === 0) {
    err(
      "no ## Criteria yet — a job cannot dispatch without a rubric, since there would be " +
        "nothing for the critic to score against",
    );
  }

  if (!claimsReady) {
    err("status is `draft` — set it to `ready` when the brief is finished");
  }

  const words = (sections.Outcome ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words > 0 && words < THIN_OUTCOME_WORDS) {
    warn(
      `## Outcome is ${words} words. A critic cannot score meaningfully against a thin brief — ` +
        `describe what an impressive result looks like, not just what to build.`,
    );
  }

  return { issues, dispatchable: !issues.some((i) => i.severity === "error") };
}

// --- CLI -------------------------------------------------------------------

function main(argv) {
  const targets = argv.length > 0 ? argv : listJobFiles();

  if (targets.length === 0) {
    console.log(`no job files found in ${JOBS_DIR}/`);
    return 0;
  }

  let failed = 0;
  for (const path of targets) {
    if (!existsSync(path)) {
      console.error(`✗ ${path} — file not found`);
      failed++;
      continue;
    }

    const result = validateGoalFile(path, readFileSync(path, "utf8"));
    const mark = result.dispatchable ? "✓" : "✗";
    console.log(`${mark} ${basename(path)}${result.dispatchable ? " — ready to dispatch" : ""}`);

    for (const issue of result.issues) {
      console.log(`    ${issue.severity === "error" ? "✗" : "!"} ${issue.message}`);
    }
    if (!result.dispatchable) failed++;
  }

  if (failed > 0) console.log(`\n${failed} file(s) not dispatchable`);
  return failed > 0 ? 1 : 0;
}

function listJobFiles() {
  if (!existsSync(JOBS_DIR)) return [];
  return readdirSync(JOBS_DIR)
    .filter((n) => isJobFile(n))
    .sort()
    .map((n) => join(JOBS_DIR, n));
}

// Only run the CLI when invoked directly, so the conformance test can import
// these functions without the process exiting underneath it.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
