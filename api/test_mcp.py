from contextlib import contextmanager
from datetime import date
import json
import os
from uuid import uuid4

from asgiref.sync import async_to_sync
from django.contrib.auth.models import User
from django.test import TestCase
from mcp.server.fastmcp.exceptions import ToolError

from api.mcp.auth import MCPAuthError, resolve_mcp_user
from api.mcp.deal_queries import (
    MCPNotFoundError,
    MCPQueryError,
    get_deal,
    get_deal_allowed_transitions,
    get_deal_statuses,
    get_deal_summary,
    search_deals,
)
from api.models import (
    ActivityLog,
    Broker,
    Deal,
    DealProperty,
    Document,
    Fund,
    InvestmentType,
    PipelineStatus,
    Property,
    SourceChannel,
    Sponsor,
    SyndicationStatus,
)
from api.services import normalize_address


@contextmanager
def mcp_env(**values):
    keys = ('MRJ_MCP_USER_ID', 'MRJ_MCP_USERNAME')
    original = {key: os.environ.get(key) for key in keys}
    try:
        for key in keys:
            os.environ.pop(key, None)
        for key, value in values.items():
            os.environ[key] = str(value)
        yield
    finally:
        for key in keys:
            if original[key] is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = original[key]


def mcp_json_result(result):
    if isinstance(result, dict):
        return result
    if len(result) != 1:
        raise AssertionError(f'Expected one MCP content block, got {len(result)}.')
    return json.loads(result[0].text)


class MCPAuthTests(TestCase):
    def setUp(self):
        self.staff_user = User.objects.create_user('staff', password='pw', is_staff=True)
        self.non_staff_user = User.objects.create_user('analyst', password='pw')
        self.inactive_staff = User.objects.create_user('inactive', password='pw', is_staff=True, is_active=False)

    def test_missing_mcp_user_env_fails_closed(self):
        with mcp_env():
            with self.assertRaisesMessage(MCPAuthError, 'MRJ MCP requires MRJ_MCP_USER_ID or MRJ_MCP_USERNAME'):
                resolve_mcp_user()

    def test_unknown_mcp_user_fails_closed(self):
        with mcp_env(MRJ_MCP_USER_ID=999999):
            with self.assertRaisesMessage(MCPAuthError, 'was not found'):
                resolve_mcp_user()

    def test_inactive_mcp_user_fails_closed(self):
        with mcp_env(MRJ_MCP_USER_ID=self.inactive_staff.pk):
            with self.assertRaisesMessage(MCPAuthError, 'must be active'):
                resolve_mcp_user()

    def test_non_staff_mcp_user_fails_closed(self):
        with mcp_env(MRJ_MCP_USERNAME=self.non_staff_user.username):
            with self.assertRaisesMessage(MCPAuthError, 'must be staff or superuser'):
                resolve_mcp_user()

    def test_staff_mcp_user_succeeds(self):
        with mcp_env(MRJ_MCP_USER_ID=self.staff_user.pk):
            self.assertEqual(resolve_mcp_user(), self.staff_user)


class MCPDealFixtureMixin:
    def setUp(self):
        self.staff_user = User.objects.create_user('staff', password='pw', is_staff=True)
        self.analyst = User.objects.create_user('analyst', email='analyst@example.com', password='pw')
        self.other_analyst = User.objects.create_user('other', email='other@example.com', password='pw')
        self.sponsor = Sponsor.objects.create(
            entity_name='Acme Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Avery Sponsor',
            primary_contact_email='avery@example.com',
            relationship_rating='new',
        )
        self.other_sponsor = Sponsor.objects.create(
            entity_name='Oak Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Oak Contact',
            primary_contact_email='oak@example.com',
            relationship_rating='developing',
        )
        self.broker = Broker.objects.create(
            company_name='Metro Capital Markets',
            contact_name='Blair Broker',
            email='blair@example.com',
            status='active',
        )
        self.fund = Fund.objects.create(name='MRJ Capital Fund I', status='forming')
        self.property = Property.objects.create(
            address='123 Main St',
            city='Los Angeles',
            state='CA',
            zip='90001',
            address_normalized=normalize_address('123 Main St', 'Los Angeles', 'CA', '90001'),
            property_type='multifamily',
            msa='Los Angeles-Long Beach-Anaheim',
        )
        self.bridge_deal = Deal.objects.create(
            name='123 Main St Bridge',
            investment_type=InvestmentType.WHOLE_LOAN_BRIDGE,
            sponsor=self.sponsor,
            broker=self.broker,
            assigned_analyst=self.analyst,
            fund=self.fund,
            source_channel=SourceChannel.DIRECT,
            source_date=date(2026, 1, 1),
            requested_amount='2500000.00',
            details={'source_contact_name': 'Avery Sponsor'},
        )
        DealProperty.objects.create(deal=self.bridge_deal, property=self.property, is_primary=True)
        self.oak_deal = Deal.objects.create(
            name='Oak Equity',
            investment_type=InvestmentType.PREFERRED_EQUITY,
            pipeline_status=PipelineStatus.CLOSING,
            syndication_status=SyndicationStatus.RAISING,
            sponsor=self.other_sponsor,
            assigned_analyst=self.other_analyst,
            source_channel=SourceChannel.REFERRAL,
            source_date=date(2026, 1, 2),
            requested_amount='500000.00',
        )
        self.dead_deal = Deal.objects.create(
            name='Dead Loan',
            investment_type=InvestmentType.MEZZANINE,
            pipeline_status=PipelineStatus.DEAD,
            sponsor=self.sponsor,
            assigned_analyst=self.staff_user,
            source_channel=SourceChannel.BROKER,
            source_date=date(2026, 1, 3),
            requested_amount='100000.00',
        )


