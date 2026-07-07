# AI Investment Manager TODO

Source document: `docs/AI Investment Manager_Deal_Lifecycle_Platform_Guide_SR CLEAN.pdf`

This file tracks the incremental path from the current MRJ Capital app toward the deal lifecycle platform described in the PDF. The PDF should be treated as directional, not final product scope.

## Current Position

The app already has the right lifecycle spine:

- One `Deal` model with `investment_type`, derived `investment_category`, `pipeline_status`, `syndication_status`, sponsor, broker, fund, assigned analyst, requested amount, and flexible `details`.
- Explicit pipeline and syndication state machines with allowed transitions, on-hold resume behavior, required reasons, and audit logging.
- Deal documents with categories, versioning, visibility roles, storage status, executed flag, expiry date, and upload/download flow.
- Sponsor sensitive fields with encrypted storage and logged access.
- Frontend pipeline board/table, deal detail page, document upload/download, transition controls, and staff activity feed.

The product is currently best described as an origination and document pipeline. It is not yet the AI investment manager described in the PDF.

## Main Gaps

- Sourcing is only partially covered.
- Screening, quoting, negotiation, closing, capital raising, and servicing are mostly status labels plus free-form `details` and uploaded documents.
- No first-class records yet for screening results, credit box rules, equity screen rules, quote variants, term sheets, LOIs, deposits, exclusivity, DD checklist items, conditions precedent, capital stack, investors, payments, draws, covenants, waterfall logic, or watchlist workflows.
- Live deal creation does not match the richer Demo-mode create flow. The frontend can submit nested sponsor, broker, and property objects, but the backend currently expects existing FK IDs plus `property_ids`.

## Recommended Sequence

1. Fix live deal intake parity. `Implemented 2026-07-07`
   - Support flexible creation where the client can create only a deal, a deal plus new sponsor, a deal plus new property, a deal plus new broker, or any mix of existing and new related records.
   - Preserve the ability to start a sparse deal and add more information later.
   - Keep sponsor, broker, and property reassignment rules conservative after creation.

2. Promote core sourcing and screening fields out of loose `details`.
   - Add only fields that drive workflow decisions: source contact, deal purpose/profile, property basics, proposed debt metrics, target equity metrics, sponsor experience, quick score, screening decision, and screening notes.
   - Keep uncertain or rarely used fields in `details` until the workflow proves they matter.

3. Add a debt-first screening assessment.
   - Start with a `ScreeningAssessment` or equivalent.
   - Store credit-box result JSON, quick score, recommendation, reviewer, reviewed date, notes, and generated memo document link.
   - Begin with configurable threshold records before building a full rules engine.

4. Add lightweight notes/activity.
   - Add deal notes/comments with optional document attachment links.
   - Log note creation in `ActivityLog`.
   - Defer full email-client behavior.

5. Add DD checklist templates and checklist items.
   - Key templates by `investment_type` and `property_type`.
   - Generate deal-level items when a deal enters closing.
   - Track item owner, due date, status, linked documents, received date, and notes.

6. Add quote/LOI records before document generation.
   - Model quote version, status, sent/expiry/signed dates, and core debt/equity terms.
   - Let generated or uploaded term sheets/LOIs attach to a quote record.

7. Defer capital raising and servicing until closing workflow is usable.
   - Investor matching, capital calls, waterfalls, draw management, payments, covenants, and watchlist workflows are larger product areas.
   - Build them after sourcing through DD is operational.

## Research Notes For Item 1: Flexible Live Intake

The current mock API already demonstrates the desired shape:

- `sponsor`: existing sponsor ID or a new sponsor object.
- `broker`: `null`, existing broker ID, or a new broker object.
- `properties`: array of existing property IDs and/or new property objects.
- `fund`: optional existing fund ID or `null`.

The live backend should formalize that contract rather than forcing the frontend to orchestrate several separate POST requests. A single atomic endpoint is better for first intake because a user expects "Create deal" to either create the complete requested bundle or fail without partial records.

