"""Smoke tests for the MRJ Capital API auth contract."""

import base64
import hashlib
import uuid
from unittest.mock import patch

from cryptography.fernet import Fernet
from django.contrib.admin.sites import AdminSite
from django.contrib.auth.models import User
from django.core.exceptions import ImproperlyConfigured
from django.db import connection, IntegrityError
from django.test import RequestFactory, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from api.admin import ActivityLogAdmin, SponsorAdmin
from api.fields import EncryptedTextField, _fernet
from api.models import (
    ActivityActionType,
    ActivityLog,
    Broker,
    Deal,
    DealNote,
    Document,
    DocumentStorageStatus,
    Fund,
    PipelineStatus,
    Property,
    Sponsor,
)
from api.services import normalize_address


class AuthFlowTests(APITestCase):
    def setUp(self):
        self.username = 'tester'
        self.password = 's3cret-pw-123'
        self.user = User.objects.create_user(
            self.username,
            email='tester@example.com',
            password=self.password,
        )

    def test_login_returns_jwt_tokens(self):
        resp = self.client.post(
            reverse('login'),
            {'username': self.username, 'password': self.password},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data['tokens'])
        self.assertIn('refresh', resp.data['tokens'])
        self.assertEqual(resp.data['user']['username'], self.username)

    def test_login_wrong_password_is_401(self):
        resp = self.client.post(
            reverse('login'),
            {'username': self.username, 'password': 'wrong'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_missing_fields_is_400(self):
        resp = self.client.post(reverse('login'), {'username': self.username}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_user_info_requires_authentication(self):
        resp = self.client.get(reverse('user_info'))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_user_info_with_token_returns_profile(self):
        login = self.client.post(
            reverse('login'),
            {'username': self.username, 'password': self.password},
            format='json',
        )
        access = login.data['tokens']['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        resp = self.client.get(reverse('user_info'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['username'], self.username)
        self.assertEqual(resp.data['email'], 'tester@example.com')
        self.assertIn('is_staff', resp.data)

    def test_unknown_api_route_returns_json_404(self):
        resp = self.client.get('/api/does-not-exist/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(resp.json()['error'], 'Not found')


class ActivityLogAdminTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_superuser(
            username='admin',
            email='admin@example.com',
            password='pw',
        )
        self.request = RequestFactory().get('/admin/api/activitylog/')
        self.request.user = self.user
        self.model_admin = ActivityLogAdmin(ActivityLog, AdminSite())

    @override_settings(AUDIT_LOG_ADMIN_IMMUTABLE=True)
    def test_activity_log_admin_is_view_only_when_immutable(self):
        self.assertFalse(self.model_admin.has_add_permission(self.request))
        self.assertFalse(self.model_admin.has_change_permission(self.request))
        self.assertFalse(self.model_admin.has_delete_permission(self.request))
        self.assertNotIn('delete_selected', self.model_admin.get_actions(self.request))

    @override_settings(AUDIT_LOG_ADMIN_IMMUTABLE=False)
    def test_activity_log_admin_remains_manageable_when_not_immutable(self):
        self.assertTrue(self.model_admin.has_add_permission(self.request))
        self.assertTrue(self.model_admin.has_change_permission(self.request))
        self.assertTrue(self.model_admin.has_delete_permission(self.request))

    def test_sponsor_admin_excludes_encrypted_pii_fields(self):
        sponsor_admin = SponsorAdmin(Sponsor, AdminSite())
        form = sponsor_admin.get_form(self.request)

        self.assertNotIn('ein', form.base_fields)
        self.assertNotIn('guarantor_net_worth', form.base_fields)
        self.assertNotIn('guarantor_liquidity', form.base_fields)
        self.assertNotIn('guarantor_credit_score', form.base_fields)


class DealSpineApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('analyst', email='analyst@example.com', password='pw')
        self.staff_user = User.objects.create_user(
            'staff',
            email='staff@example.com',
            password='pw',
            is_staff=True,
        )
        self.other_user = User.objects.create_user('other', email='other@example.com', password='pw')
        self.client.force_authenticate(self.user)
        self.sponsor = Sponsor.objects.create(
            entity_name='Acme Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Avery Sponsor',
            primary_contact_email='avery@example.com',
            primary_contact_phone='555-111-2222',
            relationship_rating='new',
            ein='12-3456789',
            guarantor_net_worth='10000000',
            guarantor_liquidity='1500000',
            guarantor_credit_score='720',
            details={'years_experience': 8},
        )
        self.property = Property.objects.create(
            address='123 Main St',
            city='Los Angeles',
            state='CA',
            zip='90001',
            address_normalized=normalize_address('123 Main St', 'Los Angeles', 'CA', '90001'),
            property_type='multifamily',
            msa='Los Angeles-Long Beach-Anaheim',
        )

    def create_deal(self):
        return Deal.objects.create(
            name='123 Main St Bridge',
            investment_type='whole_loan_bridge',
            sponsor=self.sponsor,
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='2500000.00',
            details={'source_contact_name': 'Avery Sponsor'},
        )

    def _upload_intent(self, deal, name, category, file_type='pdf', visibility_roles=None,
                       size=32, content_type='application/pdf'):
        payload = {
            'deal': str(deal.pk),
            'document_name': name,
            'category': category,
            'file_type': file_type,
            'file_size_bytes': size,
            'content_type': content_type,
        }
        if visibility_roles is not None:
            payload['visibility_roles'] = visibility_roles
        return self.client.post('/api/documents/upload-intent/', payload, format='json')

    def _create_ready_document(self, deal, name, category, file_type='pdf', visibility_roles=None):
        document_id = uuid.uuid4()
        return Document.objects.create(
            id=document_id,
            deal=deal,
            document_name=name,
            category=category,
            file_url=f'deals/{deal.pk}/{document_id}/v1/{file_type}-doc.{file_type}',
            file_type=file_type,
            content_type='application/pdf',
            file_size_bytes=32,
            storage_status=DocumentStorageStatus.READY,
            uploaded_by=self.user,
            visibility_roles=visibility_roles or ['internal'],
        )

    def test_non_staff_deal_access_is_scoped_to_assigned_analyst(self):
        own_deal = self.create_deal()
        other_deal = Deal.objects.create(
            name='Other Analyst Deal',
            investment_type='whole_loan_bridge',
            sponsor=self.sponsor,
            assigned_analyst=self.other_user,
            source_channel='direct',
            requested_amount='1000000.00',
        )

        list_resp = self.client.get('/api/deals/')
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in response_results(list_resp)], [str(own_deal.pk)])

        detail_resp = self.client.get(f'/api/deals/{other_deal.pk}/')
        self.assertEqual(detail_resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_malformed_filter_ids_return_400(self):
        for path in [
            '/api/deals/?sponsor=notauuid',
            '/api/deal-properties/?deal=notauuid',
            '/api/documents/?deal=notauuid',
        ]:
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.force_authenticate(self.staff_user)
        resp = self.client.get('/api/deals/?assigned_analyst=notanint')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        resp = self.client.get('/api/activity-logs/?deal=notauuid')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_deal_create_controls_assigned_analyst_and_relationships_are_immutable(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Assigned Analyst Probe',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'assigned_analyst': str(self.other_user.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        self.assertEqual(deal.assigned_analyst, self.user)

        other_sponsor = Sponsor.objects.create(
            entity_name='Replacement Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Replacement Sponsor',
            primary_contact_email='replacement@example.com',
            relationship_rating='new',
        )
        update = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'sponsor': str(other_sponsor.pk)},
            format='json',
        )

        self.assertEqual(update.status_code, status.HTTP_400_BAD_REQUEST)
        deal.refresh_from_db()
        self.assertEqual(deal.sponsor, self.sponsor)

    def test_create_deal_with_properties(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': '123 Main St Bridge',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'property_ids': [str(self.property.pk)],
                'details': {'source_contact_name': 'Avery Sponsor'},
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        self.assertEqual(deal.pipeline_status, PipelineStatus.SOURCED)
        self.assertEqual(deal.assigned_analyst, self.user)
        self.assertEqual(deal.deal_properties.get().property, self.property)
        self.assertEqual(resp.data['investment_category'], 'debt')

    def test_create_sparse_deal_without_sponsor_or_properties(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Early First Look',
                'investment_type': 'whole_loan_bridge',
                'source_channel': 'internal_prospecting',
                'requested_amount': '1000000.00',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        self.assertIsNone(deal.sponsor)
        self.assertEqual(deal.deal_properties.count(), 0)
        self.assertIsNone(resp.data['sponsor'])
        self.assertEqual(resp.data['properties'], [])

    def test_create_deal_with_nested_sponsor_broker_and_property(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Nested Intake Deal',
                'investment_type': 'whole_loan_bridge',
                'source_channel': 'broker',
                'requested_amount': '3500000.00',
                'sponsor': {
                    'entity_name': 'Nested Sponsor LLC',
                    'entity_type': 'llc',
                    'primary_contact_name': 'Nora Sponsor',
                    'primary_contact_email': 'nora@example.com',
                },
                'broker': {
                    'company_name': 'Nested Capital Markets',
                    'email': 'broker@example.com',
                },
                'properties': [
                    {
                        'address': '777 Nested Way',
                        'city': 'Pasadena',
                        'state': 'CA',
                        'zip': '91101',
                        'property_type': 'multifamily',
                        'msa': 'Los Angeles-Long Beach-Anaheim',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        self.assertEqual(deal.sponsor.entity_name, 'Nested Sponsor LLC')
        self.assertEqual(deal.broker.company_name, 'Nested Capital Markets')
        self.assertEqual(deal.broker.contact_name, 'Nested Capital Markets')
        self.assertEqual(deal.deal_properties.get().property.address, '777 Nested Way')

    def test_create_deal_with_mixed_existing_and_new_properties(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Mixed Property Intake',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '4500000.00',
                'properties': [
                    str(self.property.pk),
                    {
                        'address': '888 Mixed Ave',
                        'city': 'Glendale',
                        'state': 'CA',
                        'zip': '91203',
                        'property_type': 'office',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        links = list(deal.deal_properties.order_by('-is_primary', 'property__address'))
        self.assertEqual(len(links), 2)
        self.assertEqual(links[0].property, self.property)
        self.assertTrue(links[0].is_primary)
        self.assertTrue(Property.objects.filter(address='888 Mixed Ave').exists())

    def test_nested_property_duplicate_is_rejected(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Duplicate Nested Property',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'properties': [
                    {
                        'address': '123 Main St',
                        'city': 'Los Angeles',
                        'state': 'CA',
                        'zip': '90001',
                        'property_type': 'multifamily',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('properties', resp.data)
        self.assertFalse(Deal.objects.filter(name='Duplicate Nested Property').exists())

    def test_nested_create_rolls_back_if_property_linking_fails(self):
        with patch('api.serializers.DealProperty.objects.bulk_create', side_effect=IntegrityError('bulk failed')):
            with self.assertRaises(IntegrityError):
                self.client.post(
                    '/api/deals/',
                    {
                        'name': 'Rollback Nested Intake',
                        'investment_type': 'whole_loan_bridge',
                        'source_channel': 'broker',
                        'requested_amount': '2500000.00',
                        'sponsor': {
                            'entity_name': 'Rollback Sponsor LLC',
                            'entity_type': 'llc',
                            'primary_contact_name': 'Riley Rollback',
                            'primary_contact_email': 'rollback@example.com',
                        },
                        'broker': {
                            'company_name': 'Rollback Broker LLC',
                            'email': 'rollback-broker@example.com',
                        },
                        'properties': [
                            {
                                'address': '999 Rollback Rd',
                                'city': 'Burbank',
                                'state': 'CA',
                                'zip': '91501',
                                'property_type': 'industrial',
                            },
                        ],
                    },
                    format='json',
                )

        self.assertFalse(Deal.objects.filter(name='Rollback Nested Intake').exists())
        self.assertFalse(Sponsor.objects.filter(entity_name='Rollback Sponsor LLC').exists())
        self.assertFalse(Broker.objects.filter(company_name='Rollback Broker LLC').exists())
        self.assertFalse(Property.objects.filter(address='999 Rollback Rd').exists())

    def test_nested_property_integrity_error_returns_validation_error(self):
        with patch('api.serializers.Property.objects.create', side_effect=IntegrityError('duplicate key')):
            resp = self.client.post(
                '/api/deals/',
                {
                    'name': 'Race Duplicate Property',
                    'investment_type': 'whole_loan_bridge',
                    'sponsor': str(self.sponsor.pk),
                    'source_channel': 'direct',
                    'requested_amount': '2500000.00',
                    'properties': [
                        {
                            'address': '999 Race Rd',
                            'city': 'Burbank',
                            'state': 'CA',
                            'zip': '91501',
                            'property_type': 'industrial',
                        },
                    ],
                },
                format='json',
            )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('properties', resp.data)
        self.assertFalse(Deal.objects.filter(name='Race Duplicate Property').exists())

    def test_patch_can_fill_empty_relationships_once(self):
        broker = Broker.objects.create(
            company_name='Fill Later Broker',
            contact_name='Fill Later Broker',
            email='fill-broker@example.com',
        )
        fund = Fund.objects.create(name='Fill Later Fund', status='forming')
        deal = Deal.objects.create(
            name='Fill Later Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='2500000.00',
        )

        fill = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {
                'sponsor': str(self.sponsor.pk),
                'broker': str(broker.pk),
                'fund': str(fund.pk),
            },
            format='json',
        )

        self.assertEqual(fill.status_code, status.HTTP_200_OK)
        deal.refresh_from_db()
        self.assertEqual(deal.sponsor, self.sponsor)
        self.assertEqual(deal.broker, broker)
        self.assertEqual(deal.fund, fund)

        remove = self.client.patch(f'/api/deals/{deal.pk}/', {'broker': None}, format='json')
        self.assertEqual(remove.status_code, status.HTTP_400_BAD_REQUEST)
        deal.refresh_from_db()
        self.assertEqual(deal.broker, broker)

    def test_deal_rejects_duplicate_property_ids(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Duplicate Property Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'property_ids': [str(self.property.pk), str(self.property.pk)],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('property_ids', resp.data)
        self.assertFalse(Deal.objects.filter(name='Duplicate Property Deal').exists())

    def test_deal_rejects_non_positive_requested_amount(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Negative Amount Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '-1.00',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('requested_amount', resp.data)

    def test_deal_rejects_empty_property_ids_when_provided(self):
        deal = self.create_deal()
        deal.deal_properties.create(property=self.property, is_primary=True)

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'property_ids': []},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('property_ids', resp.data)
        self.assertEqual(deal.deal_properties.count(), 1)

    def test_deal_property_replacement_is_atomic_if_bulk_create_fails(self):
        deal = self.create_deal()
        deal.deal_properties.create(property=self.property, is_primary=True)
        replacement = Property.objects.create(
            address='900 Replacement Rd',
            city='Burbank',
            state='CA',
            zip='91502',
            address_normalized=normalize_address('900 Replacement Rd', 'Burbank', 'CA', '91502'),
            property_type='office',
        )

        with patch('api.serializers.DealProperty.objects.bulk_create', side_effect=IntegrityError('bulk failed')):
            with self.assertRaises(IntegrityError):
                self.client.patch(
                    f'/api/deals/{deal.pk}/',
                    {'name': 'Changed Deal Name', 'property_ids': [str(replacement.pk)]},
                    format='json',
                )

        deal.refresh_from_db()
        self.assertEqual(deal.name, '123 Main St Bridge')
        self.assertEqual(deal.deal_properties.count(), 1)
        self.assertEqual(deal.deal_properties.get().property, self.property)

    def test_deal_patch_cannot_directly_change_status_fields(self):
        deal = self.create_deal()

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'pipeline_status': 'closing', 'syndication_status': 'raising'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        deal.refresh_from_db()
        self.assertEqual(deal.pipeline_status, PipelineStatus.SOURCED)
        self.assertEqual(deal.syndication_status, 'not_started')
        self.assertFalse(ActivityLog.objects.filter(deal=deal, action_type=ActivityActionType.STATUS_CHANGE).exists())

    def test_pipeline_transition_writes_activity_log_and_supports_on_hold_resume(self):
        deal = self.create_deal()

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Initial package complete'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['pipeline_status'], 'screening')

        log = ActivityLog.objects.get(action_type=ActivityActionType.STATUS_CHANGE, old_value='sourced')
        self.assertEqual(log.deal, deal)
        self.assertEqual(log.new_value, 'screening')
        self.assertEqual(log.reason, 'Initial package complete')
        self.assertEqual(log.metadata['field'], 'pipeline_status')

        hold = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'on_hold', 'reason': 'Waiting for updated rent roll'},
            format='json',
        )
        self.assertEqual(hold.status_code, status.HTTP_200_OK)
        self.assertEqual(hold.data['paused_from_status'], 'screening')

        resume = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Updated rent roll received'},
            format='json',
        )
        self.assertEqual(resume.status_code, status.HTTP_200_OK)
        self.assertIsNone(resume.data['paused_from_status'])

    @override_settings(FORWARDED_FOR_TRUSTED_PROXY_COUNT=1)
    def test_status_change_audit_ip_uses_trusted_proxy_depth(self):
        deal = self.create_deal()

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Initial package complete'},
            format='json',
            HTTP_X_FORWARDED_FOR='1.2.3.4, 198.51.100.7',
            REMOTE_ADDR='10.0.0.10',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        log = ActivityLog.objects.get(action_type=ActivityActionType.STATUS_CHANGE)
        self.assertEqual(log.ip_address, '198.51.100.7')

    def test_allowed_transitions_reflect_current_status_and_on_hold_resume(self):
        deal = self.create_deal()

        initial = self.client.get(f'/api/deals/{deal.pk}/allowed-transitions/')
        self.assertEqual(initial.status_code, status.HTTP_200_OK)
        self.assertEqual(set(initial.data['pipeline_status']), {'screening', 'on_hold', 'dead'})
        self.assertEqual(initial.data['syndication_status'], [])

        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Start screening'},
            format='json',
        )
        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'on_hold', 'reason': 'Waiting on sponsor'},
            format='json',
        )

        paused = self.client.get(f'/api/deals/{deal.pk}/allowed-transitions/')
        self.assertEqual(paused.status_code, status.HTTP_200_OK)
        self.assertEqual(paused.data['pipeline_status'], ['screening', 'dead'])

    def test_allowed_syndication_transitions_reflect_pipeline_window(self):
        deal = self.create_deal()

        sourced = self.client.get(f'/api/deals/{deal.pk}/allowed-transitions/')
        self.assertEqual(sourced.status_code, status.HTTP_200_OK)
        self.assertEqual(sourced.data['syndication_status'], [])

        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Start screening'},
            format='json',
        )
        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'quoting', 'reason': 'Ready to quote'},
            format='json',
        )

        quoting = self.client.get(f'/api/deals/{deal.pk}/allowed-transitions/')
        self.assertEqual(quoting.status_code, status.HTTP_200_OK)
        self.assertEqual(quoting.data['syndication_status'], ['raising'])

        Deal.objects.filter(pk=deal.pk).update(
            pipeline_status=PipelineStatus.DEAD,
            syndication_status='raising',
        )
        dead = self.client.get(f'/api/deals/{deal.pk}/allowed-transitions/')
        self.assertEqual(dead.status_code, status.HTTP_200_OK)
        self.assertEqual(dead.data['syndication_status'], [])

    def test_invalid_pipeline_transition_is_rejected(self):
        deal = self.create_deal()

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'closing', 'reason': 'Skip ahead'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        deal.refresh_from_db()
        self.assertEqual(deal.pipeline_status, PipelineStatus.SOURCED)
        self.assertFalse(ActivityLog.objects.filter(deal=deal, action_type=ActivityActionType.STATUS_CHANGE).exists())

    def test_on_hold_deal_can_be_marked_dead_directly(self):
        deal = self.create_deal()
        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'on_hold', 'reason': 'Sponsor requested pause'},
            format='json',
        )

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'dead', 'reason': 'Sponsor withdrew while paused'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['pipeline_status'], 'dead')
        self.assertIsNone(resp.data['paused_from_status'])

    def test_on_hold_deal_rejects_resume_without_paused_from_status(self):
        deal = self.create_deal()
        deal.pipeline_status = PipelineStatus.ON_HOLD
        deal.paused_from_status = None
        deal.save(update_fields=['pipeline_status', 'paused_from_status', 'updated_at'])

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Resume from corrupted state'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('paused_from_status', resp.data)
        deal.refresh_from_db()
        self.assertEqual(deal.pipeline_status, PipelineStatus.ON_HOLD)
        self.assertIsNone(deal.paused_from_status)

    def test_on_hold_deal_rejects_resume_to_any_status_except_paused_from(self):
        deal = self.create_deal()
        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Start screening'},
            format='json',
        )
        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'on_hold', 'reason': 'Pause for missing package'},
            format='json',
        )

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'quoting', 'reason': 'Try to skip on resume'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('to_status', resp.data)
        deal.refresh_from_db()
        self.assertEqual(deal.pipeline_status, PipelineStatus.ON_HOLD)
        self.assertEqual(deal.paused_from_status, PipelineStatus.SCREENING)

    def test_transition_requires_reason(self):
        deal = self.create_deal()

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': ''},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        deal.refresh_from_db()
        self.assertEqual(deal.pipeline_status, PipelineStatus.SOURCED)

    def test_syndication_transition_requires_pipeline_window_and_writes_activity_log(self):
        deal = self.create_deal()

        early = self.client.post(
            f'/api/deals/{deal.pk}/transition-syndication/',
            {'to_status': 'raising', 'reason': 'Begin investor outreach'},
            format='json',
        )
        self.assertEqual(early.status_code, status.HTTP_400_BAD_REQUEST)

        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'screening', 'reason': 'Start screening'},
            format='json',
        )
        self.client.post(
            f'/api/deals/{deal.pk}/transition/',
            {'to_status': 'quoting', 'reason': 'Advance to quoting'},
            format='json',
        )
        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition-syndication/',
            {'to_status': 'raising', 'reason': 'Begin investor outreach'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['syndication_status'], 'raising')
        log = ActivityLog.objects.get(action_type=ActivityActionType.STATUS_CHANGE, old_value='not_started')
        self.assertEqual(log.new_value, 'raising')
        self.assertEqual(log.metadata['field'], 'syndication_status')

    def test_syndication_cannot_start_after_pipeline_status_closes(self):
        deal = self.create_deal()
        for to_status in ['screening', 'quoting', 'negotiating', 'signed', 'closing', 'closed']:
            self.client.post(
                f'/api/deals/{deal.pk}/transition/',
                {'to_status': to_status, 'reason': f'Advance to {to_status}'},
                format='json',
            )

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition-syndication/',
            {'to_status': 'raising', 'reason': 'Begin investor outreach too late'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data['pipeline_status'][0], 'Syndication can start only while the deal is quoting through closing.')

    def test_syndication_can_close_after_pipeline_moves_to_servicing(self):
        deal = self.create_deal()
        for to_status in ['screening', 'quoting']:
            self.client.post(
                f'/api/deals/{deal.pk}/transition/',
                {'to_status': to_status, 'reason': f'Advance to {to_status}'},
                format='json',
            )
        for to_status in ['raising', 'fully_subscribed']:
            self.client.post(
                f'/api/deals/{deal.pk}/transition-syndication/',
                {'to_status': to_status, 'reason': f'Advance syndication to {to_status}'},
                format='json',
            )
        for to_status in ['negotiating', 'signed', 'closing', 'closed', 'servicing']:
            self.client.post(
                f'/api/deals/{deal.pk}/transition/',
                {'to_status': to_status, 'reason': f'Advance to {to_status}'},
                format='json',
            )

        resp = self.client.post(
            f'/api/deals/{deal.pk}/transition-syndication/',
            {'to_status': 'closed', 'reason': 'Raise finalized in servicing'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['pipeline_status'], 'servicing')
        self.assertEqual(resp.data['syndication_status'], 'closed')

    def test_property_deduplicate_returns_existing_property_and_deals(self):
        deal = self.create_deal()
        deal.deal_properties.create(property=self.property, is_primary=True)

        resp = self.client.post(
            '/api/properties/deduplicate/',
            {
                'address': '123 Main Street',
                'city': 'Los Angeles',
                'state': 'CA',
                'zip': '90001',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data['exists'])
        self.assertEqual(resp.data['property']['id'], str(self.property.pk))
        self.assertEqual(resp.data['deals'][0]['id'], str(deal.pk))

    def test_property_deduplicate_returns_no_match(self):
        resp = self.client.post(
            '/api/properties/deduplicate/',
            {
                'address': '987 Unknown Road',
                'city': 'Pasadena',
                'state': 'CA',
                'zip': '91101',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data['exists'])
        self.assertEqual(resp.data['address_normalized'], '987 unknown rd pasadena ca 91101')
        self.assertEqual(resp.data['deals'], [])

    def test_property_create_rejects_duplicate_normalized_address(self):
        resp = self.client.post(
            '/api/properties/',
            {
                'address': '123 Main Street',
                'city': 'Los Angeles',
                'state': 'CA',
                'zip': '90001',
                'property_type': 'multifamily',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('address_normalized', resp.data)
        self.assertIn('existing_property', resp.data)

    def test_property_create_integrity_race_returns_400(self):
        with patch('api.viewsets.PropertyViewSet.perform_create', side_effect=IntegrityError('duplicate key')):
            resp = self.client.post(
                '/api/properties/',
                {
                    'address': '789 Race Street',
                    'city': 'Glendale',
                    'state': 'CA',
                    'zip': '91201',
                    'property_type': 'office',
                },
                format='json',
            )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('address_normalized', resp.data)

    def test_property_create_auto_normalizes_address_and_state(self):
        resp = self.client.post(
            '/api/properties/',
            {
                'address': '456 Market Avenue',
                'city': 'San Diego',
                'state': 'ca',
                'zip': '92101',
                'property_type': 'retail',
                'msa': 'San Diego-Chula Vista-Carlsbad',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['state'], 'CA')
        self.assertEqual(resp.data['address_normalized'], '456 market ave san diego ca 92101')

    def test_sensitive_sponsor_fields_are_encrypted_and_only_returned_through_logged_endpoint(self):
        self.create_deal()
        with connection.cursor() as cursor:
            cursor.execute('SELECT ein FROM api_sponsor LIMIT 1')
            raw_ein = cursor.fetchone()[0]
        self.assertTrue(raw_ein.startswith('fernet$'))
        self.assertNotIn('12-3456789', raw_ein)

        detail = self.client.get(f'/api/sponsors/{self.sponsor.pk}/')
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertNotIn('ein', detail.data)
        self.assertNotIn('guarantor_net_worth', detail.data)

        with CaptureQueriesContext(connection) as queries:
            list_resp = self.client.get('/api/sponsors/')
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        sponsor_selects = [
            query['sql'].lower()
            for query in queries
            if 'from "api_sponsor"' in query['sql'].lower() and 'select' in query['sql'].lower()
        ]
        self.assertTrue(sponsor_selects)
        self.assertFalse(any('"ein"' in query for query in sponsor_selects))
        self.assertFalse(any('guarantor_net_worth' in query for query in sponsor_selects))

        forbidden = self.client.post(
            f'/api/sponsors/{self.sponsor.pk}/sensitive-fields/',
            {'fields': ['ein'], 'reason': 'KYC review'},
            format='json',
        )
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.staff_user)
        resp = self.client.post(
            f'/api/sponsors/{self.sponsor.pk}/sensitive-fields/',
            {'fields': ['ein', 'guarantor_credit_score'], 'reason': 'KYC review'},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['fields']['ein'], '12-3456789')
        self.assertEqual(resp.data['fields']['guarantor_credit_score'], '720')
        log = ActivityLog.objects.get(action_type=ActivityActionType.SENSITIVE_FIELD_READ)
        self.assertIsNone(log.deal)
        self.assertEqual(log.reason, 'KYC review')
        self.assertEqual(log.metadata['subject_model'], 'Sponsor')
        self.assertEqual(log.metadata['fields'], ['ein', 'guarantor_credit_score'])

    @override_settings(FORWARDED_FOR_TRUSTED_PROXY_COUNT=0)
    def test_sensitive_field_audit_ip_ignores_forwarded_for_without_trusted_proxy(self):
        self.client.force_authenticate(self.staff_user)
        resp = self.client.post(
            f'/api/sponsors/{self.sponsor.pk}/sensitive-fields/',
            {'fields': ['ein'], 'reason': 'KYC review'},
            format='json',
            HTTP_X_FORWARDED_FOR='1.2.3.4',
            REMOTE_ADDR='203.0.113.9',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        log = ActivityLog.objects.get(action_type=ActivityActionType.SENSITIVE_FIELD_READ)
        self.assertEqual(log.ip_address, '203.0.113.9')

    def test_sponsor_api_validates_encrypted_numeric_fields(self):
        resp = self.client.post(
            '/api/sponsors/',
            {
                'entity_name': 'Invalid Financials LLC',
                'entity_type': 'llc',
                'primary_contact_name': 'Invalid Sponsor',
                'primary_contact_email': 'invalid@example.com',
                'relationship_rating': 'new',
                'guarantor_net_worth': '1000000',
                'guarantor_liquidity': 'not-a-number',
                'guarantor_credit_score': '72O',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('guarantor_liquidity', resp.data)
        self.assertIn('guarantor_credit_score', resp.data)

    def test_sponsor_details_rejects_sensitive_mass_assignment(self):
        resp = self.client.post(
            '/api/sponsors/',
            {
                'entity_name': 'Sensitive Details LLC',
                'entity_type': 'llc',
                'primary_contact_name': 'Sensitive Sponsor',
                'primary_contact_email': 'sensitive@example.com',
                'relationship_rating': 'new',
                'details': {'ein': '12-3456789'},
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('details', resp.data)

        nested = self.client.post(
            '/api/sponsors/',
            {
                'entity_name': 'Nested Sensitive Details LLC',
                'entity_type': 'llc',
                'primary_contact_name': 'Nested Sponsor',
                'primary_contact_email': 'nested@example.com',
                'relationship_rating': 'new',
                'details': {'notes': ['Owner SSN is 123-45-6789']},
            },
            format='json',
        )

        self.assertEqual(nested.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('details', nested.data)

    @override_settings(DEBUG=False, FIELD_ENCRYPTION_KEY='')
    def test_production_encryption_requires_independent_key(self):
        with self.assertRaises(ImproperlyConfigured):
            _fernet()

    def test_encrypted_field_preserves_structural_fernet_tokens_from_other_keys(self):
        old_digest = hashlib.sha256(b'old-key').digest()
        old_key = base64.urlsafe_b64encode(old_digest)
        old_token = Fernet(old_key).encrypt(b'12-3456789').decode('ascii')
        encrypted_value = f'fernet${old_token}'

        self.assertEqual(EncryptedTextField().get_prep_value(encrypted_value), encrypted_value)

    def test_sensitive_field_read_requires_reason_and_matching_deal_context(self):
        deal = self.create_deal()
        self.client.force_authenticate(self.staff_user)
        other_sponsor = Sponsor.objects.create(
            entity_name='Other Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Other Sponsor',
            primary_contact_email='other@example.com',
            relationship_rating='new',
        )
        other_deal = Deal.objects.create(
            name='Other Deal',
            investment_type='whole_loan_bridge',
            sponsor=other_sponsor,
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
        )

        blank_reason = self.client.post(
            f'/api/sponsors/{self.sponsor.pk}/sensitive-fields/',
            {'fields': ['ein'], 'reason': ''},
            format='json',
        )
        self.assertEqual(blank_reason.status_code, status.HTTP_400_BAD_REQUEST)

        wrong_deal = self.client.post(
            f'/api/sponsors/{self.sponsor.pk}/sensitive-fields/',
            {'fields': ['ein'], 'reason': 'KYC review', 'deal': str(other_deal.pk)},
            format='json',
        )
        self.assertEqual(wrong_deal.status_code, status.HTTP_400_BAD_REQUEST)

        valid = self.client.post(
            f'/api/sponsors/{self.sponsor.pk}/sensitive-fields/',
            {'fields': ['ein'], 'reason': 'Deal KYC review', 'deal': str(deal.pk)},
            format='json',
        )
        self.assertEqual(valid.status_code, status.HTTP_200_OK)
        log = ActivityLog.objects.get(action_type=ActivityActionType.SENSITIVE_FIELD_READ)
        self.assertEqual(log.deal, deal)

        filtered = self.client.get(
            f'/api/activity-logs/?subject_model=Sponsor&subject_id={self.sponsor.pk}'
        )
        self.assertEqual(filtered.status_code, status.HTTP_200_OK)
        filtered_results = response_results(filtered)
        self.assertEqual(len(filtered_results), 1)
        self.assertEqual(filtered_results[0]['id'], str(log.pk))

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_document_upload_intent_allocates_sequential_versions(self):
        deal = self.create_deal()

        first = self._upload_intent(deal, 'Offering memo', 'offering_memo')
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data['document']['version'], 1)

        second = self._upload_intent(deal, 'Offering memo', 'offering_memo')
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.data['document']['version'], 2)

        # A different (category, name) starts its own version sequence.
        other = self._upload_intent(deal, 'Loan agreement', 'legal')
        self.assertEqual(other.data['document']['version'], 1)

    def test_document_identity_fields_are_immutable_on_update(self):
        deal = self.create_deal()
        document = self._create_ready_document(deal, 'Offering memo', 'offering_memo')
        other_deal = Deal.objects.create(
            name='Other Deal',
            investment_type='whole_loan_bridge',
            sponsor=self.sponsor,
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
        )

        # deal / category / document_name are guarded and rejected with a 400.
        for field, value in [
            ('deal', str(other_deal.pk)),
            ('category', 'legal'),
            ('document_name', 'Renamed'),
        ]:
            resp = self.client.patch(
                f'/api/documents/{document.pk}/',
                {field: value},
                format='json',
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, field)
            self.assertIn(field, resp.data, field)

        # file_url is read-only, so a change attempt is silently ignored (not applied).
        original_url = document.file_url
        ignored = self.client.patch(
            f'/api/documents/{document.pk}/',
            {'file_url': f'deals/{other_deal.pk}/sneaky/secret.pdf'},
            format='json',
        )
        self.assertEqual(ignored.status_code, status.HTTP_200_OK)

        document.refresh_from_db()
        self.assertEqual(document.file_url, original_url)
        self.assertEqual(document.category, 'offering_memo')
        self.assertEqual(document.document_name, 'Offering memo')

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_document_complete_rolls_back_if_audit_log_write_fails(self):
        deal = self.create_deal()
        content = b'%PDF-1.4 atomic complete'
        intent = self._upload_intent(deal, 'Atomic document', 'legal', size=len(content))
        doc_id = intent.data['document']['id']
        self.client.put(
            f'/api/documents/{doc_id}/blob/',
            data=content,
            content_type='application/pdf',
        )

        with patch('api.viewsets.ActivityLog.objects.create', side_effect=IntegrityError('audit failed')):
            with self.assertRaises(IntegrityError):
                self.client.post(f'/api/documents/{doc_id}/complete/', {}, format='json')

        # The status flip and the audit write share one transaction: neither lands.
        document = Document.objects.get(pk=doc_id)
        self.assertEqual(document.storage_status, DocumentStorageStatus.PENDING)

    def test_deal_delete_is_blocked_when_documents_exist(self):
        deal = self.create_deal()
        self._create_ready_document(deal, 'Executed closing package', 'closing_docs')

        resp = self.client.delete(f'/api/deals/{deal.pk}/')

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Deal.objects.filter(pk=deal.pk).exists())

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_document_visibility_roles_are_validated_and_filterable(self):
        deal = self.create_deal()

        invalid = self._upload_intent(
            deal, 'Bad visibility doc', 'legal', visibility_roles=['public'],
        )
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

        self._create_ready_document(
            deal, 'Investor package', 'investor_docs', visibility_roles=['internal', 'investor'],
        )
        self._create_ready_document(
            deal, 'Internal memo', 'legal', visibility_roles=['internal'],
        )

        # Non-staff analysts can only ever see the internal slice.
        filtered = self.client.get('/api/documents/?visibility_role=investor')
        self.assertEqual(filtered.status_code, status.HTTP_200_OK)
        self.assertEqual(response_results(filtered), [])

        self.client.force_authenticate(self.staff_user)
        staff_filtered = self.client.get('/api/documents/?visibility_role=investor')
        self.assertEqual(staff_filtered.status_code, status.HTTP_200_OK)
        filtered_results = response_results(staff_filtered)
        self.assertEqual(len(filtered_results), 1)
        self.assertEqual(filtered_results[0]['document_name'], 'Investor package')

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_document_upload_intent_complete_and_download_flow(self):
        deal = self.create_deal()
        content = b'%PDF-1.4 test document bytes'

        intent = self.client.post(
            '/api/documents/upload-intent/',
            {
                'deal': str(deal.pk),
                'document_name': 'Offering memo',
                'category': 'offering_memo',
                'file_type': 'pdf',
                'content_type': 'application/pdf',
                'file_size_bytes': len(content),
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(intent.status_code, status.HTTP_201_CREATED)
        document = intent.data['document']
        self.assertEqual(document['storage_status'], 'pending')
        self.assertTrue(document['file_url'].startswith(f'deals/{deal.pk}/'))

        upload = self.client.put(
            f'/api/documents/{document["id"]}/blob/',
            data=content,
            content_type='application/pdf',
        )
        self.assertEqual(upload.status_code, status.HTTP_200_OK)

        complete = self.client.post(f'/api/documents/{document["id"]}/complete/', {}, format='json')
        self.assertEqual(complete.status_code, status.HTTP_200_OK)
        self.assertEqual(complete.data['storage_status'], 'ready')

        log = ActivityLog.objects.filter(
            action_type=ActivityActionType.DOCUMENT_UPLOAD,
            metadata__document_id=document['id'],
        )
        self.assertEqual(log.count(), 1)

        listed = self.client.get(f'/api/documents/?deal={deal.pk}')
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response_results(listed)), 1)

        download = self.client.get(f'/api/documents/{document["id"]}/download/')
        self.assertEqual(download.status_code, status.HTTP_200_OK)
        self.assertIn('/blob/', download.data['download_url'])

        blob = self.client.get(f'/api/documents/{document["id"]}/blob/')
        self.assertEqual(blob.status_code, status.HTTP_200_OK)
        self.assertEqual(blob.content, content)

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_document_blob_put_verifies_declared_checksum(self):
        deal = self.create_deal()
        content = b'%PDF-1.4 checksummed bytes'
        wrong_checksum = hashlib.sha256(b'different bytes').hexdigest()

        intent = self.client.post(
            '/api/documents/upload-intent/',
            {
                'deal': str(deal.pk),
                'document_name': 'Checksum doc',
                'category': 'offering_memo',
                'file_type': 'pdf',
                'content_type': 'application/pdf',
                'file_size_bytes': len(content),
                'checksum_sha256': wrong_checksum,
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(intent.status_code, status.HTTP_201_CREATED)
        document_id = intent.data['document']['id']

        rejected = self.client.put(
            f'/api/documents/{document_id}/blob/',
            data=content,
            content_type='application/pdf',
        )
        self.assertEqual(rejected.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(Document.objects.get(pk=document_id).storage_status, 'pending')

        # A matching declared checksum is accepted and stored.
        Document.objects.filter(pk=document_id).update(
            checksum_sha256=hashlib.sha256(content).hexdigest()
        )
        accepted = self.client.put(
            f'/api/documents/{document_id}/blob/',
            data=content,
            content_type='application/pdf',
        )
        self.assertEqual(accepted.status_code, status.HTTP_200_OK)

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_document_upload_intent_rejects_oversized_file(self):
        deal = self.create_deal()
        resp = self.client.post(
            '/api/documents/upload-intent/',
            {
                'deal': str(deal.pk),
                'document_name': 'Huge file',
                'category': 'financials',
                'file_type': 'pdf',
                'file_size_bytes': 200 * 1024 * 1024,
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_document_direct_create_is_blocked(self):
        deal = self.create_deal()
        resp = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Blocked',
                'category': 'legal',
                'file_type': 'pdf',
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(Document.objects.filter(document_name='Blocked').exists())

    def test_document_details_rejects_sensitive_identifiers(self):
        deal = self.create_deal()
        document = self._create_ready_document(deal, 'Sensitive details doc', 'legal')
        resp = self.client.patch(
            f'/api/documents/{document.pk}/',
            {'details': {'notes': ['Sponsor SSN is 123-45-6789']}},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('details', resp.data)

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_non_staff_upload_intent_forces_internal_visibility(self):
        deal = self.create_deal()
        resp = self.client.post(
            '/api/documents/upload-intent/',
            {
                'deal': str(deal.pk),
                'document_name': 'Investor only memo',
                'category': 'investor_docs',
                'file_type': 'pdf',
                'file_size_bytes': 128,
                'visibility_roles': ['investor'],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        document = Document.objects.get(pk=resp.data['document']['id'])
        self.assertIn('internal', document.visibility_roles)
        # The non-staff analyst can still reach their own doc via complete/blob.
        self.assertEqual(document.visibility_roles, ['investor', 'internal'])

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_cleanup_stale_pending_documents_sweeps_old_rows_and_blobs(self):
        from datetime import timedelta
        from django.utils import timezone
        from api.tasks import cleanup_stale_pending_documents
        from api.services.storage import get_document_storage

        deal = self.create_deal()
        stale = Document.objects.create(
            deal=deal,
            document_name='Abandoned',
            category='legal',
            version=1,
            file_url='deals/abc/stale/v1/abandoned.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.PENDING,
            uploaded_by=self.user,
        )
        Document.objects.filter(pk=stale.pk).update(
            uploaded_date=timezone.now() - timedelta(hours=48)
        )
        fresh = Document.objects.create(
            deal=deal,
            document_name='Fresh',
            category='legal',
            version=2,
            file_url='deals/abc/fresh/v2/fresh.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.PENDING,
            uploaded_by=self.user,
        )
        storage = get_document_storage()
        storage.write_object(stale.file_url, b'stale', 'application/pdf')
        storage.write_object(fresh.file_url, b'fresh', 'application/pdf')

        deleted = cleanup_stale_pending_documents()

        self.assertEqual(deleted, 1)
        self.assertFalse(Document.objects.filter(pk=stale.pk).exists())
        self.assertTrue(Document.objects.filter(pk=fresh.pk).exists())
        self.assertIsNone(storage.head_object(stale.file_url))
        self.assertIsNotNone(storage.head_object(fresh.file_url))

    def test_activity_logs_are_read_only_via_api(self):
        ActivityLog.objects.create(
            action_type=ActivityActionType.NOTE_ADDED,
            performed_by=self.user,
            description='Visible only to staff',
        )

        list_resp = self.client.get('/api/activity-logs/')
        self.assertEqual(list_resp.status_code, status.HTTP_403_FORBIDDEN)

        resp = self.client.post(
            '/api/activity-logs/',
            {
                'action_type': 'note_added',
                'description': 'Should not be client-created',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(self.staff_user)
        staff_list = self.client.get('/api/activity-logs/')
        self.assertEqual(staff_list.status_code, status.HTTP_200_OK)
        self.assertEqual(response_results(staff_list)[0]['description'], 'Visible only to staff')

        resp = self.client.post(
            '/api/activity-logs/',
            {
                'action_type': 'note_added',
                'description': 'Should not be client-created',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_activity_logs_have_deterministic_ordering(self):
        deal = self.create_deal()
        older = ActivityLog.objects.create(
            deal=deal,
            action_type=ActivityActionType.NOTE_ADDED,
            performed_by=self.user,
            description='Older note',
        )
        newer = ActivityLog.objects.create(
            deal=deal,
            action_type=ActivityActionType.NOTE_ADDED,
            performed_by=self.user,
            description='Newer note',
        )
        ActivityLog.objects.filter(pk__in=[older.pk, newer.pk]).update(performed_at=older.performed_at)

        ordered = list(ActivityLog.objects.filter(pk__in=[older.pk, newer.pk]))

        self.assertEqual(ordered, sorted(ordered, key=lambda log: (log.performed_at, log.pk), reverse=True))

    def test_deal_property_endpoint_promotes_first_property_and_rejects_second_primary(self):
        deal = self.create_deal()
        second_property = Property.objects.create(
            address='321 Secondary St',
            city='Los Angeles',
            state='CA',
            zip='90002',
            address_normalized=normalize_address('321 Secondary St', 'Los Angeles', 'CA', '90002'),
            property_type='retail',
        )

        first = self.client.post(
            '/api/deal-properties/',
            {'deal': str(deal.pk), 'property': str(self.property.pk), 'is_primary': False},
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertTrue(deal.deal_properties.get(property=self.property).is_primary)

        second_primary = self.client.post(
            '/api/deal-properties/',
            {'deal': str(deal.pk), 'property': str(second_property.pk), 'is_primary': True},
            format='json',
        )
        self.assertEqual(second_primary.status_code, status.HTTP_400_BAD_REQUEST)

        second_non_primary = self.client.post(
            '/api/deal-properties/',
            {'deal': str(deal.pk), 'property': str(second_property.pk), 'is_primary': False},
            format='json',
        )
        self.assertEqual(second_non_primary.status_code, status.HTTP_201_CREATED)
        self.assertEqual(deal.deal_properties.filter(is_primary=True).count(), 1)

        third_property = Property.objects.create(
            address='654 Third St',
            city='Los Angeles',
            state='CA',
            zip='90003',
            address_normalized=normalize_address('654 Third St', 'Los Angeles', 'CA', '90003'),
            property_type='industrial',
        )
        reassign_link = self.client.patch(
            f'/api/deal-properties/{second_non_primary.data["id"]}/',
            {'property': str(third_property.pk)},
            format='json',
        )
        self.assertEqual(reassign_link.status_code, status.HTTP_400_BAD_REQUEST)

        primary_link = deal.deal_properties.get(property=self.property)
        demote = self.client.patch(
            f'/api/deal-properties/{primary_link.pk}/',
            {'is_primary': False},
            format='json',
        )
        self.assertEqual(demote.status_code, status.HTTP_400_BAD_REQUEST)

        delete_primary = self.client.delete(f'/api/deal-properties/{primary_link.pk}/')
        self.assertEqual(delete_primary.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(deal.deal_properties.filter(is_primary=True).count(), 1)
        self.assertTrue(deal.deal_properties.get(property=second_property).is_primary)

    def test_list_endpoints_are_paginated(self):
        self.create_deal()
        resp = self.client.get('/api/sponsors/')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['count'], 1)
        self.assertIn('results', resp.data)
        self.assertEqual(resp.data['results'][0]['entity_name'], 'Acme Sponsor LLC')

    def test_deal_summary_counts_active_deals_and_requested_amount(self):
        live_deal = self.create_deal()
        dead_deal = Deal.objects.create(
            name='Dead Deal',
            investment_type='preferred_equity',
            sponsor=self.sponsor,
            assigned_analyst=self.user,
            source_channel='referral',
            requested_amount='500000.00',
        )
        self.client.post(
            f'/api/deals/{dead_deal.pk}/transition/',
            {'to_status': 'dead', 'reason': 'Sponsor withdrew'},
            format='json',
        )

        resp = self.client.get('/api/deals/summary/')

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['active_deals'], 1)
        self.assertEqual(str(resp.data['pipeline_value']), '2500000')
        self.assertEqual(str(resp.data['gross_pipeline_value']), '3000000')
        self.assertEqual(
            {row['pipeline_status']: row['count'] for row in resp.data['by_pipeline_status']},
            {'dead': 1, 'sourced': 1},
        )
        self.assertEqual(live_deal.investment_category, 'debt')
        self.assertEqual(dead_deal.investment_category, 'hybrid')

    def test_supporting_entity_endpoints_create_and_filter(self):
        broker = self.client.post(
            '/api/brokers/',
            {
                'company_name': 'Metro Capital Markets',
                'contact_name': 'Blair Broker',
                'email': 'blair@example.com',
                'phone': '555-222-3333',
                'status': 'active',
                'details': {'relationship_source': 'referral'},
            },
            format='json',
        )
        self.assertEqual(broker.status_code, status.HTTP_201_CREATED)

        fund = self.client.post(
            '/api/funds/',
            {'name': 'MRJ Capital Fund I', 'status': 'forming', 'details': {'vintage': 2026}},
            format='json',
        )
        self.assertEqual(fund.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(self.staff_user)
        sponsor_search = self.client.get('/api/sponsors/?search=Acme')
        broker_filter = self.client.get('/api/brokers/?status=active')
        fund_filter = self.client.get('/api/funds/?status=forming')

        self.assertEqual(sponsor_search.status_code, status.HTTP_200_OK)
        self.assertEqual(response_results(sponsor_search)[0]['entity_name'], 'Acme Sponsor LLC')
        self.assertEqual(broker_filter.status_code, status.HTTP_200_OK)
        self.assertEqual(response_results(broker_filter)[0]['company_name'], 'Metro Capital Markets')
        self.assertEqual(fund_filter.status_code, status.HTTP_200_OK)
        self.assertEqual(response_results(fund_filter)[0]['name'], 'MRJ Capital Fund I')


class DealNoteModelTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('note_author', password='pw')
        self.deal = Deal.objects.create(
            name='Note Model Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.user,
        )

    def test_note_is_deleted_when_its_deal_is_deleted(self):
        DealNote.objects.create(deal=self.deal, author=self.user, body='hello')
        self.assertEqual(DealNote.objects.count(), 1)
        self.deal.delete()
        self.assertEqual(DealNote.objects.count(), 0)

    def test_note_accepts_same_deal_document_attachment(self):
        doc = Document.objects.create(
            id=uuid.uuid4(),
            deal=self.deal,
            document_name='OM',
            category='offering_memo',
            file_url='deals/x/om.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.READY,
            uploaded_by=self.user,
            visibility_roles=['internal'],
        )
        note = DealNote.objects.create(deal=self.deal, author=self.user, body='see OM')
        note.attachments.add(doc)
        self.assertEqual(list(note.attachments.all()), [doc])
        self.assertEqual(list(doc.deal_notes.all()), [note])


class DealNoteServiceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('svc_staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Service Note Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.user,
        )

    def test_create_note_writes_note_and_activity_log(self):
        from api.services.notes import create_note

        note = create_note(
            deal=self.deal,
            author=self.user,
            body='Needs updated appraisal before quoting.',
            attachments=[],
            visibility_roles=None,
            ip_address='203.0.113.5',
        )

        self.assertEqual(note.visibility_roles, ['internal'])
        log = ActivityLog.objects.get(action_type=ActivityActionType.NOTE_ADDED)
        self.assertEqual(log.deal, self.deal)
        self.assertEqual(log.performed_by, self.user)
        self.assertEqual(log.ip_address, '203.0.113.5')
        self.assertEqual(log.metadata['subject_model'], 'deal_note')
        self.assertEqual(log.metadata['subject_id'], str(note.id))

    def test_create_note_is_atomic_when_logging_fails(self):
        from unittest.mock import patch

        from api.services.notes import create_note

        with patch('api.services.notes.log_note_added', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                create_note(
                    deal=self.deal,
                    author=self.user,
                    body='rolls back',
                    attachments=[],
                    visibility_roles=None,
                    ip_address=None,
                )
        self.assertEqual(DealNote.objects.count(), 0)
        self.assertEqual(ActivityLog.objects.filter(action_type=ActivityActionType.NOTE_ADDED).count(), 0)


class DealNoteApiTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('note_analyst', password='pw')
        self.staff = User.objects.create_user('note_staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Notes API Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.analyst,
        )
        self.other_deal = Deal.objects.create(
            name='Other Notes Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='500000.00',
            assigned_analyst=self.analyst,
        )

    def _ready_doc(self, deal):
        return Document.objects.create(
            id=uuid.uuid4(),
            deal=deal,
            document_name='OM',
            category='offering_memo',
            file_url=f'deals/{deal.pk}/om.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.READY,
            uploaded_by=self.staff,
            visibility_roles=['internal'],
        )

    def test_staff_creates_note_sets_author_and_logs_activity(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.post(
            '/api/deal-notes/',
            {'deal': str(self.deal.pk), 'body': 'Call sponsor Monday.'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['author'], self.staff.pk)
        self.assertEqual(resp.data['visibility_roles'], ['internal'])
        log = ActivityLog.objects.get(action_type=ActivityActionType.NOTE_ADDED)
        self.assertEqual(log.metadata['subject_id'], resp.data['id'])

    def test_non_staff_cannot_create_or_list_notes(self):
        self.client.force_authenticate(self.analyst)
        create = self.client.post(
            '/api/deal-notes/',
            {'deal': str(self.deal.pk), 'body': 'blocked'},
            format='json',
        )
        self.assertEqual(create.status_code, status.HTTP_403_FORBIDDEN)
        listing = self.client.get(f'/api/deal-notes/?deal={self.deal.pk}')
        self.assertEqual(listing.status_code, status.HTTP_403_FORBIDDEN)

    def test_notes_are_filtered_by_deal(self):
        DealNote.objects.create(deal=self.deal, author=self.staff, body='keep')
        DealNote.objects.create(deal=self.other_deal, author=self.staff, body='drop')
        self.client.force_authenticate(self.staff)
        resp = self.client.get(f'/api/deal-notes/?deal={self.deal.pk}')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([row['body'] for row in response_results(resp)], ['keep'])

    def test_empty_body_is_rejected(self):
        self.client.force_authenticate(self.staff)
        resp = self.client.post(
            '/api/deal-notes/',
            {'deal': str(self.deal.pk), 'body': '   '},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('body', resp.data)

    def test_cross_deal_attachment_is_rejected(self):
        doc = self._ready_doc(self.other_deal)
        self.client.force_authenticate(self.staff)
        resp = self.client.post(
            '/api/deal-notes/',
            {'deal': str(self.deal.pk), 'body': 'see doc', 'attachments': [str(doc.id)]},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('attachments', resp.data)

    def test_same_deal_attachment_is_accepted(self):
        doc = self._ready_doc(self.deal)
        self.client.force_authenticate(self.staff)
        resp = self.client.post(
            '/api/deal-notes/',
            {'deal': str(self.deal.pk), 'body': 'see doc', 'attachments': [str(doc.id)]},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['attachments'], [str(doc.id)])

    def test_staff_can_edit_body_but_not_deal(self):
        note = DealNote.objects.create(deal=self.deal, author=self.staff, body='draft')
        self.client.force_authenticate(self.staff)
        edit = self.client.patch(
            f'/api/deal-notes/{note.pk}/', {'body': 'final'}, format='json'
        )
        self.assertEqual(edit.status_code, status.HTTP_200_OK)
        self.assertEqual(edit.data['body'], 'final')
        move = self.client.patch(
            f'/api/deal-notes/{note.pk}/', {'deal': str(self.other_deal.pk)}, format='json'
        )
        self.assertEqual(move.status_code, status.HTTP_400_BAD_REQUEST)

    def test_staff_can_delete_note_and_audit_row_remains(self):
        from api.services.notes import log_note_added

        note = DealNote.objects.create(deal=self.deal, author=self.staff, body='temp')
        log_note_added(note, self.staff, None)
        self.client.force_authenticate(self.staff)
        resp = self.client.delete(f'/api/deal-notes/{note.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(DealNote.objects.filter(pk=note.pk).exists())
        self.assertTrue(
            ActivityLog.objects.filter(action_type=ActivityActionType.NOTE_ADDED).exists()
        )


def response_results(response):
    if isinstance(response.data, dict) and 'results' in response.data:
        return response.data['results']
    return response.data