class MCPDealQueryTests(MCPDealFixtureMixin, TestCase):
    def test_staff_can_search_all_deals_without_details(self):
        result = search_deals(self.staff_user)

        self.assertEqual(result['total'], 3)
        self.assertEqual({row['name'] for row in result['results']}, {'123 Main St Bridge', 'Oak Equity', 'Dead Loan'})
        for row in result['results']:
            self.assertNotIn('details', row)

    def test_search_filters_match_deal_viewset_contract(self):
        cases = [
            ({'pipeline_status': PipelineStatus.CLOSING}, 'Oak Equity'),
            ({'syndication_status': SyndicationStatus.RAISING}, 'Oak Equity'),
            ({'investment_type': InvestmentType.PREFERRED_EQUITY}, 'Oak Equity'),
            ({'source_channel': SourceChannel.REFERRAL}, 'Oak Equity'),
            ({'sponsor_id': str(self.other_sponsor.pk)}, 'Oak Equity'),
            ({'broker_id': str(self.broker.pk)}, '123 Main St Bridge'),
            ({'fund_id': str(self.fund.pk)}, '123 Main St Bridge'),
            ({'assigned_analyst_id': self.other_analyst.pk}, 'Oak Equity'),
            ({'search': 'Bridge'}, '123 Main St Bridge'),
        ]

        for filters, expected_name in cases:
            with self.subTest(filters=filters):
                result = search_deals(self.staff_user, **filters)
                self.assertEqual(result['total'], 1)
                self.assertEqual(result['results'][0]['name'], expected_name)

    def test_invalid_search_filters_return_clear_errors(self):
        invalid_cases = [
            ({'pipeline_status': 'invalid'}, 'pipeline_status must be one of'),
            ({'sponsor_id': 'notauuid'}, 'sponsor_id must be a valid UUID'),
            ({'assigned_analyst_id': 'notanint'}, 'assigned_analyst_id must be a valid integer'),
        ]

        for filters, message in invalid_cases:
            with self.subTest(filters=filters):
                with self.assertRaisesMessage(MCPQueryError, message):
                    search_deals(self.staff_user, **filters)

    def test_search_limit_is_capped_and_offset_applies(self):
        capped = search_deals(self.staff_user, limit=500)
        self.assertEqual(capped['limit'], 50)

        page = search_deals(self.staff_user, limit=1, offset=1)
        self.assertEqual(page['limit'], 1)
        self.assertEqual(page['offset'], 1)
        self.assertEqual(page['results'][0]['name'], 'Oak Equity')

    def test_get_deal_controls_details_field(self):
        without_details = get_deal(self.staff_user, deal_id=str(self.bridge_deal.pk))
        with_details = get_deal(self.staff_user, deal_id=str(self.bridge_deal.pk), include_details=True)

        self.assertNotIn('details', without_details)
        self.assertEqual(with_details['details'], {'source_contact_name': 'Avery Sponsor'})
        self.assertEqual(with_details['sponsor']['entity_name'], 'Acme Sponsor LLC')
        self.assertEqual(with_details['broker']['company_name'], 'Metro Capital Markets')
        self.assertEqual(with_details['fund']['name'], 'MRJ Capital Fund I')
        self.assertEqual(with_details['properties'][0]['property']['address'], '123 Main St')

    def test_get_deal_missing_id_returns_not_found(self):
        with self.assertRaisesMessage(MCPNotFoundError, 'was not found'):
            get_deal(self.staff_user, deal_id=str(uuid4()))

    def test_get_deal_statuses_reflects_choices_and_transition_maps(self):
        statuses = get_deal_statuses(self.staff_user)

        self.assertEqual([row['value'] for row in statuses['pipeline_statuses']], PipelineStatus.values)
        self.assertEqual([row['value'] for row in statuses['syndication_statuses']], SyndicationStatus.values)
        self.assertIn('screening', statuses['pipeline_transitions']['sourced'])
        self.assertIn('raising', statuses['syndication_transitions']['not_started'])
        self.assertEqual(
            statuses['syndication_eligible_pipeline_statuses'],
            ['closing', 'negotiating', 'quoting', 'signed'],
        )

    def test_allowed_transitions_match_normal_and_on_hold_behavior(self):
        normal = get_deal_allowed_transitions(self.staff_user, deal_id=str(self.bridge_deal.pk))
        self.assertEqual(set(normal['allowed_pipeline_statuses']), {'screening', 'on_hold', 'dead'})
        self.assertEqual(normal['allowed_syndication_statuses'], [])

        Deal.objects.filter(pk=self.bridge_deal.pk).update(pipeline_status=PipelineStatus.QUOTING)
        quoting = get_deal_allowed_transitions(self.staff_user, deal_id=str(self.bridge_deal.pk))
        self.assertEqual(quoting['allowed_syndication_statuses'], ['raising'])

        Deal.objects.filter(pk=self.bridge_deal.pk).update(
            pipeline_status=PipelineStatus.ON_HOLD,
            paused_from_status=PipelineStatus.SCREENING,
        )
        paused = get_deal_allowed_transitions(self.staff_user, deal_id=str(self.bridge_deal.pk))
        self.assertEqual(paused['allowed_pipeline_statuses'], ['screening', 'dead'])

        Deal.objects.filter(pk=self.oak_deal.pk).update(pipeline_status=PipelineStatus.DEAD)
        dead = get_deal_allowed_transitions(self.staff_user, deal_id=str(self.oak_deal.pk))
        self.assertEqual(dead['allowed_syndication_statuses'], [])

    def test_deal_summary_counts_active_and_gross_pipeline(self):
        summary = get_deal_summary(self.staff_user)

        self.assertEqual(summary['active_deals'], 2)
        self.assertEqual(summary['pipeline_value'], '3000000')
        self.assertEqual(summary['gross_pipeline_value'], '3100000')
        self.assertEqual(
            {row['pipeline_status']: row['count'] for row in summary['by_pipeline_status']},
            {'closing': 1, 'dead': 1, 'sourced': 1},
        )

    def test_mcp_queries_are_read_only(self):
        before_deals = list(
            Deal.objects.order_by('pk').values_list('pk', 'pipeline_status', 'syndication_status', 'updated_at')
        )
        before_documents = Document.objects.count()
        before_activity_logs = ActivityLog.objects.count()

        search_deals(self.staff_user)
        get_deal(self.staff_user, deal_id=str(self.bridge_deal.pk), include_details=True)
        get_deal_statuses(self.staff_user)
        get_deal_allowed_transitions(self.staff_user, deal_id=str(self.bridge_deal.pk))
        get_deal_summary(self.staff_user)

        after_deals = list(
            Deal.objects.order_by('pk').values_list('pk', 'pipeline_status', 'syndication_status', 'updated_at')
        )
        self.assertEqual(after_deals, before_deals)
        self.assertEqual(Document.objects.count(), before_documents)
        self.assertEqual(ActivityLog.objects.count(), before_activity_logs)


