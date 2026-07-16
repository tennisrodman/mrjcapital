"""Transaction-safe versioned quote / term-sheet workflows."""

from decimal import Decimal, ROUND_HALF_UP
from uuid import UUID

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from api.models import (
    ActivityActionType,
    ActivityLog,
    Document,
    DocumentCategory,
    DocumentStorageStatus,
    PipelineStatus,
    Quote,
    ScreeningAssessment,
)
from api.models.deal import Deal


FEE_QUANTUM = Decimal('0.01')
HUNDRED = Decimal('100')

QUOTE_PIPELINE_STATUSES = {PipelineStatus.QUOTING, PipelineStatus.NEGOTIATING}
QUOTE_DOCUMENT_CATEGORY = DocumentCategory.LEGAL
QUOTE_DOCUMENT_SUBCATEGORIES = frozenset({'term_sheet', 'loi'})
ATTACHMENT_EDITABLE_STATUSES = {
    Quote.Status.DRAFT,
    Quote.Status.SENT,
    Quote.Status.COUNTERED,
}
SENDABLE_FROM = {Quote.Status.DRAFT}
EXECUTABLE_FROM = {Quote.Status.SENT, Quote.Status.COUNTERED}
COUNTERABLE_FROM = {Quote.Status.SENT, Quote.Status.COUNTERED}
WITHDRAWABLE_FROM = {
    Quote.Status.DRAFT,
    Quote.Status.SENT,
    Quote.Status.COUNTERED,
}
EXPIRABLE_FROM = {Quote.Status.SENT, Quote.Status.COUNTERED}
TERMINAL_STATUSES = {
    Quote.Status.EXECUTED,
    Quote.Status.EXPIRED,
    Quote.Status.WITHDRAWN,
}

PROTECTED_FIELDS = frozenset({
    'id',
    'version',
    'status',
    'is_counter',
    'created_by',
    'sent_at',
    'signed_at',
    'withdrawn_at',
    'origination_fee_amount',
    'initial_funding_amount',
    'created_at',
    'updated_at',
    'attachments',
    'deal',
})

EDITABLE_DRAFT_FIELDS = frozenset({
    'notes',
    'loan_amount',
    'rate_type',
    'interest_rate',
    'index_name',
    'spread',
    'rate_floor',
    'term_months',
    'amortization_type',
    'amortization_months',
    'origination_fee_pct',
    'exit_fee_pct',
    'extension_options',
    'prepayment_terms',
    'recourse_type',
    'recourse_carveouts',
    'interest_reserve_months',
    'interest_reserve_amount',
    'holdback_amount',
    'good_faith_deposit',
    'min_dscr',
    'max_ltv',
    'min_debt_yield',
    'equity_commitment',
    'ownership_pct',
    'preferred_return_pct',
    'equity_summary',
    'expires_at',
})

COPY_ON_COUNTER_FIELDS = frozenset({
    'notes',
    'loan_amount',
    'rate_type',
    'interest_rate',
    'index_name',
    'spread',
    'rate_floor',
    'term_months',
    'amortization_type',
    'amortization_months',
    'origination_fee_pct',
    'exit_fee_pct',
    'extension_options',
    'prepayment_terms',
    'recourse_type',
    'recourse_carveouts',
    'interest_reserve_months',
    'interest_reserve_amount',
    'holdback_amount',
    'good_faith_deposit',
    'min_dscr',
    'max_ltv',
    'min_debt_yield',
    'equity_commitment',
    'ownership_pct',
    'preferred_return_pct',
    'equity_summary',
})


def get_current_quote(deal):
    return Quote.objects.filter(deal=deal).order_by('-version').first()


def quote_missing_send_fields(quote):
    """Return fields that make a debt quote nonsensical or unusable to send."""
    return list(quote_send_errors(quote))