Recommended backend approach:

- Add a dedicated create serializer, for example `DealCreateSerializer`, and keep the existing `DealSerializer` for read/update.
- Accept flexible input fields:
  - `sponsor`: UUID string or object.
  - `broker`: UUID string, object, `null`, or omitted.
  - `properties`: optional array of UUID strings and/or objects.
  - `property_ids`: continue supporting this for backward compatibility.
- Let `properties` be optional so a sparse sourced deal can be created before collateral details are complete.
- If properties are provided, create `DealProperty` rows and mark the first as primary.
- If a new property matches an existing normalized address, return a clear duplicate response or optionally attach the existing property when the client explicitly opts in.
- Wrap the whole create operation in `transaction.atomic()`.
- Continue setting `assigned_analyst` server-side from `request.user`.
- Continue preventing relationship changes through the normal update endpoint until there is a deliberate reassignment workflow.

Validation policy:

- Existing IDs must point to records the user can access.
- New sponsor should require only the minimum fields needed to create a useful relationship: entity name, entity type, primary contact name, and primary contact email. Phone and relationship rating can remain optional/defaulted.
- New broker can be optional and should require company name plus email if supplied. Contact name and phone can remain optional.
- New property should support partial intake. At minimum, require enough to dedupe if the user is creating a real property record: address, city, state, ZIP, and property type. For an even sparser first-look deal, put early address text in `Deal.details` and add the property later.
- Sensitive identifiers must remain blocked from `details`; keep using first-class encrypted fields.

Frontend implication:

- The existing create payload is close to the target contract.
- The create form currently requires at least one property. If sparse first-look deals are desired, relax the form so property rows are optional and add a "property details pending" path.
- Use the existing `/api/properties/deduplicate/` endpoint before creating a new property, or let the backend return the duplicate and show the existing-property attachment option.

First implementation slice:

1. Add backend tests for creating:
   - deal only with existing sponsor and no properties;
   - deal with new sponsor and no broker;
   - deal with new sponsor, new broker, and new property;
   - deal with mixed existing and new properties;
   - duplicate property detection;
   - transaction rollback if one nested create fails.
2. Add `DealCreateSerializer` and route `DealViewSet.get_serializer_class()` to use it only for `create`.
3. Adjust the frontend create schema to allow zero properties when the user chooses a sparse first-look deal.
4. Keep Demo and Live payloads identical.

Implementation notes:

- Added a create-only backend serializer that accepts existing IDs or nested objects for sponsor, broker, and properties.
- Made deal sponsor optional so a true sparse first-look deal can be created.
- Kept nested writes atomic so failed property linking rolls back the deal and any newly created sponsor, broker, or property.
- Relaxed normal update validation only enough to fill an empty sponsor, broker, or fund later; replacing an existing relationship still requires a deliberate future workflow.
- Updated the React create form and mock API to support no sponsor and no properties at first intake.
- Preserved the current existing-ID authorization behavior for this slice. Access-scoped existing sponsor/broker/property selection should be handled as a separate hardening pass.
- Updated Demo-mode mocks to match Live-mode sparse create, unknown related-ID failures, and fill-later sponsor/broker/fund behavior.
- Converted nested new-property duplicate-key races into validation errors instead of unhandled server errors.
- Updated the edit page so sparse deals can save normal term changes without forcing a property attachment, while still blocking accidental removal of the last property from an existing collateral list.
- Locked the edit-page fund selector once a fund is assigned so the UI matches the server's immutable-relationship guard.
- Tightened Demo-mode mocks to reject duplicate properties, incomplete nested sponsor/broker/property records, invalid `property_ids`, and mixed `properties` plus `property_ids` payloads.

## Research Notes For Item 4: Lightweight Notes / Activity

### What already exists

The groundwork is largely in place, which makes this a small, well-scoped slice:

- `ActivityActionType.NOTE_ADDED` is already defined (`api/models/choices.py:112`) but nothing writes it yet.
- `ActivityLog` (`api/models/activity.py`) is the immutable audit trail: append-only, UUID PK, `deal` FK, `performed_by`, `metadata` JSON (GIN-indexed), and a subject-model/subject-id filter convention on `metadata` (`api/viewsets.py:601`). Entries are written by small service helpers (`_write_status_log`, `_log_document_upload`), never edited or deleted.
- The activity feed is **staff-only**: `ActivityLogViewSet` is `IsAdminUser` (`api/viewsets.py:589`) and the frontend only fetches it when `isStaff` (`useDealActivity(id, isStaff)`).
- `Document` is the reference pattern for a first-class per-deal record with UUID PK, `related_name='documents'`, `visibility_roles`, and creation logged to `ActivityLog`.
- Access is centralized in `_can_access_deal(user, deal)` = staff **or** the deal's `assigned_analyst` (`api/viewsets.py:660`).

### Core design decision: a first-class `DealNote`, not an `ActivityLog` row

A note could be modeled as nothing more than an `ActivityLog` entry with `action_type=note_added`. I recommend against that. The two concepts have different lifecycles and audiences:

- **`ActivityLog` is an audit record** — immutable, staff-only, system-authored, never edited or deleted. Repurposing it as user-authored content that people expect to edit, delete, and attach files to would corrupt the audit trail (you cannot let users edit audit rows) and would leak the whole staff-only feed to anyone allowed to read notes.
- **A note is user content** — authored by a person, potentially editable/deletable by its author, readable by the assigned analyst, and linkable to documents.

So the clean shape mirrors the Document pattern exactly: **`DealNote` is the first-class record; creating one writes a `NOTE_ADDED` row into `ActivityLog`.** The note is the source of truth for the text; the log entry is the immutable "this happened" fact. This is the same split the TODO line already implies ("Add deal notes/comments... Log note creation in `ActivityLog`").

### Data model

Add `api/models/note.py` with a `DealNote`:

- `id` UUID PK.
- `deal` FK → `Deal`, `on_delete=CASCADE`, `related_name='notes'` (unlike Document's `PROTECT`; a note is disposable, a document is not).
- `body` TextField (required, non-empty after strip).
- `author` FK → user, `on_delete=SET_NULL`, `null=True` (match the ActivityLog/Document convention of surviving user deletion).
- `visibility_roles` JSONField default `['internal']` — reuse the Document visibility vocabulary (`ALLOWED_DOCUMENT_VISIBILITY_ROLES = {'internal', 'investor', 'borrower', 'counsel'}`, validated by `_validate_visibility_roles`, `api/serializers.py:23`) so notes and documents share one access story and a future external-facing surface is cheap. Default keeps notes internal.
- `attachments` M2M → `Document` through an explicit table, **constrained so every attached document belongs to the same `deal`** (validate in the serializer; a note on deal A must not link a document from deal B).
- `created_at` / `updated_at` timestamps; `edited` bool or derived from `created_at != updated_at` for a light "edited" marker.
- `pinned` bool (optional, defer unless the UI wants it) — cheap to add later, YAGNI for now.

Index on `(deal, -created_at)` to match how the panel lists them.

### ActivityLog integration

Add a `record_note_added(note, request)` helper alongside `_log_document_upload`, writing:

- `action_type=NOTE_ADDED`, `deal=note.deal`, `performed_by=request.user`, `ip_address`.
- `description` a short excerpt (e.g. first ~80 chars of body).
- `metadata`: `{ 'subject_model': 'deal_note', 'subject_id': str(note.id), 'attachment_ids': [...] }` so it participates in the existing `subject_model`/`subject_id` metadata filter.

Only note **creation** is logged (matching documents, where upload is logged but edits are not). Edits/deletes of the note do not rewrite history; if edit auditing is wanted later, add `NOTE_EDITED`/`NOTE_DELETED` action types then — deferred for now.

### API surface

- New `DealNoteViewSet` (full `ModelViewSet`) routed at `deal-notes/`, plus `DealNoteSerializer` (read) and a create serializer if attachment handling gets involved.
- `permission_classes = [IsAdminUser]` (staff-only, matching `ActivityLogViewSet`). Support `?deal=<uuid>` filtering like documents and activity logs.
- `perform_create`: set `author` from `request.user` server-side, validate attachments belong to the deal, wrap the note + `ActivityLog` write in `transaction.atomic()`.
- Edit/delete policy: the note author or any staff user may edit/delete a note; editing does not touch the `ActivityLog` entry (see resolved decision 2 below).

### Frontend implications

- `DealDetailPage.tsx` already has the panel pattern (`DocumentsPanel`, `ActivityPanel`). Add a `NotesPanel` beside them, with a small compose box (textarea + optional "attach existing document" multi-select drawn from `useDealDocuments`).
- Notes are staff-only, so the `NotesPanel` is gated behind `isStaff` exactly like the `ActivityPanel` (rendered in the sidebar only when `isStaff`).
- Add `useDealNotes(dealId)` / `useCreateNote` hooks in `lib/api/deals.ts` (or a new `lib/api/notes.ts`), and a `DealNote` type in `types/deal.ts`. The `note_added` action type already exists in the frontend enum (`types/deal.ts`), so if a note also surfaces in the staff activity feed it renders with no type-map change. Follow the existing query-invalidation pattern (transition mutations already invalidate `['deal-activity', id]`).
- Keep Demo/Live parity: add note CRUD to `frontend/src/mocks/handlers.ts` so Demo mode behaves identically, following the same discipline used for the item-1 create flow. The handlers already `unshift` an activity entry on mutations and serve `activity-logs` — the note-add mock hooks in there.

### Decisions (resolved 2026-07-07)

1. **Note audience — staff/internal only.** Notes are a staff collaboration tool. They are **not** exposed to the non-staff assigned analyst. The `DealNoteViewSet` is staff-scoped (`IsAdminUser`, matching `ActivityLogViewSet`) and the frontend `NotesPanel` is gated behind `isStaff` like the activity feed. `visibility_roles` defaults to `['internal']` and is retained for forward-compatibility, but no non-internal audience exists in this slice. (This supersedes the earlier draft recommendation that notes be visible to the assigned analyst.)
2. **Edit/delete policy — author or staff may delete.** The note author or any staff user may delete a note; the immutable `NOTE_ADDED` audit row is never removed. Editing follows the same author-or-staff rule and does not rewrite the audit entry. Add `NOTE_EDITED`/`NOTE_DELETED` action types only if edit/delete auditing is later required — deferred.
3. **Attachment direction.** This slice only *links existing* documents to a note. Uploading a new document from within the note composer (upload-intent + link in one step) is a nice-to-have — deferred unless the compose UX demands it.
4. **Threading/replies.** Explicitly out of scope. Flat, per-deal, reverse-chronological notes only. "Defer full email-client behavior" per the TODO.

### First implementation slice

1. Backend tests first (mirroring item 1's discipline):
   - staff creates a note on a deal; `author` set server-side; `NOTE_ADDED` logged with correct `subject_model`/`subject_id`.
   - non-staff user (incl. the assigned analyst) is denied create/read on the notes endpoint (staff-only).
   - attaching a document from a different deal is rejected.
   - note + log write are atomic (log failure rolls back the note).
   - author or staff may delete; a non-author non-staff user cannot.
2. Add `DealNote` model + migration, register in `api/models/__init__.py`, add to admin.
3. Add serializer, `DealNoteViewSet`, router registration, and the `record_note_added` helper.
4. Add `NotesPanel` + hooks + type on the frontend, visible to the assigned analyst.
5. Add Demo-mode mock handlers for note CRUD; keep Demo and Live payloads identical.
