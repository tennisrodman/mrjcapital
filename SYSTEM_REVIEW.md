# System review and remediation record

This review is intentionally scoped to workflows already present in the product. It does not treat future servicing, investor-portal, reporting, or automation ideas as defects simply because they have not been built yet.

## Current product path

1. A staff user or assigned analyst creates a debt deal and relates sponsor, broker, fund, property, and contact records.
2. The deal moves from Sourced to Screening. A current screening version must contain usable positive economics before an Advance decision can unlock Quoting.
3. Quotes are versioned. A sendable quote needs complete economics and a future expiry; past-due sent/countered quotes no longer progress or execute. Execution requires ready legal term-sheet or LOI evidence.
4. Signed deals move to Closing. Closing packages generate versioned DD and condition-precedent checklists, with protected template requirements, document evidence, non-future actual/funding dates, and terminal-state rules.
5. Closed deals can move to Servicing and then Exited. Active syndication must be resolved before Exited; moving a deal to Dead automatically cancels active syndication.
6. Assigned analysts and staff collaborate through internal notes; staff retain the broader activity ledger. Documents, stage history, contacts, and related-party facts remain attached to the deal workspace.

The lifecycle graph, active-pipeline definition, and upload contract are recorded in `shared/workflow_contracts.json` and exercised by backend contract and Live request-journey tests.

## Current findings addressed

| Area | Failure mode | Resolution |
|---|---|---|
| Frontend errors | Upload and quote failures could render an empty error; failed reference queries could look like empty data | Centralized API error extraction and explicit loading/error/empty states |
| Audit integrity | Closing activity could have blank descriptions; deal-property relationship changes bypassed audit | Shared audit writer and transaction-safe relationship snapshots |
| Lifecycle | Pipeline terminal states and active syndication could contradict each other | Added Cancelled, automatic cancellation on Dead, and a non-overridable Exited blocker |
| Economics | Zero denominators and incomplete amortization could pass workflow readiness | Positive-value screening checks and quote amortization validation at the backend boundary |
| Notes | Only page one loaded; assigned analysts were blocked from the built collaboration UI; edits/deletes lacked dedicated audit evidence | Complete pagination and attachment UX, assigned-analyst access, author/staff capabilities, and atomic Added/Updated/Deleted activity events |
| Documents | UI offered edit/delete actions that the API would reject; interrupted two-phase uploads had no visible audit evidence | API-provided action capabilities plus truthful Started/Completed/Expired upload events and deterministic pagination ordering |
| R2 integrity and retention | Client-declared checksums could be accepted without hashing R2, presigned PUTs did not bind size, and failed blob deletes were forgotten | Signed exact-size/checksum/create-only uploads, trusted completion hashing, and a durable deletion outbox with retry evidence |
| Workflow audit | Screening decisions and deal-contact relationship mutations changed deal readiness/context without timeline evidence; identical quote PATCHes emitted false updates | Atomic screening/contact activity events and actual-diff quote updates |
| Concurrency integrity | A stale ordinary deal PATCH could overwrite a completed transition; screening and quote actions used inconsistent lock order | Fresh locked deal updates and consistent Deal → assessment/quote locking, backed by PostgreSQL contract coverage |
| Time-based readiness | Past-due quotes could still unlock/execute, and future actual close/funding dates could satisfy Closed readiness | Effective quote-expiry guards and non-future closing evidence validation at write and readiness boundaries |
| Closing integrity | Template-derived DD/CP requirements could be deleted until an empty checklist appeared resolved | Template requirements are undeletable and readiness verifies the generated template set remains intact; waivers remain the reasoned exception path |
| Administrative bypasses | Mutable workflow admins could bypass evidence, outbox, note/contact activity, and master-data audit services | Workflow admins are read-only; supporting master-data admins allow seeding but existing records must be changed through audited APIs |
| Collaboration evidence | Notes accepted pending or caller-invisible document IDs | Note attachments require ready, caller-visible documents; analyst edits preserve but do not expose hidden staff attachments |
| Quote/closing audit truth | Identical attachment/item writes and full-form closing saves overstated changes | Actual-diff/no-op behavior across quote attachments, closing package fields, and DD/CP items |
| Seed truthfulness | Legacy demo rows claimed advanced stages without the screening, quote, execution, or closing evidence now required | Separated display fixtures from guarded, service-driven backend lifecycle scenarios; the exerciser rolls back by default |
| Authentication/deploy | Expired access could prevent refresh-token revocation; production built with Node 22 while CI required Node 24 | Refresh-possession logout without an access header and aligned Node 24 Railpack/CI/runtime contract |
| Dashboard metrics | Terminal deals inflated stage age; partial days were truncated; the active-deal caption described a different population | Shared active-stage contract and consistent fractional-day metrics |
| Scale/performance | List helpers silently stopped at 1,000 rows; contacts still stopped after page one; production entry was about 929 kB | Batched uncapped pagination, complete contact loading, lazy routes, and a 450 KiB entry budget |
| Shared API behavior | Staff/deal checks, UUID/boolean parsing, validation translation, numeric coercion, delete guards, and quote cache writes were independently reimplemented | Shared policy, DRF, money, delete-policy, and mutation-cache boundaries |