def quote_send_errors(quote):
    required = ('loan_amount', 'rate_type', 'term_months', 'amortization_type', 'recourse_type', 'expires_at')
    errors = {
        field: 'Required before a quote can be sent.'
        for field in required
        if getattr(quote, field, None) in (None, '')
    }
    if quote.loan_amount not in (None, '') and quote.loan_amount <= 0:
        errors['loan_amount'] = 'Loan amount must be greater than zero before a quote can be sent.'
    if quote.rate_type == Quote.RateType.FIXED and quote.interest_rate in (None, ''):
        errors['interest_rate'] = 'Required before a quote can be sent.'
    if quote.rate_type in {Quote.RateType.FLOATING, Quote.RateType.HYBRID}:
        if not quote.index_name.strip():
            errors['index_name'] = 'Required before a quote can be sent.'
        if quote.spread in (None, ''):
            errors['spread'] = 'Required before a quote can be sent.'
    if (
        quote.amortization_type in {
            Quote.AmortizationType.PARTIAL_AMORT,
            Quote.AmortizationType.FULL_AMORT,
        }
        and quote.amortization_months in (None, '')
    ):
        errors['amortization_months'] = 'Required for an amortizing quote.'
    return errors


def quote_is_send_ready(quote):
    return not quote_missing_send_fields(quote)


def apply_calculated_quote_fields(quote):
    loan_amount = _decimal_or_none(quote.loan_amount)
    fee_pct = _decimal_or_none(quote.origination_fee_pct)
    holdback = _decimal_or_none(quote.holdback_amount)

    if loan_amount is not None and holdback is not None and holdback > loan_amount:
        raise ValidationError({
            'holdback_amount': 'Holdback cannot exceed the loan amount.',
        })

    if loan_amount is not None and fee_pct is not None:
        quote.origination_fee_amount = (loan_amount * fee_pct / HUNDRED).quantize(
            FEE_QUANTUM,
            rounding=ROUND_HALF_UP,
        )
    else:
        quote.origination_fee_amount = None

    if loan_amount is not None and holdback is not None:
        quote.initial_funding_amount = (loan_amount - holdback).quantize(
            FEE_QUANTUM,
            rounding=ROUND_HALF_UP,
        )
    else:
        quote.initial_funding_amount = None
    return quote


def quote_execution_evidence_queryset(quote):
    return quote.attachments.filter(
        storage_status=DocumentStorageStatus.READY,
        category=QUOTE_DOCUMENT_CATEGORY,
        subcategory__in=QUOTE_DOCUMENT_SUBCATEGORIES,
    )


def quote_has_execution_evidence(quote) -> bool:
    return quote_execution_evidence_queryset(quote).exists()


def document_is_executed_quote_evidence(document) -> bool:
    """True when a document is attached to an executed quote (immutable evidence)."""
    from api.services.documents import document_is_executed_quote_evidence as policy_check

    return policy_check(document)


def _authenticated_actor(user):
    if user is not None and getattr(user, 'is_authenticated', False):
        return user
    return None


def _log_quote(deal, action_type, performed_by, *, description, metadata=None, old_value='', new_value=''):
    ActivityLog.objects.create(
        deal=deal,
        action_type=action_type,
        performed_by=_authenticated_actor(performed_by),
        description=description,
        old_value=old_value,
        new_value=new_value,
        metadata=metadata or {},
    )


def _require_quote_pipeline(deal):
    if deal.pipeline_status not in QUOTE_PIPELINE_STATUSES:
        raise ValidationError({
            'deal': 'Quote actions are only allowed while the deal is in quoting or negotiating.',
        })


def _lock_deal_for_quote(deal_id) -> Deal:
    deal = Deal.objects.select_for_update().get(pk=deal_id)
    _require_quote_pipeline(deal)
    return deal


