"""Closing package, checklist generation, DD/CP mutations, and audit."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max, Prefetch
from django.db.models.query import QuerySet
from django.utils import timezone

from api.models import (
    ActivityActionType,
    ClosingChecklistGeneration,
    ClosingPackage,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplate,
    DDTemplateItem,
    Document,
    DocumentStorageStatus,
    ORDINARY_REGENERATION_REASON,
    PipelineStatus,
)
from api.models.deal import Deal
from api.policies import is_staff_user as _is_staff_user
from api.services.audit import create_activity_log


User = get_user_model()

CLOSING_PACKAGE_EDITABLE_FIELDS = (
    'target_close_date',
    'actual_close_date',
    'funds_wired_date',
    'funds_wired_amount',
    'closing_attorney',
    'title_company',
    'purchase_price',
    'appraised_value',
    'final_loan_amount',
    'closing_costs',
    'sources_and_uses_notes',
    'notes',
)


def _lock_deal_for_closing(deal_id) -> Deal:
    deal = Deal.objects.select_for_update().filter(pk=deal_id).first()
    if not deal:
        raise ValidationError({'deal': 'Deal not found.'})
    if deal.pipeline_status != PipelineStatus.CLOSING:
        raise ValidationError({'deal': 'Closing checklist mutations require the deal to be in Closing.'})
    return deal


def _authorized_owner_ids(deal):
    ids = set()
    if deal.assigned_analyst_id:
        ids.add(deal.assigned_analyst_id)
    ids.update(
        User.objects.filter(is_active=True).filter(is_staff=True).values_list('id', flat=True)
    )
    ids.update(
        User.objects.filter(is_active=True).filter(is_superuser=True).values_list('id', flat=True)
    )
    return ids


def _validate_owner(deal, owner):
    if owner is None:
        return None
    if owner.id not in _authorized_owner_ids(deal):
        raise ValidationError({'owner': 'Selected owner is not available for this deal.'})
    if not owner.is_active:
        raise ValidationError({'owner': 'Selected owner is not available for this deal.'})
    return owner


def closing_assignees(deal):
    ids = _authorized_owner_ids(deal)
    return list(User.objects.filter(id__in=ids, is_active=True).order_by('username'))


def _closing_event_description(action_type, metadata):
    metadata = metadata or {}
    event = metadata.get('event', '')
    if event == 'created':
        return 'Closing package created'
    if event == 'updated':
        fields = ', '.join(str(field).replace('_', ' ') for field in metadata.get('fields', []))
        return f'Closing package updated{f": {fields}" if fields else ""}'
    if action_type == ActivityActionType.CLOSING_GENERATED:
        version = metadata.get('version')
        return f'Closing checklist v{version} generated' if version else 'Closing checklist generated'
    if action_type in {
        ActivityActionType.CLOSING_REGENERATED,
        ActivityActionType.CLOSING_SUPERSEDED,
    }:
        verb = 'superseded' if action_type == ActivityActionType.CLOSING_SUPERSEDED else 'regenerated'
        return (
            f'Closing checklist v{metadata.get("from_version")} {verb} '
            f'by v{metadata.get("to_version")}'
        )

    item_labels = {
        'dd_created': 'Due diligence item added',
        'cp_created': 'Condition precedent added',
        'dd_updated': 'Due diligence item updated',
        'cp_updated': 'Condition precedent updated',
        'dd_deleted': 'Due diligence item deleted',
        'cp_deleted': 'Condition precedent deleted',
    }
    if event in item_labels:
        detail = metadata.get('title') or metadata.get('status')
        return f'{item_labels[event]}{f": {detail}" if detail else ""}'

    if event in {'dd_documents_set', 'cp_documents_set'}:
        subject = 'due diligence item' if event.startswith('dd_') else 'condition precedent'
        attached = len(metadata.get('attached_document_ids', []))
        detached = len(metadata.get('detached_document_ids', []))
        if attached and detached:
            return f'Closing documents updated for {subject}: {attached} linked, {detached} detached'
        if attached:
            return f'{attached} closing document{"s" if attached != 1 else ""} linked to {subject}'
        return f'{detached} closing document{"s" if detached != 1 else ""} detached from {subject}'

    try:
        return ActivityActionType(action_type).label
    except ValueError:
        return str(action_type).replace('_', ' ').capitalize()


def _log(deal, action_type, performed_by, *, metadata=None, old_value='', new_value=''):
    create_activity_log(
        deal=deal,
        action_type=action_type,
        performed_by=performed_by,
        description=_closing_event_description(action_type, metadata),
        old_value=old_value or '',
        new_value=new_value or '',
        metadata=metadata or {},
    )


def _due_date_from_offset(target_close_date, offset_days):
    if target_close_date is None or offset_days is None:
        return None
    return target_close_date - timedelta(days=offset_days)


def _current_generation(package):
    return (
        ClosingChecklistGeneration.objects
        .select_for_update()
        .filter(package=package, is_current=True)
        .first()
    )


def _generation_blocks_ordinary_regen(generation) -> bool:
    if generation is None:
        return False
    dd_items = list(generation.dd_items.prefetch_related('documents').all())
    cp_items = list(generation.conditions_precedent.prefetch_related('documents').all())
    if not dd_items and not cp_items:
        return False
    for item in dd_items:
        if item.status == DDChecklistItem.Status.IN_PROGRESS:
            return True
        if item.status in DDChecklistItem.TERMINAL_STATUSES:
            return True
        if item.documents.exists():
            return True
    for item in cp_items:
        if item.status in ConditionPrecedent.TERMINAL_STATUSES:
            return True
        if item.documents.exists():
            return True
    for item in dd_items:
        if item.status != DDChecklistItem.Status.PENDING:
            return True
    for item in cp_items:
        if item.status != ConditionPrecedent.Status.OPEN:
            return True
    return False


def upsert_closing_package(deal, *, performed_by=None, fields_present=None, **kwargs):
    """Create or partially update a closing package.

    ``fields_present`` is the set of field names explicitly supplied by the
    caller (so omitted fields stay untouched; explicit None clears nullables).
    """
    fields_present = set(fields_present or [])
    with transaction.atomic():
        locked = _lock_deal_for_closing(deal.pk)
        package = ClosingPackage.objects.select_for_update().filter(deal=locked).first()
        created = False
        if package is None:
            package = ClosingPackage(deal=locked)
            created = True
            for field_name in CLOSING_PACKAGE_EDITABLE_FIELDS:
                if field_name in fields_present:
                    value = kwargs.get(field_name)
                    setattr(package, field_name, value if value is not None or field_name not in {'notes', 'sources_and_uses_notes', 'closing_attorney', 'title_company'} else '')
            package.full_clean()
            package.save()
            _log(
                locked,
                ActivityActionType.CLOSING_PACKAGE_UPDATED,
                performed_by,
                metadata={'event': 'created', 'package_id': str(package.pk)},
            )
            return package, created

        old_values = {
            field_name: getattr(package, field_name)
            for field_name in CLOSING_PACKAGE_EDITABLE_FIELDS
            if field_name in fields_present
        }
        changed = False
        for field_name in CLOSING_PACKAGE_EDITABLE_FIELDS:
            if field_name not in fields_present:
                continue
            value = kwargs.get(field_name)
            if field_name in {'notes', 'sources_and_uses_notes', 'closing_attorney', 'title_company'}:
                value = value or ''
            if getattr(package, field_name) != value:
                setattr(package, field_name, value)
                changed = True
        if changed:
            package.full_clean()
            package.save()
            _log(
                locked,
                ActivityActionType.CLOSING_PACKAGE_UPDATED,
                performed_by,
                old_value=str(old_values),
                new_value=str({field: getattr(package, field) for field in old_values}),
                metadata={'event': 'updated', 'package_id': str(package.pk), 'fields': sorted(old_values)},
            )
        return package, created


def generate_closing_checklist(
    deal,
    template,
    *,
    performed_by=None,
    force=False,
    force_reason='',
    initial_target_close_date=None,
):
    with transaction.atomic():
        locked = _lock_deal_for_closing(deal.pk)
        if not isinstance(template, DDTemplate):
            template = DDTemplate.objects.filter(pk=template, is_active=True).first()
        if not template or not template.is_active:
            raise ValidationError({'template': 'Selected template is not available.'})

        package = ClosingPackage.objects.select_for_update().filter(deal=locked).first()
        created_package = False
        if package is None:
            package = ClosingPackage.objects.create(
                deal=locked,
                target_close_date=initial_target_close_date,
            )
            created_package = True
            _log(
                locked,
                ActivityActionType.CLOSING_PACKAGE_UPDATED,
                performed_by,
                metadata={'event': 'created', 'package_id': str(package.pk)},
            )

        current = _current_generation(package)
        if current is not None:
            blocked = _generation_blocks_ordinary_regen(current)
            if blocked and not force:
                raise ValidationError({
                    'template': (
                        'Current checklist cannot be regenerated. '
                        'Staff may force supersede with a reason.'
                    ),
                })
            if force:
                if not _is_staff_user(performed_by):
                    raise ValidationError({'force': 'Only staff may force supersede a checklist.'})
                if not (force_reason or '').strip():
                    raise ValidationError({'force_reason': 'A reason is required to force supersede.'})

            now = timezone.now()
            if force:
                reason = force_reason.strip()
                action = ActivityActionType.CLOSING_SUPERSEDED
            else:
                reason = ORDINARY_REGENERATION_REASON
                action = ActivityActionType.CLOSING_REGENERATED
            current.is_current = False
            current.superseded_at = now
            current.superseded_by = performed_by if performed_by and getattr(performed_by, 'pk', None) else None
            current.supersede_reason = reason
            current.save(update_fields=[
                'is_current', 'superseded_at', 'superseded_by', 'supersede_reason',
            ])
            next_version = current.version + 1
            _log(
                locked,
                action,
                performed_by,
                metadata={
                    'package_id': str(package.pk),
                    'from_version': current.version,
                    'to_version': next_version,
                    'force': bool(force),
                    'reason': reason,
                },
            )
        else:
            next_version = 1
            action = ActivityActionType.CLOSING_GENERATED

        generation = ClosingChecklistGeneration.objects.create(
            package=package,
            version=next_version,
            template=template,
            template_key=template.key,
            template_name=template.name,
            is_current=True,
            generated_at=timezone.now(),
            generated_by=performed_by if performed_by and getattr(performed_by, 'pk', None) else None,
            supersede_reason='',
        )
        _copy_template_items(generation, template, package.target_close_date)
        if next_version == 1:
            _log(
                locked,
                ActivityActionType.CLOSING_GENERATED,
                performed_by,
                metadata={
                    'package_id': str(package.pk),
                    'generation_id': str(generation.pk),
                    'version': generation.version,
                    'template_key': template.key,
                    'created_package': created_package,
                },
            )
        return generation


def _copy_template_items(generation, template, target_close_date):
    items = list(template.items.order_by('kind', 'sort_order'))
    dd_rows = []
    cp_rows = []
    for item in items:
        due = _due_date_from_offset(target_close_date, item.default_days_before_target_close)
        if item.kind == DDTemplateItem.Kind.DD:
            dd_rows.append(DDChecklistItem(
                generation=generation,
                source_template_item=item,
                sort_order=item.sort_order,
                title=item.title,
                description=item.description,
                status=DDChecklistItem.Status.PENDING,
                due_date=due,
            ))
        else:
            cp_rows.append(ConditionPrecedent(
                generation=generation,
                source_template_item=item,
                sort_order=item.sort_order,
                title=item.title,
                description=item.description,
                status=ConditionPrecedent.Status.OPEN,
                due_date=due,
            ))
    if dd_rows:
        DDChecklistItem.objects.bulk_create(dd_rows)
    if cp_rows:
        ConditionPrecedent.objects.bulk_create(cp_rows)


def _require_current_item(item):
    generation = item.generation
    if not generation.is_current:
        raise ValidationError({'generation': 'Prior checklist generations are immutable.'})
    return generation


def create_dd_item(deal, *, title, description='', owner=None, due_date=None, performed_by=None):
    with transaction.atomic():
        locked = _lock_deal_for_closing(deal.pk)
        package = ClosingPackage.objects.select_for_update().filter(deal=locked).first()
        if not package:
            raise ValidationError({'package': 'Create a closing package and generate a checklist first.'})
        generation = _current_generation(package)
        if not generation:
            raise ValidationError({'generation': 'Generate a checklist before adding items.'})
        owner = _validate_owner(locked, owner)
        cleaned_title = (title or '').strip()
        if not cleaned_title:
            raise ValidationError({'title': 'Title is required.'})
        next_sort = (
            generation.dd_items.aggregate(m=Max('sort_order'))['m'] or 0
        ) + 1
        item = DDChecklistItem.objects.create(
            generation=generation,
            source_template_item=None,
            sort_order=next_sort,
            title=cleaned_title,
            description=description or '',
            status=DDChecklistItem.Status.PENDING,
            owner=owner,
            due_date=due_date,
            created_by=performed_by if performed_by and getattr(performed_by, 'pk', None) else None,
        )
        _log(
            locked,
            ActivityActionType.CLOSING_ITEM_UPDATED,
            performed_by,
            metadata={'event': 'dd_created', 'item_id': str(item.pk), 'title': item.title},
        )
        return item


def create_cp_item(deal, *, title, description='', owner=None, due_date=None, performed_by=None):
    with transaction.atomic():
        locked = _lock_deal_for_closing(deal.pk)
        package = ClosingPackage.objects.select_for_update().filter(deal=locked).first()
        if not package:
            raise ValidationError({'package': 'Create a closing package and generate a checklist first.'})
        generation = _current_generation(package)
        if not generation:
            raise ValidationError({'generation': 'Generate a checklist before adding items.'})
        owner = _validate_owner(locked, owner)
        cleaned_title = (title or '').strip()
        if not cleaned_title:
            raise ValidationError({'title': 'Title is required.'})
        next_sort = (
            generation.conditions_precedent.aggregate(m=Max('sort_order'))['m'] or 0
        ) + 1
        item = ConditionPrecedent.objects.create(
            generation=generation,
            source_template_item=None,
            sort_order=next_sort,
            title=cleaned_title,
            description=description or '',
            status=ConditionPrecedent.Status.OPEN,
            owner=owner,
            due_date=due_date,
            created_by=performed_by if performed_by and getattr(performed_by, 'pk', None) else None,
        )
        _log(
            locked,
            ActivityActionType.CLOSING_ITEM_UPDATED,
            performed_by,
            metadata={'event': 'cp_created', 'item_id': str(item.pk), 'title': item.title},
        )
        return item


def update_dd_item(item, *, performed_by=None, **fields):
    with transaction.atomic():
        locked = _lock_deal_for_closing(item.generation.package.deal_id)
        item = DDChecklistItem.objects.select_for_update().select_related('generation').get(pk=item.pk)
        _require_current_item(item)
        if item.is_terminal:
            raise ValidationError({'status': 'Terminal DD items are immutable.'})

        if 'owner' in fields:
            item.owner = _validate_owner(locked, fields['owner'])
        if 'title' in fields:
            item.title = (fields['title'] or '').strip() or item.title
        if 'description' in fields:
            item.description = fields['description'] or ''
        if 'due_date' in fields:
            item.due_date = fields['due_date']

        if 'status' in fields:
            new_status = fields['status']
            if new_status not in DDChecklistItem.Status.values:
                raise ValidationError({'status': 'Unsupported status.'})
            if new_status == DDChecklistItem.Status.WAIVED:
                reason = (fields.get('waiver_reason') or '').strip()
                if not reason:
                    raise ValidationError({'waiver_reason': 'A waiver reason is required.'})
                item.status = new_status
                item.waiver_reason = reason
                item.waived_at = timezone.now()
                item.waived_by = performed_by if performed_by and getattr(performed_by, 'pk', None) else None
                item.completed_at = None
                item.completed_by = None
            elif new_status == DDChecklistItem.Status.COMPLETE:
                item.status = new_status
                item.completed_at = timezone.now()
                item.completed_by = performed_by if performed_by and getattr(performed_by, 'pk', None) else None
                item.waiver_reason = ''
                item.waived_at = None
                item.waived_by = None
            else:
                item.status = new_status
                item.waiver_reason = ''
                item.waived_at = None
                item.waived_by = None
                item.completed_at = None
                item.completed_by = None

        item.save()
        _log(
            locked,
            ActivityActionType.CLOSING_ITEM_UPDATED,
            performed_by,
            metadata={'event': 'dd_updated', 'item_id': str(item.pk), 'status': item.status},
        )
        return item


def update_cp_item(item, *, performed_by=None, **fields):
    with transaction.atomic():
        locked = _lock_deal_for_closing(item.generation.package.deal_id)
        item = ConditionPrecedent.objects.select_for_update().select_related('generation').get(pk=item.pk)
        _require_current_item(item)
        if item.is_terminal:
            raise ValidationError({'status': 'Terminal conditions precedent are immutable.'})

        if 'owner' in fields:
            item.owner = _validate_owner(locked, fields['owner'])
        if 'title' in fields:
            item.title = (fields['title'] or '').strip() or item.title
        if 'description' in fields:
            item.description = fields['description'] or ''
        if 'due_date' in fields:
            item.due_date = fields['due_date']

        if 'status' in fields:
            new_status = fields['status']
            if new_status not in ConditionPrecedent.Status.values:
                raise ValidationError({'status': 'Unsupported status.'})
            if new_status == ConditionPrecedent.Status.WAIVED:
                reason = (fields.get('waiver_reason') or '').strip()
                if not reason:
                    raise ValidationError({'waiver_reason': 'A waiver reason is required.'})
                item.status = new_status
                item.waiver_reason = reason
                item.waived_at = timezone.now()
                item.waived_by = performed_by if performed_by and getattr(performed_by, 'pk', None) else None
                item.satisfied_at = None
                item.satisfied_by = None
            elif new_status == ConditionPrecedent.Status.SATISFIED:
                item.status = new_status
                item.satisfied_at = timezone.now()
                item.satisfied_by = performed_by if performed_by and getattr(performed_by, 'pk', None) else None
                item.waiver_reason = ''
                item.waived_at = None
                item.waived_by = None
            else:
                item.status = new_status
                item.waiver_reason = ''
                item.waived_at = None
                item.waived_by = None
                item.satisfied_at = None
                item.satisfied_by = None

        item.save()
        _log(
            locked,
            ActivityActionType.CLOSING_ITEM_UPDATED,
            performed_by,
            metadata={'event': 'cp_updated', 'item_id': str(item.pk), 'status': item.status},
        )
        return item


def _service_delete_queryset(queryset):
    """Bypass ClosingItemQuerySet.delete() after the service has audited the removal."""
    return QuerySet.delete(queryset)


def delete_dd_item(item, *, performed_by=None):
    with transaction.atomic():
        locked = _lock_deal_for_closing(item.generation.package.deal_id)
        item = DDChecklistItem.objects.select_for_update().select_related('generation').get(pk=item.pk)
        _require_current_item(item)
        if item.status != DDChecklistItem.Status.PENDING:
            raise ValidationError({'status': 'Only pending DD items can be deleted.'})
        item_id = str(item.pk)
        title = item.title
        detached_ids = [str(doc_id) for doc_id in item.documents.values_list('pk', flat=True)]
        item.documents.clear()
        _service_delete_queryset(DDChecklistItem.objects.filter(pk=item.pk))
        _log(
            locked,
            ActivityActionType.CLOSING_ITEM_UPDATED,
            performed_by,
            metadata={
                'event': 'dd_deleted',
                'item_id': item_id,
                'title': title,
                'detached_document_ids': detached_ids,
            },
        )


def delete_cp_item(item, *, performed_by=None):
    with transaction.atomic():
        locked = _lock_deal_for_closing(item.generation.package.deal_id)
        item = ConditionPrecedent.objects.select_for_update().select_related('generation').get(pk=item.pk)
        _require_current_item(item)
        if item.status != ConditionPrecedent.Status.OPEN:
            raise ValidationError({'status': 'Only open conditions precedent can be deleted.'})
        item_id = str(item.pk)
        title = item.title
        detached_ids = [str(doc_id) for doc_id in item.documents.values_list('pk', flat=True)]
        item.documents.clear()
        _service_delete_queryset(ConditionPrecedent.objects.filter(pk=item.pk))
        _log(
            locked,
            ActivityActionType.CLOSING_ITEM_UPDATED,
            performed_by,
            metadata={
                'event': 'cp_deleted',
                'item_id': item_id,
                'title': title,
                'detached_document_ids': detached_ids,
            },
        )


def _authorized_ready_documents(user, deal, document_ids):
    from django.db import connection

    qs = Document.objects.filter(deal=deal, storage_status=DocumentStorageStatus.READY, pk__in=document_ids)
    if not _is_staff_user(user):
        if connection.vendor == 'postgresql':
            qs = qs.filter(visibility_roles__contains=['internal'])
        else:
            matching_ids = [
                document.pk
                for document in qs
                if 'internal' in (document.visibility_roles or [])
            ]
            qs = qs.filter(pk__in=matching_ids)
    found = {str(doc.pk): doc for doc in qs}
    missing = [str(doc_id) for doc_id in document_ids if str(doc_id) not in found]
    if missing:
        raise ValidationError({'document_ids': 'One or more documents are not available.'})
    return list(found.values())


def _document_visible_to_user(user, document):
    if _is_staff_user(user):
        return True
    roles = document.visibility_roles or []
    return 'internal' in roles


def _finalize_document_ids(user, existing, requested, *, terminal: bool):
    visible_existing = [doc for doc in existing if _document_visible_to_user(user, doc)]
    invisible_existing = [doc for doc in existing if not _document_visible_to_user(user, doc)]
    requested_ids = {doc.pk for doc in requested}
    invisible_ids = {doc.pk for doc in invisible_existing}
    if terminal:
        visible_ids = {doc.pk for doc in visible_existing}
        if not requested_ids.issuperset(visible_ids):
            raise ValidationError({'document_ids': 'Terminal evidence cannot remove documents.'})
        return requested_ids | invisible_ids
    return requested_ids | invisible_ids


def set_dd_documents(item, document_ids, *, performed_by, user):
    with transaction.atomic():
        locked = _lock_deal_for_closing(item.generation.package.deal_id)
        item = (
            DDChecklistItem.objects
            .select_for_update()
            .select_related('generation__package')
            .prefetch_related('documents')
            .get(pk=item.pk)
        )
        _require_current_item(item)
        requested = _authorized_ready_documents(user, locked, document_ids)
        existing = list(item.documents.all())
        before_ids = {str(doc.pk) for doc in existing}
        final_ids = _finalize_document_ids(user, existing, requested, terminal=item.is_terminal)
        item.documents.set(Document.objects.filter(pk__in=final_ids))
        after_ids = {str(doc_id) for doc_id in final_ids}
        attached = sorted(after_ids - before_ids)
        detached = sorted(before_ids - after_ids)
        if not attached and not detached:
            return item
        action = (
            ActivityActionType.CLOSING_DOCUMENT_DETACHED
            if detached and not attached
            else ActivityActionType.CLOSING_DOCUMENT_LINKED
        )
        _log(
            locked,
            action,
            performed_by,
            metadata={
                'event': 'dd_documents_set',
                'item_id': str(item.pk),
                'attached_document_ids': attached,
                'detached_document_ids': detached,
                'count': len(final_ids),
            },
        )
        return item


def set_cp_documents(item, document_ids, *, performed_by, user):
    with transaction.atomic():
        locked = _lock_deal_for_closing(item.generation.package.deal_id)
        item = (
            ConditionPrecedent.objects
            .select_for_update()
            .select_related('generation__package')
            .prefetch_related('documents')
            .get(pk=item.pk)
        )
        _require_current_item(item)
        requested = _authorized_ready_documents(user, locked, document_ids)
        existing = list(item.documents.all())
        before_ids = {str(doc.pk) for doc in existing}
        final_ids = _finalize_document_ids(user, existing, requested, terminal=item.is_terminal)
        item.documents.set(Document.objects.filter(pk__in=final_ids))
        after_ids = {str(doc_id) for doc_id in final_ids}
        attached = sorted(after_ids - before_ids)
        detached = sorted(before_ids - after_ids)
        if not attached and not detached:
            return item
        action = (
            ActivityActionType.CLOSING_DOCUMENT_DETACHED
            if detached and not attached
            else ActivityActionType.CLOSING_DOCUMENT_LINKED
        )
        _log(
            locked,
            action,
            performed_by,
            metadata={
                'event': 'cp_documents_set',
                'item_id': str(item.pk),
                'attached_document_ids': attached,
                'detached_document_ids': detached,
                'count': len(final_ids),
            },
        )
        return item


def document_is_closing_linked(document) -> bool:
    from api.services.documents import document_is_closing_linked as policy_check

    return policy_check(document)