### Archived findings from the retired Demo runtime

These rows describe remediation that was relevant while a second browser-only business-logic implementation existed. That runtime and its fixtures have since been deleted; the React application now always uses Django.

| Area | Historical failure mode | Historical resolution |
|---|---|---|
| Demo/Live drift | Mock upload and lifecycle behavior could diverge silently | Shared contract vectors and parity tests protected the transition until Demo was removed |
| Demo implemented-flow parity | Closing creation dropped fields; contact failures mutated state; promoted facts/relationships and quote actions lost data or activity | Live-equivalent validation, rollback-safe updates, full reachable field persistence, and deal-timeline parity before removal |

## Lifecycle audit checkpoint — 2026-07-15

Three independent passes reviewed intake/pipeline, screening/quotes, and closing/documents/collaboration, then cross-reviewed another pass before implementation. The review was intentionally calibrated to an internal 2–3-person prototype: it fixed contradictions, data loss, permission leaks, false evidence, and reachable Demo/Live drift without treating unbuilt servicing, investor, or AI features as bugs.

Integrated verification at that checkpoint:

- 274 Django tests pass under SQLite; 10 production-database tests pass against PostgreSQL.
- 154 frontend tests, typecheck, lint, and production build pass.
- Production entry bundle is 388.0 KiB against the 450 KiB budget.
- Migration drift, Django production deploy checks/imports, and `git diff --check` pass.
- CodeGraph is healthy with 239 indexed files.

This is a strong implemented-flow checkpoint, not a claim that future or unimplemented fund operations are complete.

## Live-only workflow checkpoint — 2026-07-16

The browser-only Demo runtime was removed. The React application now always authenticates against and writes to Django, so UI use exercises the same permissions, audit, upload, locking, and readiness boundaries as the API. The former Demo seed was replaced by `shared/workflow_seed.v1.json`, a strictly validated manifest replayed through domain services by guarded development commands.

The Live request-journey regression creates a nested deal and advances it from Sourced through Screening, Quoting, Negotiating, Signed, Closing, and Closed using the same endpoint sequence as the frontend. It includes a verified local upload and quote execution evidence, and reaches Closed without a readiness override. The Closing workspace now supports inline evidence upload, and quote expiration dates round-trip as local calendar dates without negative-offset drift.

Verification at that checkpoint:

- 290 Django tests pass under SQLite (10 PostgreSQL-only skips); the focused PostgreSQL contract/concurrency job passes 10 tests.
- 108 frontend component/unit tests pass, together with typecheck, lint, and the production build.
- The production entry bundle is 384.8 KiB against the 450 KiB budget, and contains no mock-handler runtime.
- Migration drift, applied migrations, Django checks, production settings/imports, and `git diff --check` pass.
- CodeGraph is healthy with 227 indexed files.

The request-journey test verifies the real HTTP contract used by the frontend. The signed-in visual and interactive audit below subsequently supplemented it.

## Browser lifecycle audit checkpoint — 2026-07-16

A signed-in in-app Browser walkthrough created `Browser Lifecycle Audit — 2026-07-16, 08:58 PDT` against the running React and Django services and completed Sourced → Screening → Quoting → Negotiating → Signed → Closing → Closed → Servicing → Exited using only normal UI actions. No readiness override, database edit, Django admin action, or lifecycle bypass was used.

The rendered journey covered login, dashboard and deal-list navigation, optional and nested intake relationships, edit persistence, a finalized Advance assessment, quote v1 create/edit/send, quote v2 counter/edit/send, legal evidence upload, selected-quote execution, negotiation facts, a generated Bridge-loan checklist, DD and CP evidence attachment, final funding facts, terminal transitions, contacts, notes, documents, activity and stage history, disabled/readiness states, validation and upload-recovery behavior, filtering, table/board views, and full-page refresh persistence. Screenshots are retained in `browser-audit-screenshots/`.

The deal correctly allowed sponsor, broker, and property relationships to be omitted at creation and assigned or created later. The audit deal itself used newly created sponsor, broker, and property records to verify the nested path. The existing 20 development deals were left untouched; the new audit deal appears as the 21st record.

The running development configuration used `DOCUMENT_STORAGE_BACKEND=local`; Cloudflare R2 was not required. The audit first verified that quote execution and Signed remained blocked without ready legal evidence. A synthetic local PDF was then genuinely uploaded, attached to quote v2, and used to execute the quote. A second genuinely uploaded closing packet was attached to all four DD and both CP requirements; all six requirements were completed or satisfied without waivers. Actual close date, funds-wired date and amount, final loan amount, counsel, title company, optional economics, sources and uses, and notes were saved before Closed.

The lifecycle header accurately updated through all nine stage events. Closed exposed only Servicing, Servicing exposed only Exited, and Exited disabled further moves. Syndication remained the resolved terminal value `Not syndicated`; its dialog truthfully reported that no syndication moves were available. Servicing is implemented as a lifecycle stage and audit event, but there is no separate servicing workspace or servicing operations surface. A final refresh preserved Exited, both protected documents, nine stage events, and 53 activity entries. Browser warning/error logs were empty.