def create_next_quote(
    *,
    deal,
    created_by=None,
    seed_from_screening=True,
    is_counter=False,
    **fields,
):
    _reject_unknown_create_fields(fields)
    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(deal.pk)
        current = get_current_quote(locked_deal)
        if current and current.status == Quote.Status.DRAFT:
            raise ValidationError({
                'status': 'Update, send, or withdraw the current draft before starting a new version.',
            })
        if current and current.status not in TERMINAL_STATUSES and not is_counter:
            raise ValidationError({
                'status': 'Use counter to revise an active quote, or wait until the current version is terminal.',
            })

        next_version = (current.version if current else 0) + 1
        quote = Quote(
            deal=locked_deal,
            version=next_version,
            status=Quote.Status.DRAFT,
            is_counter=is_counter,
            created_by=created_by if getattr(created_by, 'is_authenticated', False) else None,
            **fields,
        )
        if seed_from_screening and not fields:
            _seed_from_screening(quote, locked_deal)
        apply_calculated_quote_fields(quote)
        quote.full_clean()
        quote.save()
        _log_quote(
            locked_deal,
            ActivityActionType.QUOTE_COUNTERED if is_counter else ActivityActionType.QUOTE_CREATED,
            created_by,
            description=(
                f'Quote v{quote.version} countered'
                if is_counter
                else f'Quote v{quote.version} created'
            ),
            metadata={
                'quote_id': str(quote.pk),
                'version': quote.version,
                'is_counter': is_counter,
            },
            new_value=quote.status,
        )
        return quote


def update_draft_quote(quote, *, performed_by=None, **fields):
    unknown = sorted(set(fields) - EDITABLE_DRAFT_FIELDS)
    if unknown:
        raise ValidationError({
            field_name: 'This field cannot be updated on a quote draft.'
            for field_name in unknown
        })
    if 'deal' in fields:
        raise ValidationError({'deal': 'A quote cannot be moved to another deal.'})

    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(quote.deal_id)
        locked = Quote.objects.select_for_update().get(pk=quote.pk)
        _require_current_draft(locked)
        changed = sorted(fields.keys())
        for field_name, value in fields.items():
            setattr(locked, field_name, value)
        apply_calculated_quote_fields(locked)
        locked.full_clean()
        locked.save(update_fields=[
            *fields.keys(),
            'origination_fee_amount',
            'initial_funding_amount',
            'updated_at',
        ])
        if changed:
            _log_quote(
                locked_deal,
                ActivityActionType.QUOTE_UPDATED,
                performed_by,
                description=f'Quote v{locked.version} draft updated',
                metadata={
                    'quote_id': str(locked.pk),
                    'version': locked.version,
                    'fields': changed,
                },
            )
        return locked


def send_quote(quote, *, expires_at=None, performed_by=None):
    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(quote.deal_id)
        locked = Quote.objects.select_for_update().get(pk=quote.pk)
        _require_current(locked)
        if locked.status not in SENDABLE_FROM:
            raise ValidationError({'status': 'Only draft quotes can be sent.'})
        if expires_at is not None:
            locked.expires_at = expires_at
        send_errors = quote_send_errors(locked)
        if send_errors:
            raise ValidationError(send_errors)
        if locked.expires_at <= timezone.now():
            raise ValidationError({'expires_at': 'Expiration must be in the future.'})
        old_status = locked.status
        locked.sent_at = timezone.now()
        locked.status = Quote.Status.COUNTERED if locked.is_counter else Quote.Status.SENT
        locked.full_clean()
        locked.save(update_fields=['status', 'sent_at', 'expires_at', 'updated_at'])
        _log_quote(
            locked_deal,
            ActivityActionType.QUOTE_SENT,
            performed_by,
            description=f'Quote v{locked.version} sent',
            metadata={'quote_id': str(locked.pk), 'version': locked.version},
            old_value=old_status,
            new_value=locked.status,
        )
        return locked


def counter_quote(*, quote, created_by=None):
    with transaction.atomic():
        locked = Quote.objects.select_for_update().select_related('deal').get(pk=quote.pk)
        _lock_deal_for_quote(locked.deal_id)
        _require_current(locked)
        if locked.status not in COUNTERABLE_FROM:
            raise ValidationError({
                'status': 'Only the current sent or countered quote can be countered.',
            })
        copied = {
            field_name: getattr(locked, field_name)
            for field_name in COPY_ON_COUNTER_FIELDS
        }
        return create_next_quote(
            deal=locked.deal,
            created_by=created_by,
            seed_from_screening=False,
            is_counter=True,
            **copied,
        )