class MCPServerRegistrationTests(TestCase):
    def test_stdio_server_registers_read_only_tools(self):
        from api.mcp.server import mcp

        tools = async_to_sync(mcp.list_tools)()

        self.assertEqual(
            {tool.name for tool in tools},
            {
                'mrj_search_deals',
                'mrj_get_deal',
                'mrj_get_deal_statuses',
                'mrj_get_deal_allowed_transitions',
                'mrj_get_deal_summary',
            },
        )


class MCPServerCallToolTests(MCPDealFixtureMixin, TestCase):
    def test_stdio_server_call_tool_executes_db_backed_tools(self):
        from api.mcp.server import mcp

        with mcp_env(MRJ_MCP_USER_ID=self.staff_user.pk):
            search = mcp_json_result(async_to_sync(mcp.call_tool)('mrj_search_deals', {'search': 'Bridge'}))
            detail = mcp_json_result(async_to_sync(mcp.call_tool)(
                'mrj_get_deal',
                {'deal_id': str(self.bridge_deal.pk), 'include_details': True},
            ))
            statuses = mcp_json_result(async_to_sync(mcp.call_tool)('mrj_get_deal_statuses', {}))
            transitions = mcp_json_result(async_to_sync(mcp.call_tool)(
                'mrj_get_deal_allowed_transitions',
                {'deal_id': str(self.bridge_deal.pk)},
            ))
            summary = mcp_json_result(async_to_sync(mcp.call_tool)('mrj_get_deal_summary', {}))

        self.assertEqual(search['total'], 1)
        self.assertEqual(search['results'][0]['name'], '123 Main St Bridge')
        self.assertEqual(detail['details'], {'source_contact_name': 'Avery Sponsor'})
        self.assertIn({'value': 'sourced', 'label': 'Sourced'}, statuses['pipeline_statuses'])
        self.assertEqual(set(transitions['allowed_pipeline_statuses']), {'screening', 'on_hold', 'dead'})
        self.assertEqual(summary['active_deals'], 2)

    def test_stdio_server_call_tool_surfaces_useful_errors(self):
        from api.mcp.server import mcp

        with mcp_env(MRJ_MCP_USER_ID=self.staff_user.pk):
            with self.assertRaisesMessage(ToolError, 'was not found'):
                async_to_sync(mcp.call_tool)('mrj_get_deal', {'deal_id': str(uuid4())})
