# Guided First Credible Leak Pilot V1

## Outcome

- Problem: TGE's secure import, deterministic leak detection, case review, and
  human-controlled action capabilities are individually credible, but a pilot
  operator still needs product knowledge to supply the right CSV and reconnect
  the end-to-end path after interruption.
- Intended observable result: a small or medium B2B operator with an ordinary
  CRM/spreadsheet export can follow a truthful CSV-first setup and reach either
  one evidence-backed stalled-opportunity case or an exact actionable
  insufficient-evidence result in a guided session.
- Pilot hypotheses to measure, not validated claims: Time to First Credible Leak
  at most 15 minutes, at least 2/3 operator completion, and at least 4/5
  first-case trust.
- Explicit non-goals: Quote Recovery, additional detectors, native CRM
  connectors, connector frameworks, attribution/ROI claims, autonomous
  outbound, AI ranking, generic workflow automation, scheduling/dispatch, broad
  CRM replacement, and any silent state-mutating detector run.

## Authority and starting state

- GitHub Issue #14 was approved by the repository owner on 2026-09-14 as this
  exact three-slice milestone. Slice 2 depends on merged Slice 1; Slice 3 depends on merged Slice 2.
- Slice 1 starts from `ea22ce9cb06498f6f6c59ee5642d6ede2e7cea35`,
  exact `origin/main`, on isolated branch `feat/guided-first-value-intake` and
  worktree `guided-first-value-intake`. Preflight was clean, including ignored
  files, and the branch was 0 behind / 0 ahead.
- The completed Pilot Readiness record moved to
  `../completed/pilot-readiness.md`; its evidence is preserved and is not active
  authorization for additional infrastructure, retention, or provider work.
- Migrations `001`-`016` are the immutable Slice 1 baseline. Their SHA-256
  values are recorded below; no schema or migration is authorized unless
  existing durable server truth is first shown insufficient and an independent
  architecture review establishes the need.

## Boundaries and decisions

| Area | Decision | Evidence / owner |
| --- | --- | --- |
| Pilot customer | Small/medium B2B businesses with an existing sales pipeline and ordinary CRM/spreadsheet exports. | Issue #14 owner approval |
| Ingestion | CSV is the only supported pilot ingestion mechanism; templates are inert downloads and never auto-upload or import. | Issue #14 owner approval |
| Tenant/business context | Use authenticated membership/tenant context and persisted import/source facts. The browser never invents a business name or supplies tenant authority. | Secure Pilot and import contracts |
| Resume authority | Derive the current step from existing server-returned batch/import/Pilot evidence truth. Browser-only progress cannot authorize or imply a completed step. | Import and Pilot evidence APIs |
| Detection | Stalled-opportunity execution remains an explicit user action. Slice 1 does not invoke, change, or schedule it. | Issue #14 owner approval |
| Product truth | Preserve known/zero/unknown and authoritative currency distinctions, immutable import/case evidence, sample exclusion, and explicit insufficient-evidence states. | Repository architecture and Issue #14 |
| Recovery | Existing request generations and ambiguous-outcome reconciliation remain authoritative. Stale, malformed, or unknown durable state fails visibly with a useful retry/restart action. | Browser import contracts |
| Compatibility | Preserve existing upload, preview, mapping, Data Health, confirmation, and commit APIs. No connector abstraction or new persistence. | Slice 1 scope |

## Dependency sequence

- [ ] **Slice 1 — Guided intake and resumable setup.** Guided business/source
  context; downloadable CSV templates and field guidance; explicit
  commit-supported versus preview-only collection capabilities; and server-
  truth-derived resumability. No detector, case/action, operational eligibility,
  session-result, persistence, schema, or migration changes.
- [ ] **Slice 2 — Operational Data Health and eligibility.** After Slice 1 is
  merged, add post-commit operational Data Health, inspectable stalled-
  opportunity eligibility, exact missing/stale/invalid/suppressed reasons,
  actionable remediation, and truthful dataset coverage. No additional
  detectors.
- [ ] **Slice 3 — First-value operating journey.** After Slice 2 is merged, make
  explicit scan the clear post-commit continuation, provide a credible case or
  actionable no-case explanation, cohere inspection/feedback/RevenueAction
  handoff, make the case queue the effective operating home, complete 390px
  journey usability, and expose a privacy-minimized pilot-session result.

## Slice 1 bounded implementation plan

1. Characterize every collection currently presented by the Import UI against
   preview and canonical-commit repository support. Add RED browser-contract
   tests for truthful capability labels, inert downloadable templates, and
   practical field guidance for commit-supported collections.
2. Characterize existing authenticated tenant/session, import batch, preview,
   analysis, commit, and Pilot evidence responses. Add RED tests for a guided
   supported path and reload/navigation recovery derived only from server facts,
   including stale/unknown/error states.