def execute_quote(quote, *, signed_at=None, performed_by=None):
    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(quote.deal_id)
        locked = (
            Quote.objects.select_for_update()
            .prefetch_related('attachments')
            .get(pk=quote.pk)
        )
        _require_current(locked)
        if locked.status not in EXECUTABLE_FROM:
            raise ValidationError({
                'status': 'Only the current sent or countered quote can be executed.',
            })
        ready = list(quote_execution_evidence_queryset(locked))
        if not ready:
            raise ValidationError({
                'attachments': (
                    'Attach at least one ready legal term sheet or LOI document '
                    'before executing.'
                ),
            })
        # Lock execution artifacts so later deletes cannot erase Signed evidence.
        Document.objects.filter(pk__in=[doc.pk for doc in ready]).update(is_executed=True)
        old_status = locked.status
        locked.signed_at = signed_at or timezone.now()
        locked.status = Quote.Status.EXECUTED
        locked.full_clean()
        locked.save(update_fields=['status', 'signed_at', 'updated_at'])
        _log_quote(
            locked_deal,
            ActivityActionType.QUOTE_EXECUTED,
            performed_by,
            description=f'Quote v{locked.version} executed',
            metadata={
                'quote_id': str(locked.pk),
                'version': locked.version,
                'attachment_ids': [str(doc.pk) for doc in ready],
            },
            old_value=old_status,
            new_value=locked.status,
        )
        return locked


def withdraw_quote(quote, *, performed_by=None):
    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(quote.deal_id)
        locked = Quote.objects.select_for_update().get(pk=quote.pk)
        _require_current(locked)
        if locked.status not in WITHDRAWABLE_FROM:
            raise ValidationError({'status': 'This quote cannot be withdrawn.'})
        old_status = locked.status
        locked.withdrawn_at = timezone.now()
        locked.status = Quote.Status.WITHDRAWN
        locked.full_clean()
        locked.save(update_fields=['status', 'withdrawn_at', 'updated_at'])
        _log_quote(
            locked_deal,
            ActivityActionType.QUOTE_WITHDRAWN,
            performed_by,
            description=f'Quote v{locked.version} withdrawn',
            metadata={'quote_id': str(locked.pk), 'version': locked.version},
            old_value=old_status,
            new_value=locked.status,
        )
        return locked


def expire_quote(quote, *, performed_by=None):
    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(quote.deal_id)
        locked = Quote.objects.select_for_update().get(pk=quote.pk)
        _require_current(locked)
        if locked.status not in EXPIRABLE_FROM:
            raise ValidationError({'status': 'Only sent or countered quotes can be expired.'})
        old_status = locked.status
        locked.status = Quote.Status.EXPIRED
        locked.full_clean()
        locked.save(update_fields=['status', 'updated_at'])
        _log_quote(
            locked_deal,
            ActivityActionType.QUOTE_EXPIRED,
            performed_by,
            description=f'Quote v{locked.version} expired',
            metadata={'quote_id': str(locked.pk), 'version': locked.version},
            old_value=old_status,
            new_value=locked.status,
        )
        return locked


