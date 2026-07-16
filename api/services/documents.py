"""Document policies and audit events shared by API and background workflows."""

from api.models import ActivityActionType, Quote
from api.policies import is_staff_user
from api.services.audit import create_activity_log


CLOSING_LINKED_DELETE_REASON = (
    'Document is linked to a closing checklist item and cannot be deleted.'
)
EXECUTED_QUOTE_DELETE_REASON = (
    'Document is attached to an executed quote and cannot be deleted.'
)
EXECUTED_DOCUMENT_DELETE_REASON = 'Only staff may delete executed documents.'
EXECUTED_METADATA_EDIT_REASON = 'Executed document metadata cannot be changed.'

LOCKED_METADATA_FIELDS = frozenset({'subcategory', 'expiry_date', 'notes', 'details'})


def _document_activity_metadata(document) -> dict[str, object]:
    return {
        'document_id': str(document.pk),
        'category': document.category,
        'version': document.version,
        'file_size_bytes': document.file_size_bytes,
        'storage_key': document.file_url,
    }


def log_document_upload_started(document, *, performed_by=None, ip_address=None):
    """Record creation of a pending upload before any blob transfer occurs."""
    return create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD_STARTED,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Document upload started: {document.document_name} v{document.version}',
        metadata=_document_activity_metadata(document),
    )


def log_document_upload_completed(document, *, performed_by=None, ip_address=None):
    """Record the point at which a verified upload becomes visible and usable."""
    return create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Document uploaded: {document.document_name} v{document.version}',
        metadata=_document_activity_metadata(document),
    )


def log_document_upload_abandoned(document):
    """Record system cleanup of an upload that never reached completion."""
    metadata = _document_activity_metadata(document)
    metadata['uploaded_by_id'] = document.uploaded_by_id
    return create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD_ABANDONED,
        description=f'Pending document upload expired: {document.document_name} v{document.version}',
        reason='Upload did not complete before the pending-upload retention deadline.',
        metadata=metadata,
    )


def _prefetched_related(document, relation_name):
    cache = getattr(document, '_prefetched_objects_cache', {})
    return cache.get(relation_name)


def document_is_closing_linked(document) -> bool:
    """Return whether closing evidence protects this document from deletion."""
    dd_items = _prefetched_related(document, 'dd_checklist_items')
    cp_items = _prefetched_related(document, 'condition_precedents')
    return (
        bool(dd_items) if dd_items is not None else document.dd_checklist_items.exists()
    ) or (
        bool(cp_items) if cp_items is not None else document.condition_precedents.exists()
    )


def document_is_executed_quote_evidence(document) -> bool:
    """Return whether an executed quote protects this document as evidence."""
    quotes = _prefetched_related(document, 'quotes')
    if quotes is not None:
        return any(quote.status == Quote.Status.EXECUTED for quote in quotes)
    return document.quotes.filter(status=Quote.Status.EXECUTED).exists()


def document_action_capabilities(document, user) -> dict[str, object]:
    """Describe actions a caller can take and the reason for every blocked action."""
    closing_linked = document_is_closing_linked(document)
    executed_quote_evidence = document_is_executed_quote_evidence(document)
    metadata_locked = bool(document.is_executed or executed_quote_evidence)

    delete_reason = ''
    if closing_linked:
        delete_reason = CLOSING_LINKED_DELETE_REASON
    elif executed_quote_evidence:
        delete_reason = EXECUTED_QUOTE_DELETE_REASON
    elif document.is_executed and not is_staff_user(user):
        delete_reason = EXECUTED_DOCUMENT_DELETE_REASON

    return {
        'can_edit': not metadata_locked,
        'edit_block_reason': EXECUTED_METADATA_EDIT_REASON if metadata_locked else '',
        'can_delete': not delete_reason,
        'delete_block_reason': delete_reason,
    }


def locked_metadata_errors(document, attrs) -> dict[str, str]:
    """Return field errors for attempted changes to immutable execution evidence."""
    if not (document.is_executed or document_is_executed_quote_evidence(document)):
        return {}
    return {
        field_name: EXECUTED_METADATA_EDIT_REASON
        for field_name in LOCKED_METADATA_FIELDS
        if field_name in attrs and attrs[field_name] != getattr(document, field_name)
    }
