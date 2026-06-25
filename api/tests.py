"""Smoke tests for the MRJ Capital API auth contract."""

import base64
import hashlib
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
from api.models import ActivityActionType, ActivityLog, Broker, Deal, Document, Fund, PipelineStatus, Property, Sponsor
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
                'property_ids': [str(self.property.pk)],
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

    def test_create_deal_requires_properties(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Propertyless Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data['properties'][0], 'Add at least one property.')
        self.assertFalse(Deal.objects.filter(name='Propertyless Deal').exists())

    def test_create_deal_accepts_inline_create_page_payload(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'AR Global Bridge',
                'investment_type': 'whole_loan_bridge',
                'sponsor': {
                    'entity_name': 'AR Global LLC',
                    'entity_type': 'llc',
                    'primary_contact_name': 'Boris Korotkin',
                    'primary_contact_email': 'boris@arglobal.com',
                    'primary_contact_phone': '222-222-2222',
                    'relationship_rating': 'new',
                },
                'broker': {
                    'company_name': 'Origin Capital',
                    'contact_name': 'Olivia Broker',
                    'email': 'olivia@example.com',
                    'phone': '555-333-4444',
                },
                'source_channel': 'direct',
                'source_date': '2026-06-24',
                'requested_amount': '2500000.00',
                'fund': None,
                'properties': [
                    str(self.property.pk),
                    {
                        'address': '456 Oak Ave',
                        'city': 'New York',
                        'state': 'ny',
                        'zip': '10001',
                        'property_type': 'office',
                        'msa': 'New York-Newark-Jersey City',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.select_related('sponsor', 'broker').get(pk=resp.data['id'])
        self.assertEqual(deal.sponsor.entity_name, 'AR Global LLC')
        self.assertEqual(deal.broker.company_name, 'Origin Capital')
        self.assertEqual(deal.assigned_analyst, self.user)
        self.assertEqual(str(resp.data['sponsor']), str(deal.sponsor_id))
        self.assertEqual(resp.data['sponsor_detail']['entity_name'], 'AR Global LLC')
        self.assertEqual(str(resp.data['broker']), str(deal.broker_id))
        self.assertEqual(resp.data['broker_detail']['company_name'], 'Origin Capital')
        self.assertEqual(str(resp.data['properties'][0]['property']['id']), str(self.property.pk))
        self.assertTrue(resp.data['properties'][0]['is_primary'])

        new_property = Property.objects.get(address='456 Oak Ave')
        self.assertEqual(new_property.state, 'NY')
        self.assertEqual(deal.deal_properties.count(), 2)
        self.assertTrue(deal.deal_properties.filter(property=new_property, is_primary=False).exists())

    def test_create_deal_treats_empty_broker_object_as_no_broker(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Direct No Broker Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'broker': {},
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'property_ids': [str(self.property.pk)],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        self.assertIsNone(deal.broker)
        self.assertIsNone(resp.data['broker'])

    def test_create_deal_treats_blank_broker_as_no_broker(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Blank Broker Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'broker': '',
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'property_ids': [str(self.property.pk)],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=resp.data['id'])
        self.assertIsNone(deal.broker)
        self.assertIsNone(resp.data['broker'])

    def test_create_deal_rejects_empty_sponsor_object(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Empty Sponsor Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': {},
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'property_ids': [str(self.property.pk)],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data['sponsor'][0], 'Provide an id or fields to create this relationship.')
        self.assertFalse(Deal.objects.filter(name='Empty Sponsor Deal').exists())

    def test_inline_deal_create_validation_does_not_persist_related_records(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Invalid Inline Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': {
                    'entity_name': 'Should Not Persist LLC',
                    'entity_type': 'llc',
                    'primary_contact_name': 'No Persist',
                    'primary_contact_email': 'nopersist@example.com',
                    'relationship_rating': 'new',
                },
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'properties': [
                    {
                        'city': 'New York',
                        'state': 'NY',
                        'zip': '10001',
                        'property_type': 'office',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('properties', resp.data)
        self.assertFalse(Sponsor.objects.filter(entity_name='Should Not Persist LLC').exists())
        self.assertFalse(Deal.objects.filter(name='Invalid Inline Deal').exists())

    def test_inline_deal_create_rolls_back_related_records_if_linking_conflicts(self):
        with patch(
            'api.serializers.DealProperty.objects.bulk_create',
            side_effect=IntegrityError(
                'UNIQUE constraint failed: api_dealproperty.deal_id, api_dealproperty.property_id',
            ),
        ):
            resp = self.client.post(
                '/api/deals/',
                {
                    'name': 'Rollback Inline Deal',
                    'investment_type': 'whole_loan_bridge',
                    'sponsor': {
                        'entity_name': 'Rollback Sponsor LLC',
                        'entity_type': 'llc',
                        'primary_contact_name': 'Rollback Sponsor',
                        'primary_contact_email': 'rollback@example.com',
                        'relationship_rating': 'new',
                    },
                    'source_channel': 'direct',
                    'requested_amount': '2500000.00',
                    'properties': [str(self.property.pk)],
                },
                format='json',
            )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('properties', resp.data)
        self.assertFalse(Sponsor.objects.filter(entity_name='Rollback Sponsor LLC').exists())
        self.assertFalse(Deal.objects.filter(name='Rollback Inline Deal').exists())

    def test_deal_patch_accepts_unchanged_nested_relationship_ids(self):
        broker = Broker.objects.create(
            company_name='Existing Broker',
            contact_name='Blake Broker',
            email='blake@example.com',
            phone='555-333-4444',
        )
        deal = self.create_deal()
        deal.broker = broker
        deal.save(update_fields=['broker', 'updated_at'])
        deal.deal_properties.create(property=self.property, is_primary=True)

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {
                'name': 'Renamed Deal',
                'sponsor': {'id': str(self.sponsor.pk)},
                'broker': {'id': str(broker.pk)},
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        deal.refresh_from_db()
        self.assertEqual(deal.name, 'Renamed Deal')
        self.assertEqual(deal.sponsor, self.sponsor)
        self.assertEqual(deal.broker, broker)
        self.assertEqual(Sponsor.objects.filter(entity_name=self.sponsor.entity_name).count(), 1)
        self.assertEqual(Broker.objects.filter(company_name=broker.company_name).count(), 1)

    def test_deal_patch_can_detach_fund(self):
        fund = Fund.objects.create(name='MRJ Capital Fund I', status='open')
        deal = self.create_deal()
        deal.fund = fund
        deal.save(update_fields=['fund', 'updated_at'])
        deal.deal_properties.create(property=self.property, is_primary=True)

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'fund': None},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        deal.refresh_from_db()
        self.assertIsNone(deal.fund)
        self.assertIsNone(resp.data['fund'])
        self.assertIsNone(resp.data['fund_detail'])

    def test_deal_patch_rejects_fund_reassignment(self):
        fund = Fund.objects.create(name='MRJ Capital Fund I', status='open')
        other_fund = Fund.objects.create(name='MRJ Capital Fund II', status='open')
        deal = self.create_deal()
        deal.fund = fund
        deal.save(update_fields=['fund', 'updated_at'])
        deal.deal_properties.create(property=self.property, is_primary=True)

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'fund': str(other_fund.pk)},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            resp.data['fund'][0],
            'This relationship cannot be changed through this endpoint.',
        )
        deal.refresh_from_db()
        self.assertEqual(deal.fund, fund)

    def test_deal_patch_rejects_nested_relationship_field_edits(self):
        deal = self.create_deal()
        deal.deal_properties.create(property=self.property, is_primary=True)

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {
                'sponsor': {
                    'id': str(self.sponsor.pk),
                    'entity_name': self.sponsor.entity_name,
                },
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            resp.data['sponsor'][0],
            'Relationship fields cannot be edited through this endpoint; send the id only.',
        )
        deal.refresh_from_db()
        self.assertEqual(deal.sponsor, self.sponsor)

    def test_deal_patch_returns_fresh_properties_after_replacement(self):
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

        resp = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'property_ids': [str(replacement.pk)]},
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data['properties']), 1)
        self.assertEqual(str(resp.data['properties'][0]['property']['id']), str(replacement.pk))
        self.assertTrue(resp.data['properties'][0]['is_primary'])
        self.assertEqual(deal.deal_properties.count(), 1)
        self.assertTrue(deal.deal_properties.filter(property=replacement, is_primary=True).exists())

    def test_deal_create_reports_duplicate_property_request_consistently(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Duplicate Mixed Property Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'properties': [
                    str(self.property.pk),
                    {
                        'address': '123 Main Street',
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
        self.assertEqual(resp.data['properties'][1]['non_field_errors'][0], 'Duplicate property in request.')
        self.assertFalse(Deal.objects.filter(name='Duplicate Mixed Property Deal').exists())

    def test_deal_create_reports_reversed_mixed_duplicate_property_request_consistently(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Reversed Duplicate Mixed Property Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'properties': [
                    {
                        'address': '123 Main Street',
                        'city': 'Los Angeles',
                        'state': 'CA',
                        'zip': '90001',
                        'property_type': 'multifamily',
                    },
                    str(self.property.pk),
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(resp.data['properties'][0]['non_field_errors'][0], 'Duplicate property in request.')
        self.assertFalse(Deal.objects.filter(name='Reversed Duplicate Mixed Property Deal').exists())

    def test_deal_create_rejects_property_id_objects_with_field_edits(self):
        resp = self.client.post(
            '/api/deals/',
            {
                'name': 'Property Edit Payload Deal',
                'investment_type': 'whole_loan_bridge',
                'sponsor': str(self.sponsor.pk),
                'source_channel': 'direct',
                'requested_amount': '2500000.00',
                'properties': [
                    {
                        'id': str(self.property.pk),
                        'address': '999 Changed St',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            resp.data['properties'][0]['non_field_errors'][0],
            'Property fields cannot be edited through this endpoint; send the id only.',
        )
        self.property.refresh_from_db()
        self.assertEqual(self.property.address, '123 Main St')
        self.assertFalse(Deal.objects.filter(name='Property Edit Payload Deal').exists())

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
        self.assertIn('properties', resp.data)
        self.assertEqual(resp.data['properties'][1]['non_field_errors'][0], 'Duplicate property in request.')
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
                'property_ids': [str(self.property.pk)],
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
        self.assertIn('properties', resp.data)
        self.assertEqual(resp.data['properties'][0], 'Add at least one property.')
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

        with patch(
            'api.serializers.DealProperty.objects.bulk_create',
            side_effect=IntegrityError(
                'UNIQUE constraint failed: api_dealproperty.deal_id, api_dealproperty.property_id',
            ),
        ):
            resp = self.client.patch(
                f'/api/deals/{deal.pk}/',
                {'name': 'Changed Deal Name', 'property_ids': [str(replacement.pk)]},
                format='json',
            )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('properties', resp.data)
        deal.refresh_from_db()
        self.assertEqual(deal.name, '123 Main St Bridge')
        self.assertEqual(deal.deal_properties.count(), 1)
        self.assertEqual(deal.deal_properties.get().property, self.property)

    def test_deal_property_replacement_unexpected_integrity_error_is_not_masked(self):
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

    def test_property_create_ignores_client_supplied_address_normalized_for_dedup(self):
        resp = self.client.post(
            '/api/properties/',
            {
                'address': '123 Main Street',
                'city': 'Los Angeles',
                'state': 'CA',
                'zip': '90001',
                'property_type': 'multifamily',
                'address_normalized': 'client supplied bypass value',
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('address_normalized', resp.data)
        self.assertEqual(Property.objects.filter(address='123 Main Street').count(), 0)

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

    def test_document_create_writes_activity_log(self):
        deal = self.create_deal()

        resp = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Offering memo',
                'category': 'offering_memo',
                'version': 1,
                'file_url': 'deals/123/offering-memo.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['internal', 'investor'],
            },
            format='json',
        )

        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        log = ActivityLog.objects.get(action_type=ActivityActionType.DOCUMENT_UPLOAD)
        self.assertEqual(log.deal, deal)
        self.assertEqual(log.performed_by, self.user)
        self.assertEqual(log.metadata['category'], 'offering_memo')

    def test_document_server_controls_version_and_blocks_unsafe_paths_and_deal_changes(self):
        deal = self.create_deal()
        other_deal = Deal.objects.create(
            name='Other Deal',
            investment_type='whole_loan_bridge',
            sponsor=self.sponsor,
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
        )

        unsafe = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Unsafe path',
                'category': 'legal',
                'file_url': '../secrets/legal.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(unsafe.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file_url', unsafe.data)

        first = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Offering memo',
                'category': 'offering_memo',
                'version': 99,
                'file_url': 'deals/123/offering-memo-v1.pdf',
                'file_type': 'pdf',
                'is_executed': True,
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data['version'], 1)
        self.assertFalse(first.data['is_executed'])

        second = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Offering memo',
                'category': 'offering_memo',
                'file_url': 'deals/123/offering-memo-v2.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.data['version'], 2)

        change_deal = self.client.patch(
            f'/api/documents/{first.data["id"]}/',
            {'deal': str(other_deal.pk)},
            format='json',
        )
        self.assertEqual(change_deal.status_code, status.HTTP_400_BAD_REQUEST)

    def test_document_create_rolls_back_if_audit_log_write_fails(self):
        deal = self.create_deal()

        with patch('api.viewsets.ActivityLog.objects.create', side_effect=IntegrityError('audit failed')):
            with self.assertRaises(IntegrityError):
                self.client.post(
                    '/api/documents/',
                    {
                        'deal': str(deal.pk),
                        'document_name': 'Atomic document',
                        'category': 'legal',
                        'file_url': 'deals/123/atomic.pdf',
                        'file_type': 'pdf',
                        'visibility_roles': ['internal'],
                    },
                    format='json',
                )

        self.assertFalse(Document.objects.filter(document_name='Atomic document').exists())

    def test_deal_delete_is_blocked_when_documents_exist(self):
        deal = self.create_deal()
        self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Executed closing package',
                'category': 'closing_docs',
                'version': 1,
                'file_url': 'deals/123/closing.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['internal'],
            },
            format='json',
        )

        resp = self.client.delete(f'/api/deals/{deal.pk}/')

        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Deal.objects.filter(pk=deal.pk).exists())

    def test_document_visibility_roles_are_validated_and_filterable(self):
        deal = self.create_deal()

        invalid = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Bad visibility doc',
                'category': 'legal',
                'version': 1,
                'file_url': 'deals/123/legal.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['public'],
            },
            format='json',
        )
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

        investor_doc = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Investor package',
                'category': 'investor_docs',
                'version': 1,
                'file_url': 'deals/123/investor.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['internal', 'investor'],
            },
            format='json',
        )
        self.assertEqual(investor_doc.status_code, status.HTTP_201_CREATED)
        internal_doc = self.client.post(
            '/api/documents/',
            {
                'deal': str(deal.pk),
                'document_name': 'Internal memo',
                'category': 'legal',
                'version': 1,
                'file_url': 'deals/123/internal.pdf',
                'file_type': 'pdf',
                'visibility_roles': ['internal'],
            },
            format='json',
        )
        self.assertEqual(internal_doc.status_code, status.HTTP_201_CREATED)

        filtered = self.client.get('/api/documents/?visibility_role=investor')
        self.assertEqual(filtered.status_code, status.HTTP_200_OK)
        self.assertEqual(response_results(filtered), [])

        self.client.force_authenticate(self.staff_user)
        staff_filtered = self.client.get('/api/documents/?visibility_role=investor')
        self.assertEqual(staff_filtered.status_code, status.HTTP_200_OK)
        filtered_results = response_results(staff_filtered)
        self.assertEqual(len(filtered_results), 1)
        self.assertEqual(filtered_results[0]['document_name'], 'Investor package')

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


def response_results(response):
    if isinstance(response.data, dict) and 'results' in response.data:
        return response.data['results']
    return response.data