Five verified defects were corrected and covered by regression tests:

- **Medium — local uploads failed with 401.** Local upload/download targets were absolute backend URLs, so the frontend correctly treated them as cross-origin and withheld the bearer token. Local targets now use same-origin `/api/.../blob/` paths; the R2 contract remains external. Backend regression assertions cover both target URLs, and the browser verified recovery from the failed pending v1 to a ready v2 upload.
- **Medium — date-only values could render one day early west of UTC.** Date-only formatting now preserves the stored calendar date.
- **Low — a newly created note could be labeled `edited`.** Parsed instants are now compared so sub-millisecond server precision does not create a false label.
- **Low — contact mutations left deal Activity stale.** Contact mutation hooks now invalidate the deal-activity cache; the live panel refreshed without a page reload.
- **Low — raw purpose, profile, and sponsor entity codes leaked into detail UI.** Shared labels now render `Acquisition`, `Value-add`, and `LLC` and supply the corresponding form options.

The revised lifecycle header and workflow navigation were observed at every remaining stage, including terminal disabled state. The revised upload modal remained readable and scroll-safe while handling both the failed upload and successful recovery.

Verification at this checkpoint:

- 290 Django tests pass under SQLite (10 PostgreSQL-only skips).
- All 10 focused PostgreSQL contract/concurrency tests pass.
- All 108 frontend tests pass; focused browser-fix coverage passes 13 tests across the affected frontend suites, and the local-target backend contract is asserted in the document upload flow.
- Frontend typecheck, lint, production build, and the 450 KiB entry budget pass; the entry remains 384.8 KiB.
- Migration drift, applied migrations, Django development and production deploy checks, production WSGI import, browser console warning/error review, and `git diff --check` pass.
- CodeGraph is healthy with 230 indexed files, 3,512 nodes, and 4,912 edges.

## Historical committed checkpoints

Committed remediation through the notes extraction remains reviewable and reversible:

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
- `f003f58` — extract the deal notes workspace component

The Live-only remediation, Demo removal, lifecycle scenario commands, browser fixes, and recent lifecycle-navigation work remain in the current uncommitted worktree across roughly 90 tracked files plus new files. They should be split into coherent review commits before this state is treated as a release checkpoint; this audit deliberately did not stage or commit the user's work.

## Existing-flow limitations still worth tracking

These are bounded limitations of surfaces that already exist, not a wishlist of unbuilt product areas:

- Activity metadata filtering has separate PostgreSQL and SQLite implementations. The full fast suite remains SQLite; production-database JSON/concurrency modules now run in a dedicated PostgreSQL CI job.
- Lists now return every matching row, which fixes truncation. A future server-driven board/table pagination design will be preferable once normal datasets are large enough that loading every deal is itself too costly.
- The main deal detail and closing screens are route-split, but remain large composition files. The notes surface is now a feature component; continue extracting cohesive panels rather than extending either page.
- DD and condition-precedent services still contain parallel mutation paths. Their invariants are tested, but a future generic checklist-item workflow should be introduced only with model/status adapters and the existing rollback suite protecting the refactor.
- R2 completion performs a bounded trusted streaming read (maximum 50 MiB by default) to independently verify the object. If upload volume grows materially, move this verification to a worker while retaining the same pending-to-ready boundary. Deletion is deliberately delayed until its upload capability expires, so UI deletion is truthful but not immediate physical erasure.
- Quote expiry is enforced synchronously by readiness and mutation guards; there is no periodic job that rewrites every past-due row to the `expired` label. The stored `expires_at` remains the effective source of truth.
- Supporting master-data creation remains available in Django admin for prototype seeding, but edits/deletes are API-only so linked-deal audit cannot be bypassed.
- The June 2026 database demo rows predate current workflow evidence requirements. Treat them as historical display snapshots, not proof that today’s services produced their stages. New validation should use `exercise_deal_lifecycle` or the tagged development scenarios.
- The persistent seed matrix covers the forward lifecycle but not On hold/resume, Decline/Dead, explicit readiness overrides, or automatic active-syndication cancellation. Backend tests cover those side branches; persistent development scenarios do not yet demonstrate them.
- Servicing currently consists of the Closed → Servicing → Exited stage transitions, history, and activity evidence. A dedicated servicing workspace is not implemented and was not inferred or simulated by the browser audit.
- The global Documents navigation entry remains a `Coming soon` placeholder. Deal-scoped document upload, download, metadata, protected-delete states, quote attachment, and checklist attachment are implemented and were exercised.

## Checkpoint standard

Every future workflow stage should stop and commit only after:

1. Live service/serializer tests cover its invariant and rollback behavior.
2. Live request-contract and component tests cover every reachable UI path and its error shape.
3. Frontend loading, failure, empty, disabled, and success states are distinct.
4. Mutations invalidate the affected query caches and write required audit evidence atomically.
5. `makemigrations --check`, frontend typecheck/lint/tests/build, the SQLite backend suite, and the PostgreSQL contract job pass.

The PostgreSQL job is intentionally focused on vendor-specific contracts and races; the SQLite suite remains the complete fast behavioral regression suite.
