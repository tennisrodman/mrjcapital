import json
from uuid import UUID

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Count, Sum

from api.mcp.auth import require_staff_user
from api.mcp.schemas import DealFilters, DealSearchResult, JsonDict
from api.models import (
    Deal,
    InvestmentType,
    PipelineStatus,
    SourceChannel,
    SyndicationStatus,
)
from api.services import PIPELINE_TRANSITIONS, SYNDICATION_TRANSITIONS
from api.services.deals import (
    SYNDICATION_START_PIPELINE_STATUSES,
    allowed_pipeline_statuses,
    allowed_syndication_statuses,
)


MAX_SEARCH_LIMIT = 50
DEFAULT_SEARCH_LIMIT = 20


class MCPQueryError(ValueError):
    """Raised when MCP query input is malformed."""


class MCPNotFoundError(MCPQueryError):
    """Raised when a requested MCP record is unavailable."""


def search_deals(
    user,
    *,
    pipeline_status=None,
    syndication_status=None,
    investment_type=None,
    source_channel=None,
    sponsor_id=None,
    broker_id=None,
    fund_id=None,
    assigned_analyst_id=None,
    search=None,
    limit=DEFAULT_SEARCH_LIMIT,
    offset=0,
) -> DealSearchResult:
    require_staff_user(user)
    limit, offset = _normalize_pagination(limit, offset)
    queryset = _filtered_deals(
        user,
        {
            'pipeline_status': pipeline_status,
            'syndication_status': syndication_status,
            'investment_type': investment_type,
            'source_channel': source_channel,
            'sponsor_id': sponsor_id,
            'broker_id': broker_id,
            'fund_id': fund_id,
            'assigned_analyst_id': assigned_analyst_id,
            'search': search,
        },
    )
    total = queryset.count()
    deals = list(queryset[offset:offset + limit])
    return {
        'total': total,
        'limit': limit,
        'offset': offset,
        'results': [_serialize_deal(deal, include_details=False) for deal in deals],
    }


def get_deal(user, *, deal_id, include_details=False) -> JsonDict:
    require_staff_user(user)
    deal_uuid = _uuid_value(deal_id, 'deal_id')
    deal = _base_deal_queryset().filter(pk=deal_uuid).first()
    if not deal:
        raise MCPNotFoundError(f'Deal {deal_uuid} was not found.')
    return _serialize_deal(deal, include_details=include_details)


def get_deal_statuses(user) -> JsonDict:
    require_staff_user(user)
    return {
        'pipeline_statuses': _choice_list(PipelineStatus),
        'syndication_statuses': _choice_list(SyndicationStatus),
        'investment_types': _choice_list(InvestmentType),
        'source_channels': _choice_list(SourceChannel),
        'pipeline_transitions': _transition_map(PIPELINE_TRANSITIONS),
        'syndication_transitions': _transition_map(SYNDICATION_TRANSITIONS),
        'syndication_eligible_pipeline_statuses': sorted(SYNDICATION_START_PIPELINE_STATUSES),
    }


def get_deal_allowed_transitions(user, *, deal_id) -> JsonDict:
    require_staff_user(user)
    deal_uuid = _uuid_value(deal_id, 'deal_id')
    deal = _base_deal_queryset().filter(pk=deal_uuid).first()
    if not deal:
        raise MCPNotFoundError(f'Deal {deal_uuid} was not found.')
    return {
        'deal_id': str(deal.pk),
        'pipeline_status': deal.pipeline_status,
        'syndication_status': deal.syndication_status,
        'allowed_pipeline_statuses': allowed_pipeline_statuses(deal),
        'allowed_syndication_statuses': allowed_syndication_statuses(deal),
    }


def get_deal_summary(
    user,
    *,
    pipeline_status=None,
    syndication_status=None,
    investment_type=None,
    source_channel=None,
    sponsor_id=None,
    broker_id=None,
    fund_id=None,
    assigned_analyst_id=None,
    search=None,
) -> JsonDict:
    require_staff_user(user)
    queryset = _filtered_deals(
        user,
        {
            'pipeline_status': pipeline_status,
            'syndication_status': syndication_status,
            'investment_type': investment_type,
            'source_channel': source_channel,
            'sponsor_id': sponsor_id,
            'broker_id': broker_id,
            'fund_id': fund_id,
            'assigned_analyst_id': assigned_analyst_id,
            'search': search,
        },
    )
    active_queryset = queryset.exclude(pipeline_status__in=[PipelineStatus.DEAD, PipelineStatus.EXITED])
    status_counts = queryset.values('pipeline_status').annotate(count=Count('id')).order_by('pipeline_status')
    active_requested = active_queryset.aggregate(total=Sum('requested_amount'))['total']
    gross_requested = queryset.aggregate(total=Sum('requested_amount'))['total']
    return {
        'active_deals': active_queryset.count(),
        'pipeline_value': _json_safe(active_requested or 0),
        'gross_pipeline_value': _json_safe(gross_requested or 0),
        'by_pipeline_status': list(status_counts),
    }


