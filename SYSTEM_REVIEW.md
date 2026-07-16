# System review and remediation record

This review is intentionally scoped to workflows already present in the product. It does not treat future servicing, investor-portal, reporting, or automation ideas as defects simply because they have not been built yet.

## Current product path

1. A staff user or assigned analyst creates a debt deal and relates sponsor, broker, fund, property, and contact records.
2. The deal moves from Sourced to Screening. A current screening version must contain usable positive economics before an Advance decision can unlock Quoting.
3. Quotes are versioned. A sendable quote needs complete economics; execution requires ready legal term-sheet or LOI evidence.
4. Signed deals move to Closing. Closing packages generate versioned DD and condition-precedent checklists, with document evidence and terminal-state rules.
5. Closed deals can move to Servicing and then Exited. Active syndication must be resolved before Exited; moving a deal to Dead automatically cancels active syndication.
6. Assigned analysts and staff collaborate through internal notes; staff retain the broader activity ledger. Documents, stage history, contacts, and related-party facts remain attached to the deal workspace.

The lifecycle graph, active-pipeline definition, and upload contract shared by Live and Demo are recorded in `shared/workflow_contracts.json` and exercised by both Python and TypeScript tests.

## Major findings addressed

| Area | Failure mode | Resolution |
|---|---|---|
| Frontend errors | Upload and quote failures could render an empty error; failed reference queries could look like empty data | Centralized API error extraction and explicit loading/error/empty states |
| Audit integrity | Closing activity could have blank descriptions; deal-property relationship changes bypassed audit | Shared audit writer and transaction-safe relationship snapshots |
| Lifecycle | Pipeline terminal states and active syndication could contradict each other | Added Cancelled, automatic cancellation on Dead, and a non-overridable Exited blocker |
| Economics | Zero denominators and incomplete amortization could pass workflow readiness | Positive-value screening checks and quote amortization validation in Live and Demo |
| Notes | Only page one loaded; assigned analysts were blocked from the built collaboration UI; edits/deletes lacked dedicated audit evidence | Complete pagination and attachment UX, assigned-analyst access, author/staff capabilities, and atomic Added/Updated/Deleted activity events |
| Documents | UI offered edit/delete actions that the API would reject; interrupted two-phase uploads had no visible audit evidence | API-provided action capabilities plus truthful Started/Completed/Expired upload events and deterministic pagination ordering |
| Demo/Live drift | Mock upload and lifecycle behavior could diverge silently | Shared contract vectors and parity tests |
| Dashboard metrics | Terminal deals inflated stage age; partial days were truncated; the active-deal caption described a different population | Shared active-stage contract and consistent fractional-day metrics in Live and Demo |
| Scale/performance | List helpers silently stopped at 1,000 rows; contacts still stopped after page one; production entry was about 929 kB | Batched uncapped pagination, complete contact loading, lazy routes, dynamic Demo engine, and a 450 KiB entry budget |
| Shared API behavior | Staff/deal checks, UUID/boolean parsing, validation translation, numeric coercion, delete guards, and quote cache writes were independently reimplemented | Shared policy, DRF, money, delete-policy, and mutation-cache boundaries |

## Commit checkpoints

The remediation was deliberately staged so each logical change is reviewable and reversible:

- `4a6403e` — baseline checkpoint
- `703737d`, `9e3fb99` — frontend failure-state correctness
- `93f55c0`, `d9630cf` — audit integrity
- `cdcff16`, `7493ac8` — lifecycle and economic invariants
- `1cceb24`, `3ceb6e5`, `e77d135` — notes and document action completion
- `1f3612d` — Demo/Live contract parity
- `d5264f5`, `8ff24d6`, `41b8964` — modularity, pagination, and bundle controls
- `4e25f52` — upload lifecycle audit, deterministic document ordering, and full contact pagination
- `c5e30e6` — active-pipeline and stage-timing correctness
- `9cd8154` — shared request/workflow primitives and Node/CI alignment
- `e72b014` — assigned-analyst note collaboration and complete note audit lifecycle

## Existing-flow limitations still worth tracking

These are bounded limitations of surfaces that already exist, not a wishlist of unbuilt product areas:

- Activity metadata filtering has separate PostgreSQL and SQLite implementations. The common behavior is tested, while PostgreSQL concurrency and JSON containment contracts remain in their opt-in PostgreSQL test modules.
- Lists now return every matching row, which fixes truncation. A future server-driven board/table pagination design will be preferable once normal datasets are large enough that loading every deal is itself too costly.
- The main deal detail and closing screens are route-split, but remain large composition files. The notes surface is now a feature component; continue extracting cohesive panels rather than extending either page.
- DD and condition-precedent services still contain parallel mutation paths. Their invariants are tested, but a future generic checklist-item workflow should be introduced only with model/status adapters and the existing rollback suite protecting the refactor.

## Checkpoint standard

Every future workflow stage should stop and commit only after:

1. Live service/serializer tests cover its invariant and rollback behavior.
2. Demo tests cover every reachable UI path with the same status and error shape.
3. Frontend loading, failure, empty, disabled, and success states are distinct.
4. Mutations invalidate the affected query caches and write required audit evidence atomically.
5. `makemigrations --check`, frontend typecheck/lint/tests/build, and the SQLite backend suite pass.

PostgreSQL-specific concurrency tests remain valuable release checks, but are intentionally not required for this remediation checkpoint.