3. Implement the smallest coherent browser/API-client composition. Reuse the
   current import APIs and persisted facts; do not add a server write merely to
   track UI steps. Keep templates clearly marked as templates/sample structure,
   with no automatic upload/import and no eligibility as first-value evidence.
4. Verify the smallest focused tests, then the affected import/browser-contract
   set. Use the managed browser wrapper only for focused desktop/390px visible
   smoke evidence. Run the engineering harness and diff/artifact/migration
   hygiene near the final implementation checkpoint.
5. Stop at a clean local implementation checkpoint for independent review. Do
   not push, open a PR, start GitHub CI, run the expensive full PostgreSQL/build/
   repository Verify delivery gates, or begin Slice 2/3.

## Acceptance evidence required for Slice 1

- Every displayed collection is labeled from repository truth as canonical
  commit-supported or preview-only.
- The operator can download a clearly labeled CSV template/field guide for each
  commit-supported collection without automatic upload/import.
- A supported guided path enters the existing upload/preview/mapping/Data
  Health/confirmation flow without changing those authority contracts.
- Reload/navigation resumes to the truthful server-derived step. Unknown,
  malformed, expired, or stale server state is never promoted to progress and
  exposes a useful next action.
- No sample/real mixing, unknown-to-zero/currency inference, client tenant
  authority, detector execution, external send, connector, or Slice 2/3 behavior
  is introduced.
- Focused desktop and 390px smoke coverage passes.

## Verification

| Level | Command or inspection | Expected evidence |
| --- | --- | --- |
| Preflight | branch/HEAD/origin/merge-base/status/worktrees; instructions; Issue #14; current plans/code/tests | Exact `ea22ce9`; clean; authoritative scope available |
| RED | Focused browser/import contract tests added before product edits | Deterministic failures for the absent guidance/capability/resume behavior |
| GREEN | Same focused tests, then affected import/API/browser-contract tests | New behavior and preserved contracts pass |
| Visible smoke | `npm run test:e2e -- <focused managed spec>` when needed | Desktop and 390px guided/resume flow passes without developer data |
| Proportional gate | `npm run test:harness`; migration byte comparison; `git diff --check`; artifact scan | Harness and hygiene pass; migrations `001`-`016` unchanged |

## Migration baseline

```text
001 d08f3b7e5c97e05a5ec7f96242543fbbf437d7af4edea34d22dc09db910cfc62
002 a95f94263c5a1dd1a246a3be905e7f27bd5f4222ba871c137cf90fa2faf17c1c
003 311a02a67deb09ad44b2782f90c2ff3c67d6a537ca9b9ed1f116cafd37a149a8
004 ad9633daf1dd791c8889c79745d8741bace24e0827b76d3fec59d6d73371aa2d
005 2e9bc0029cbfdc03828de7784aa19014de3f7e988cc8f5668bcacd729e206a66
006 f110d2f7937c6133ed1785df05be8c3ca725add7d207a6d94b8a27610b3bca6f
007 514d12b74519405b28e76960244483880f01092b30bcac650a97f247469f4dc6
008 7e4f8b74df1ecc496fa6c7ac8b55169d3e7db7efccdcf3f1f7d0ad37aa95cd72
009 f248d2d5a7363331cd4f4732551a62f9ac28f3315ad5e9777ded1547657d3736
010 fcb19ddba6c2d5bc654af0c3a3172505675dd5c4160876d717b51943b2863e03
011 df50ee0697bb7849b3575f9f5aef40673855ec77a4ebcfcd0cf0d8d5e59ca04b
012 0ec9ffaf16987d84b319b6dc579edea86bbedcd3cff65f8b9d881f9c4dbba6d8
013 b27c7d6c69990f459b1e51c0d902d55f6a1f44fbf17accb69459b2c26465f6a8
014 699cb9c1e7fc4319f71cf7e98e99934706f9f75a8f0f00ae9c22ff90c5c9ea10
015 1f33b8656dbd2c3a05adc9a540412efcac41a8540673bee0e52e510b0e40fcd5
016 ee981ed3362d1a5d111a487d4edb68b4f5343830adf3c2b9e1a1e033e8531ab3
```

## Evidence log

- 2026-09-14 planning preflight: exact worktree and branch; `HEAD`,
  `origin/main`, and merge-base all `ea22ce9cb06498f6f6c59ee5642d6ede2e7cea35`;
  0 behind / 0 ahead; tracked, untracked, and ignored status clean.
- Repository, scoped web/test instructions, Project State, execution-plan index,
  completed Pilot Readiness evidence, completed first-value evidence, and live
  Issue #14 approval were inspected before the plan was changed.

## Review and handoff

- Implementer self-check: pending Slice 1 implementation.
- Fresh reviewer findings/resolution: pending after the local implementation
  checkpoint.
- Final-review evidence: coordinator-owned after any bounded remediation.
- Debt/follow-up: Slice 2 and Slice 3 remain dependency-gated; all explicit
  milestone non-goals remain out of scope.