def _filtered_deals(user, filters: DealFilters):
    require_staff_user(user)
    queryset = _base_deal_queryset()
    queryset = _apply_choice_filter(queryset, 'pipeline_status', filters.get('pipeline_status'), PipelineStatus)
    queryset = _apply_choice_filter(queryset, 'syndication_status', filters.get('syndication_status'), SyndicationStatus)
    queryset = _apply_choice_filter(queryset, 'investment_type', filters.get('investment_type'), InvestmentType)
    queryset = _apply_choice_filter(queryset, 'source_channel', filters.get('source_channel'), SourceChannel)
    for input_name, model_field in [('sponsor_id', 'sponsor'), ('broker_id', 'broker'), ('fund_id', 'fund')]:
        value = filters.get(input_name)
        if _present(value):
            queryset = queryset.filter(**{model_field: _uuid_value(value, input_name)})
    assigned_analyst_id = filters.get('assigned_analyst_id')
    if _present(assigned_analyst_id):
        queryset = queryset.filter(assigned_analyst=_int_value(assigned_analyst_id, 'assigned_analyst_id'))
    search = filters.get('search')
    if _present(search):
        queryset = queryset.filter(name__icontains=str(search))
    return queryset


def _base_deal_queryset():
    return Deal.objects.select_related('sponsor', 'broker', 'assigned_analyst', 'fund').prefetch_related(
        'deal_properties__property',
    )


def _apply_choice_filter(queryset, field_name, value, choice_cls):
    if not _present(value):
        return queryset
    if value not in choice_cls.values:
        allowed = ', '.join(choice_cls.values)
        raise MCPQueryError(f'{field_name} must be one of: {allowed}.')
    return queryset.filter(**{field_name: value})


def _serialize_deal(deal, *, include_details):
    payload = {
        'id': str(deal.pk),
        'name': deal.name,
        'investment_type': deal.investment_type,
        'investment_category': deal.investment_category,
        'pipeline_status': deal.pipeline_status,
        'syndication_status': deal.syndication_status,
        'paused_from_status': deal.paused_from_status,
        'sponsor': _sponsor_summary(deal.sponsor),
        'broker': _broker_summary(deal.broker),
        'assigned_analyst': _user_summary(deal.assigned_analyst),
        'fund': _fund_summary(deal.fund),
        'source_channel': deal.source_channel,
        'source_date': _json_safe(deal.source_date),
        'requested_amount': _json_safe(deal.requested_amount),
        'properties': [_deal_property_summary(link) for link in deal.deal_properties.all()],
        'created_at': _json_safe(deal.created_at),
        'updated_at': _json_safe(deal.updated_at),
    }
    if include_details:
        payload['details'] = _json_safe(deal.details)
    return payload


def _sponsor_summary(sponsor):
    if not sponsor:
        return None
    return {
        'id': str(sponsor.pk),
        'entity_name': sponsor.entity_name,
        'relationship_rating': sponsor.relationship_rating,
    }


def _broker_summary(broker):
    if not broker:
        return None
    return {
        'id': str(broker.pk),
        'company_name': broker.company_name,
        'contact_name': broker.contact_name,
        'status': broker.status,
    }


def _fund_summary(fund):
    if not fund:
        return None
    return {
        'id': str(fund.pk),
        'name': fund.name,
        'status': fund.status,
    }


def _user_summary(user):
    if not user:
        return None
    return {
        'id': user.pk,
        'username': user.get_username(),
        'email': user.email,
        'is_staff': user.is_staff,
    }


def _deal_property_summary(link):
    property_obj = link.property
    return {
        'id': link.pk,
        'is_primary': link.is_primary,
        'property': {
            'id': str(property_obj.pk),
            'address': property_obj.address,
            'city': property_obj.city,
            'state': property_obj.state,
            'zip': property_obj.zip,
            'property_type': property_obj.property_type,
            'msa': property_obj.msa,
        },
    }


def _choice_list(choice_cls):
    return [{'value': value, 'label': label} for value, label in choice_cls.choices]


def _transition_map(transitions):
    return {from_status: sorted(to_statuses) for from_status, to_statuses in transitions.items()}


def _normalize_pagination(limit, offset):
    if limit is None:
        normalized_limit = DEFAULT_SEARCH_LIMIT
    else:
        normalized_limit = _int_value(limit, 'limit')
    normalized_offset = 0 if offset is None else _int_value(offset, 'offset')
    if normalized_limit < 1:
        raise MCPQueryError('limit must be at least 1.')
    if normalized_offset < 0:
        raise MCPQueryError('offset must be at least 0.')
    return min(normalized_limit, MAX_SEARCH_LIMIT), normalized_offset


def _uuid_value(value, field_name):
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise MCPQueryError(f'{field_name} must be a valid UUID.') from exc


def _int_value(value, field_name):
    try:
        return int(str(value))
    except (TypeError, ValueError) as exc:
        raise MCPQueryError(f'{field_name} must be a valid integer.') from exc


def _present(value):
    return value is not None and value != ''


def _json_safe(value):
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))