def set_quote_attachments(quote, document_ids, *, user=None):
    normalized_ids = _normalize_document_ids(document_ids)
    with transaction.atomic():
        locked_deal = _lock_deal_for_quote(quote.deal_id)
        locked = Quote.objects.select_for_update().prefetch_related('attachments').get(pk=quote.pk)
        _require_current(locked)
        if locked.status not in ATTACHMENT_EDITABLE_STATUSES:
            raise ValidationError({
                'status': 'Attachments can only be changed on draft, sent, or countered quotes.',
            })
        existing = list(locked.attachments.all())
        before_ids = {str(doc.pk) for doc in existing}
        actor = user
        documents = list(
            Document.objects.filter(
                pk__in=normalized_ids,
                deal_id=locked.deal_id,
                storage_status=DocumentStorageStatus.READY,
            )
        )
        if actor is not None and not (getattr(actor, 'is_staff', False) or getattr(actor, 'is_superuser', False)):
            documents = [
                document
                for document in documents
                if 'internal' in (document.visibility_roles or [])
            ]
        found_ids = {document.pk for document in documents}
        missing = [str(document_id) for document_id in normalized_ids if document_id not in found_ids]
        if missing:
            raise ValidationError({
                'document_ids': 'One or more documents are missing or not on this deal.',
            })
        for document in documents:
            if document.category != QUOTE_DOCUMENT_CATEGORY:
                raise ValidationError({
                    'document_ids': 'Quote attachments must use the legal document category.',
                })
            if document.subcategory not in QUOTE_DOCUMENT_SUBCATEGORIES:
                raise ValidationError({
                    'document_ids': 'Quote attachments must use subcategory term_sheet or loi.',
                })
        invisible = []
        if actor is not None and not (getattr(actor, 'is_staff', False) or getattr(actor, 'is_superuser', False)):
            invisible = [
                document
                for document in existing
                if 'internal' not in (document.visibility_roles or [])
            ]
        final_docs = {document.pk: document for document in documents}
        for document in invisible:
            final_docs[document.pk] = document
        locked.attachments.set(list(final_docs.values()))
        after_ids = {str(doc_id) for doc_id in final_docs}
        _log_quote(
            locked_deal,
            ActivityActionType.QUOTE_ATTACHMENTS_UPDATED,
            actor,
            description=f'Quote v{locked.version} attachments updated',
            metadata={
                'quote_id': str(locked.pk),
                'version': locked.version,
                'attached_document_ids': sorted(after_ids - before_ids),
                'detached_document_ids': sorted(before_ids - after_ids),
            },
        )
        return locked


def _seed_from_screening(quote, deal):
    assessment = (
        ScreeningAssessment.objects.filter(
            deal=deal,
            status=ScreeningAssessment.Status.FINALIZED,
            decision=ScreeningAssessment.Decision.ADVANCE,
        )
        .order_by('-version')
        .first()
    )
    if assessment is None:
        return
    if assessment.loan_amount is not None:
        quote.loan_amount = assessment.loan_amount
    if assessment.proposed_rate is not None:
        quote.interest_rate = assessment.proposed_rate
    if assessment.proposed_term_months is not None:
        quote.term_months = assessment.proposed_term_months


def _require_current(quote):
    if Quote.objects.filter(deal_id=quote.deal_id, version__gt=quote.version).exists():
        raise ValidationError({'status': 'Only the current quote version can be used.'})


def _require_current_draft(quote):
    if quote.status != Quote.Status.DRAFT:
        raise ValidationError({'status': 'Only draft quotes can be changed.'})
    _require_current(quote)


def _reject_unknown_create_fields(fields):
    protected = sorted(set(fields) & PROTECTED_FIELDS)
    if protected:
        raise ValidationError({
            field_name: 'This field is managed by the quote workflow.'
            for field_name in protected
        })
    allowed = EDITABLE_DRAFT_FIELDS | COPY_ON_COUNTER_FIELDS
    unknown = sorted(set(fields) - allowed)
    if unknown:
        raise ValidationError({
            field_name: 'Unsupported quote field.'
            for field_name in unknown
        })


def _normalize_document_ids(document_ids):
    if not isinstance(document_ids, (list, tuple)):
        raise ValidationError({'document_ids': 'Expected a list of document ids.'})
    normalized = []
    for value in document_ids:
        try:
            normalized.append(UUID(str(value)))
        except (TypeError, ValueError) as exc:
            raise ValidationError({'document_ids': 'Invalid document id.'}) from exc
    return normalized


def _decimal_or_none(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))
