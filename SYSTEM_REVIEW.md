# System review and remediation record

This review is intentionally scoped to workflows already present in the product. It does not treat future servicing, investor-portal, reporting, or automation ideas as defects simply because they have not been built yet.

## Current product path

1. A staff user or assigned analyst creates a debt deal and relates sponsor, broker, fund, property, and contact records.
2. The deal moves from Sourced to Screening. A current screening version must contain usable positive economics before an Advance decision can unlock Quoting.
3. Quotes are versioned. A sendable quote needs complete economics; execution requires ready legal term-sheet or LOI evidence.
4. Signed deals move to Closing. Closing packages generate versioned DD and condition-precedent checklists, with document evidence and terminal-state rules.
5. Closed deals can move to Servicing and then Exited. Active syndication must be resolved before Exited; moving a deal to Dead automatically cancels active syndication.
6. Internal notes, activity, documents, stage history, contacts, and related-party facts remain attached to the deal workspace.

The lifecycle graph and upload contract shared by Live and Demo are recorded in `shared/workflow_contracts.json` and exercised by both Python and TypeScript tests.

## Major findings addressed

| Area | Failure mode | Resolution |
|---|---|---|
| Frontend errors | Upload and quote failures could render an empty error; failed reference queries could look like empty data | Centralized API error extraction and explicit loading/error/empty states |
| Audit integrity | Closing activity could have blank descriptions; deal-property relationship changes bypassed audit | Shared audit writer and transaction-safe relationship snapshots |
| Lifecycle | Pipeline terminal states and active syndication could contradict each other | Added Cancelled, automatic cancellation on Dead, and a non-overridable Exited blocker |
| Economics | Zero denominators and incomplete amortization could pass workflow readiness | Positive-value screening checks and quote amortization validation in Live and Demo |
| Notes | Only page one loaded; attachments were anonymous; delete lacked confirmation; edit existed only in the API | Complete pagination, named downloads, missing-attachment state, confirmation, and edit UI |
| Documents | UI offered edit/delete actions that the API would reject | API-provided action capabilities and reasons, with matching Demo behavior |
| Demo/Live drift | Mock upload and lifecycle behavior could diverge silently | Shared contract vectors and parity tests |
| Scale/performance | List helpers silently stopped at 1,000 rows; production entry was about 929 kB | Batched uncapped pagination, lazy routes, dynamic Demo engine, and a 450 KiB entry budget |
| Authorization duplication | Staff and deal-access checks were independently reimplemented | Shared `api.policies` boundary |

## Commit checkpoints

The remediation was deliberately staged so each logical change is reviewable and reversible:

- `4a6403e` — baseline checkpoint
- `703737d`, `9e3fb99` — frontend failure-state correctness
- `93f55c0`, `d9630cf` — audit integrity
- `cdcff16`, `7493ac8` — lifecycle and economic invariants
- `1cceb24`, `3ceb6e5`, `e77d135` — notes and document action completion
- `1f3612d` — Demo/Live contract parity
- `d5264f5`, `8ff24d6`, `41b8964` — modularity, pagination, and bundle controls

## Existing-flow limitations still worth tracking

These are bounded limitations of surfaces that already exist, not a wishlist of unbuilt product areas:

- Notes are intentionally staff-only even though their current UI language describes internal collaboration. Opening them to assigned analysts requires an explicit author/staff edit and delete policy, not only a frontend toggle.
- Note body edits and deletes preserve the original Note Added audit row, but do not create separate Note Updated or Note Deleted activity types. Add those events before treating note history as a complete compliance ledger.
- Activity metadata filtering has separate PostgreSQL and SQLite implementations. The common behavior is tested, while PostgreSQL concurrency and JSON containment contracts remain in their opt-in PostgreSQL test modules.
- Lists now return every matching row, which fixes truncation. A future server-driven board/table pagination design will be preferable once normal datasets are large enough that loading every deal is itself too costly.
- The main deal detail and closing screens are route-split, but remain large composition files. New panels should be added as feature components rather than extending those files further.

## Checkpoint standard

Every future workflow stage should stop and commit only after:

1. Live service/serializer tests cover its invariant and rollback behavior.
2. Demo tests cover every reachable UI path with the same status and error shape.
3. Frontend loading, failure, empty, disabled, and success states are distinct.
4. Mutations invalidate the affected query caches and write required audit evidence atomically.
5. `makemigrations --check`, frontend typecheck/lint/tests/build, and the SQLite backend suite pass.

PostgreSQL-specific concurrency tests remain valuable release checks, but are intentionally not required for this remediation checkpoint.
