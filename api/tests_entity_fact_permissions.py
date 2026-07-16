import json
import uuid

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import (
    ActivityActionType,
    ActivityLog,
    Broker,
    Deal,
    DealProperty,
    Fund,
    Property,
    Sponsor,
)
from api.services import normalize_address


User = get_user_model()


class PromotedEntityFactPermissionTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('fact-analyst', password='pw')
        self.other_analyst = User.objects.create_user('fact-other', password='pw')
        self.staff = User.objects.create_user('fact-staff', password='pw', is_staff=True)
        self.sponsor = Sponsor.objects.create(
            entity_name='Exclusive Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Avery Sponsor',
            primary_contact_email='avery@example.com',
            relationship_rating='developing',
            website='https://old.example.com',
            years_experience=8,
            completed_projects=4,
            bankruptcy_history=None,
            ein='12-3456789',
        )
        self.property = Property.objects.create(
            address='100 Main St',
            city='Los Angeles',
            state='CA',
            zip='90001',
            address_normalized=normalize_address('100 Main St', 'Los Angeles', 'CA', '90001'),
            property_type='multifamily',
            subtype='Garden style',
            units=24,
            rentable_square_feet=18000,
            year_built=1980,
            year_renovated=2015,
            county='Los Angeles',
        )
        self.deal = self._deal('Exclusive Deal', self.analyst, self.sponsor, self.property)
        self.client.force_authenticate(self.analyst)

    def _deal(self, name, analyst, sponsor, property_obj):
        deal = Deal.objects.create(
            name=name,
            investment_type='whole_loan_bridge',
            assigned_analyst=analyst,
            sponsor=sponsor,
            source_channel='direct',
            requested_amount='1000000.00',
        )
        DealProperty.objects.create(deal=deal, property=property_obj, is_primary=True)
        return deal

    def test_exclusive_analyst_can_update_promoted_facts_and_each_change_is_audited(self):
        sponsor_response = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {
                'website': 'https://new.example.com',
                'years_experience': None,
                'bankruptcy_history': False,
            },
            format='json',
            REMOTE_ADDR='203.0.113.12',
        )
        property_response = self.client.patch(
            f'/api/properties/{self.property.pk}/',
            {'subtype': '', 'units': 0, 'county': 'Orange'},
            format='json',
            REMOTE_ADDR='203.0.113.12',
        )

        self.assertEqual(sponsor_response.status_code, status.HTTP_200_OK)
        self.assertEqual(property_response.status_code, status.HTTP_200_OK)
        logs = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.FIELD_UPDATED,
        )
        self.assertEqual(logs.count(), 2)
        sponsor_log = logs.get(metadata__subject_model='Sponsor')
        self.assertEqual(
            sponsor_log.metadata['fields'],
            ['bankruptcy_history', 'website', 'years_experience'],
        )
        self.assertEqual(json.loads(sponsor_log.old_value)['website'], 'https://old.example.com')
        self.assertEqual(json.loads(sponsor_log.new_value)['website'], 'https://new.example.com')
        self.assertEqual(sponsor_log.metadata['subject_id'], str(self.sponsor.pk))
        self.assertEqual(sponsor_log.performed_by, self.analyst)
        self.assertEqual(sponsor_log.ip_address, '203.0.113.12')
        property_log = logs.get(metadata__subject_model='Property')
        self.assertEqual(property_log.metadata['fields'], ['county', 'subtype', 'units'])
        self.assertEqual(json.loads(property_log.old_value)['units'], 24)
        self.assertEqual(json.loads(property_log.new_value)['units'], 0)

    def test_nonstaff_cannot_mix_identity_or_sensitive_fields_into_fact_patch(self):
        sponsor_response = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {
                'website': 'https://should-not-save.example.com',
                'primary_contact_email': 'changed@example.com',
                'ein': '98-7654321',
            },
            format='json',
        )
        property_response = self.client.patch(
            f'/api/properties/{self.property.pk}/',
            {'subtype': 'Should not save', 'address': '200 Changed St'},
            format='json',
        )

        self.assertEqual(sponsor_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(property_response.status_code, status.HTTP_403_FORBIDDEN)
        self.sponsor.refresh_from_db()
        self.property.refresh_from_db()
        self.assertEqual(self.sponsor.website, 'https://old.example.com')
        self.assertEqual(self.sponsor.primary_contact_email, 'avery@example.com')
        self.assertEqual(self.sponsor.ein, '12-3456789')
        self.assertEqual(self.property.subtype, 'Garden style')
        self.assertEqual(self.property.address, '100 Main St')
        self.assertFalse(ActivityLog.objects.filter(action_type=ActivityActionType.FIELD_UPDATED).exists())

    def test_two_analysts_sharing_an_entity_cannot_update_it_without_staff(self):
        other_deal = self._deal(
            'Shared Deal',
            self.other_analyst,
            self.sponsor,
            self.property,
        )

        sponsor_response = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {'completed_projects': 12},
            format='json',
        )
        property_response = self.client.patch(
            f'/api/properties/{self.property.pk}/',
            {'rentable_square_feet': 25000},
            format='json',
        )

        self.assertEqual(sponsor_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(property_response.status_code, status.HTTP_403_FORBIDDEN)
        self.sponsor.refresh_from_db()
        self.property.refresh_from_db()
        self.assertEqual(self.sponsor.completed_projects, 4)
        self.assertEqual(self.property.rentable_square_feet, 18000)
        self.assertFalse(ActivityLog.objects.filter(deal__in=[self.deal, other_deal]).exists())

    def test_staff_identity_and_fact_updates_are_audited_once_for_every_linked_deal(self):
        other_deal = self._deal(
            'Staff Shared Deal',
            self.other_analyst,
            self.sponsor,
            self.property,
        )
        self.client.force_authenticate(self.staff)

        sponsor_response = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {'primary_contact_email': 'staff-changed@example.com', 'completed_projects': 9},
            format='json',
        )
        property_response = self.client.patch(
            f'/api/properties/{self.property.pk}/',
            {'property_type': 'office', 'county': 'Ventura'},
            format='json',
        )

        self.assertEqual(sponsor_response.status_code, status.HTTP_200_OK)
        self.assertEqual(property_response.status_code, status.HTTP_200_OK)
        self.sponsor.refresh_from_db()
        self.property.refresh_from_db()
        self.assertEqual(self.sponsor.primary_contact_email, 'staff-changed@example.com')
        self.assertEqual(self.property.property_type, 'office')
        sponsor_logs = ActivityLog.objects.filter(metadata__subject_model='Sponsor')
        property_logs = ActivityLog.objects.filter(metadata__subject_model='Property')
        self.assertEqual(set(sponsor_logs.values_list('deal_id', flat=True)), {self.deal.pk, other_deal.pk})
        self.assertEqual(set(property_logs.values_list('deal_id', flat=True)), {self.deal.pk, other_deal.pk})
        self.assertEqual(sponsor_logs.count(), 2)
        self.assertEqual(property_logs.count(), 2)
        self.assertEqual(
            sponsor_logs.first().metadata['fields'],
            ['completed_projects', 'primary_contact_email'],
        )
        self.assertEqual(
            property_logs.first().metadata['fields'],
            ['county', 'property_type'],
        )

    def test_sensitive_sponsor_updates_are_redacted_and_no_op_patch_is_not_logged(self):
        self.client.force_authenticate(self.staff)
        secret = '98-7654321'

        changed = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {'ein': secret, 'guarantor_credit_score': '775'},
            format='json',
        )
        no_op = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {'ein': secret, 'guarantor_credit_score': '775'},
            format='json',
        )

        self.assertEqual(changed.status_code, status.HTTP_200_OK)
        self.assertEqual(no_op.status_code, status.HTTP_200_OK)
        logs = ActivityLog.objects.filter(metadata__subject_model='Sponsor')
        self.assertEqual(logs.count(), 1)
        log = logs.get()
        self.assertEqual(log.metadata['fields'], ['ein', 'guarantor_credit_score'])
        self.assertEqual(set(json.loads(log.old_value).values()), {'<redacted>'})
        self.assertEqual(set(json.loads(log.new_value).values()), {'<redacted>'})
        self.assertNotIn(secret, str(log.__dict__))

    def test_staff_update_audits_all_actual_sponsor_and_property_fields(self):
        self.client.force_authenticate(self.staff)
        sponsor_payload = {
            'entity_name': 'Renamed Sponsor LLC',
            'entity_type': 'lp',
            'primary_contact_name': 'Avery Updated',
            'primary_contact_phone': '555-0101',
            'relationship_rating': 'strategic',
            'business_address': '10 Main Plaza',
            'total_units_owned': 1200,
            'total_sf_managed': 500000,
            'assets_under_management': '250000000.00',
            'track_record': [{'name': 'Completed Project'}],
            'connection_source': 'repeat',
            'details': {'segment': 'repeat borrower'},
        }
        property_payload = {
            'address': '101 Main St',
            'city': 'Santa Monica',
            'state': 'ca',
            'zip': '90401',
            'property_type': 'mixed_use',
            'msa': 'Los Angeles-Long Beach',
            'number_of_buildings': 2,
            'number_of_stories': 4,
            'parking_spaces': 80,
            'lot_size_acres': '1.2345',
            'flood_zone': 'X',
            'zoning_designation': 'MU-2',
            'environmental_status': 'phase_1_clean',
            'details': {'source': 'sponsor'},
        }

        sponsor_response = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/', sponsor_payload, format='json'
        )
        property_response = self.client.patch(
            f'/api/properties/{self.property.pk}/', property_payload, format='json'
        )

        self.assertEqual(sponsor_response.status_code, status.HTTP_200_OK)
        self.assertEqual(property_response.status_code, status.HTTP_200_OK)
        sponsor_log = ActivityLog.objects.get(metadata__subject_model='Sponsor')
        property_log = ActivityLog.objects.get(metadata__subject_model='Property')
        self.assertEqual(set(sponsor_log.metadata['fields']), set(sponsor_payload))
        self.assertEqual(
            set(property_log.metadata['fields']),
            {*(property_payload.keys() - {'state'}), 'address_normalized'},
        )
        self.assertEqual(json.loads(sponsor_log.old_value)['details'], '<redacted>')
        self.assertEqual(json.loads(sponsor_log.new_value)['details'], '<redacted>')
        self.assertEqual(json.loads(property_log.old_value)['details'], '<redacted>')
        self.assertEqual(json.loads(property_log.new_value)['details'], '<redacted>')

    def test_flexible_master_details_reject_sensitive_values(self):
        broker = Broker.objects.create(
            company_name='Sensitive Broker',
            contact_name='Broker Contact',
            email='broker-sensitive@example.com',
            status='active',
        )
        fund = Fund.objects.create(name='Sensitive Fund', status='forming')
        self.deal.broker = broker
        self.deal.fund = fund
        self.deal.save(update_fields=['broker', 'fund'])
        self.client.force_authenticate(self.staff)

        for endpoint, object_id in (
            ('properties', self.property.pk),
            ('brokers', broker.pk),
            ('funds', fund.pk),
        ):
            with self.subTest(endpoint=endpoint):
                response = self.client.patch(
                    f'/api/{endpoint}/{object_id}/',
                    {'details': {'tax_id': '12-3456789'}},
                    format='json',
                )
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_nonstaff_cannot_delete_sponsor_or_property_through_generic_endpoints(self):
        sponsor_response = self.client.delete(f'/api/sponsors/{self.sponsor.pk}/')
        property_response = self.client.delete(f'/api/properties/{self.property.pk}/')

        self.assertEqual(sponsor_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(property_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Sponsor.objects.filter(pk=self.sponsor.pk).exists())
        self.assertTrue(Property.objects.filter(pk=self.property.pk).exists())

    def test_pure_nonowner_detail_and_update_are_indistinguishable_from_missing(self):
        other_sponsor = Sponsor.objects.create(
            entity_name='Other Analyst Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Other Sponsor',
            primary_contact_email='other-sponsor@example.com',
            relationship_rating='new',
        )
        other_property = Property.objects.create(
            address='900 Other St',
            city='San Diego',
            state='CA',
            zip='92101',
            address_normalized=normalize_address('900 Other St', 'San Diego', 'CA', '92101'),
            property_type='office',
        )
        self._deal('Other Analyst Only', self.other_analyst, other_sponsor, other_property)
        missing_id = uuid.uuid4()

        for path, payload in [
            ('sponsors', {'website': 'https://hidden.example.com'}),
            ('properties', {'county': 'Hidden'}),
        ]:
            existing_id = other_sponsor.pk if path == 'sponsors' else other_property.pk
            with self.subTest(path=path, method='GET'):
                hidden = self.client.get(f'/api/{path}/{existing_id}/')
                missing = self.client.get(f'/api/{path}/{missing_id}/')
                self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(hidden.data, missing.data)
            with self.subTest(path=path, method='PATCH'):
                hidden = self.client.patch(f'/api/{path}/{existing_id}/', payload, format='json')
                missing = self.client.patch(f'/api/{path}/{missing_id}/', payload, format='json')
                self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(hidden.data, missing.data)

        other_sponsor.refresh_from_db()
        other_property.refresh_from_db()
        self.assertEqual(other_sponsor.website, '')
        self.assertEqual(other_property.county, '')
        self.assertFalse(ActivityLog.objects.filter(
            metadata__subject_id__in=[str(other_sponsor.pk), str(other_property.pk)],
        ).exists())

    def test_staff_delete_allows_unattached_and_blocks_linked_entities(self):
        unattached_sponsor = Sponsor.objects.create(
            entity_name='Unattached Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Unattached Sponsor',
            primary_contact_email='unattached@example.com',
            relationship_rating='new',
        )
        unattached_property = Property.objects.create(
            address='700 Unattached Ave',
            city='Pasadena',
            state='CA',
            zip='91101',
            address_normalized=normalize_address('700 Unattached Ave', 'Pasadena', 'CA', '91101'),
            property_type='retail',
        )
        self.client.force_authenticate(self.staff)

        unattached_sponsor_response = self.client.delete(f'/api/sponsors/{unattached_sponsor.pk}/')
        unattached_property_response = self.client.delete(f'/api/properties/{unattached_property.pk}/')
        linked_sponsor_response = self.client.delete(f'/api/sponsors/{self.sponsor.pk}/')
        linked_property_response = self.client.delete(f'/api/properties/{self.property.pk}/')

        self.assertEqual(unattached_sponsor_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(unattached_property_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(linked_sponsor_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(linked_property_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('linked to one or more deals', linked_sponsor_response.data['detail'])
        self.assertIn('linked to one or more deals', linked_property_response.data['detail'])
        self.assertTrue(Sponsor.objects.filter(pk=self.sponsor.pk).exists())
        self.assertTrue(Property.objects.filter(pk=self.property.pk).exists())
        self.assertTrue(DealProperty.objects.filter(deal=self.deal, property=self.property).exists())

    def test_live_sponsor_urlfield_rejects_intranet_and_accepts_localhost(self):
        invalid = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {'website': 'http://intranet'},
            format='json',
        )
        valid = self.client.patch(
            f'/api/sponsors/{self.sponsor.pk}/',
            {'website': 'http://localhost:8000'},
            format='json',
        )

        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('website', invalid.data)
        self.assertEqual(valid.status_code, status.HTTP_200_OK)
        self.assertEqual(valid.data['website'], 'http://localhost:8000')

    def test_nonstaff_cannot_attach_hidden_related_entities_when_creating_a_deal(self):
        hidden_sponsor = Sponsor.objects.create(
            entity_name='Hidden Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Hidden Sponsor',
            primary_contact_email='hidden-sponsor@example.com',
            relationship_rating='new',
        )
        hidden_broker = Broker.objects.create(
            company_name='Hidden Broker',
            contact_name='Hidden Broker Contact',
            email='hidden-broker@example.com',
        )
        hidden_fund = Fund.objects.create(name='Hidden Fund', status='active')
        self._deal('Other Analyst Deal', self.other_analyst, hidden_sponsor, self.property)
        Deal.objects.filter(name='Other Analyst Deal').update(
            broker=hidden_broker,
            fund=hidden_fund,
        )

        payload = {
            'name': 'Unauthorized Relationship Deal',
            'investment_type': 'whole_loan_bridge',
            'source_channel': 'direct',
            'requested_amount': '1000000.00',
            'properties': [],
        }
        for field_name, entity in {
            'sponsor': hidden_sponsor,
            'broker': hidden_broker,
            'fund': hidden_fund,
        }.items():
            with self.subTest(field=field_name):
                response = self.client.post(
                    '/api/deals/',
                    {**payload, field_name: str(entity.pk)},
                    format='json',
                )

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(response.data[field_name], ['Selected record is not available.'])
                self.assertFalse(Deal.objects.filter(name=payload['name']).exists())

    def test_nonstaff_cannot_attach_hidden_related_entities_via_deal_patch(self):
        hidden_sponsor = Sponsor.objects.create(
            entity_name='Hidden Patch Sponsor LLC',
            entity_type='llc',
            primary_contact_name='Hidden Patch Sponsor',
            primary_contact_email='hidden-patch-sponsor@example.com',
            relationship_rating='new',
        )
        hidden_broker = Broker.objects.create(
            company_name='Hidden Patch Broker',
            contact_name='Hidden Patch Broker Contact',
            email='hidden-patch-broker@example.com',
        )
        hidden_fund = Fund.objects.create(name='Hidden Patch Fund', status='active')
        self._deal('Other Analyst Patch Deal', self.other_analyst, hidden_sponsor, self.property)
        Deal.objects.filter(name='Other Analyst Patch Deal').update(
            broker=hidden_broker,
            fund=hidden_fund,
        )

        empty_deal = Deal.objects.create(
            name='Empty Relationship Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
        )

        for field_name, entity in {
            'sponsor': hidden_sponsor,
            'broker': hidden_broker,
            'fund': hidden_fund,
        }.items():
            with self.subTest(field=field_name):
                response = self.client.patch(
                    f'/api/deals/{empty_deal.pk}/',
                    {field_name: str(entity.pk)},
                    format='json',
                )

                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(response.data[field_name], ['Selected record is not available.'])
                empty_deal.refresh_from_db()
                self.assertIsNone(getattr(empty_deal, f'{field_name}_id'))

    def test_nonstaff_cannot_link_hidden_property_via_deal_properties(self):
        hidden_property = Property.objects.create(
            address='999 Hidden Ave',
            city='Los Angeles',
            state='CA',
            zip='90002',
            address_normalized=normalize_address('999 Hidden Ave', 'Los Angeles', 'CA', '90002'),
            property_type='multifamily',
        )
        self._deal('Other Analyst Property Deal', self.other_analyst, self.sponsor, hidden_property)

        empty_deal = Deal.objects.create(
            name='Property Link Target Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
        )

        response = self.client.post(
            '/api/deal-properties/',
            {
                'deal': str(empty_deal.pk),
                'property': str(hidden_property.pk),
                'is_primary': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['property'], ['Selected property is not available.'])
        self.assertFalse(
            DealProperty.objects.filter(deal=empty_deal, property=hidden_property).exists()
        )


class BrokerFundAuthorizationTests(APITestCase):
    """Align Broker/Fund mutation controls with Sponsor/Property/Contact."""

    def setUp(self):
        self.analyst = User.objects.create_user('bf-analyst', password='pw')
        self.other_analyst = User.objects.create_user('bf-other', password='pw')
        self.staff = User.objects.create_user('bf-staff', password='pw', is_staff=True)
        self.broker = Broker.objects.create(
            company_name='Exclusive Broker',
            contact_name='Blair Broker',
            email='blair@example.com',
            phone='555-0100',
            status='active',
        )
        self.fund = Fund.objects.create(name='Exclusive Fund', status='forming')
        self.deal = Deal.objects.create(
            name='Exclusive Broker Fund Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            broker=self.broker,
            fund=self.fund,
            source_channel='broker',
            requested_amount='1500000.00',
        )
        self.client.force_authenticate(self.analyst)

    def test_exclusive_analyst_can_update_broker_and_fund(self):
        broker_response = self.client.patch(
            f'/api/brokers/{self.broker.pk}/',
            {'phone': '555-0199', 'contact_name': 'Blair Updated'},
            format='json',
        )
        fund_response = self.client.patch(
            f'/api/funds/{self.fund.pk}/',
            {'name': 'Exclusive Fund Renamed', 'status': 'open'},
            format='json',
        )

        self.assertEqual(broker_response.status_code, status.HTTP_200_OK)
        self.assertEqual(fund_response.status_code, status.HTTP_200_OK)
        self.broker.refresh_from_db()
        self.fund.refresh_from_db()
        self.assertEqual(self.broker.phone, '555-0199')
        self.assertEqual(self.broker.contact_name, 'Blair Updated')
        self.assertEqual(self.fund.name, 'Exclusive Fund Renamed')
        self.assertEqual(self.fund.status, 'open')
        broker_log = ActivityLog.objects.get(metadata__subject_model='Broker')
        fund_log = ActivityLog.objects.get(metadata__subject_model='Fund')
        self.assertEqual(broker_log.deal, self.deal)
        self.assertEqual(broker_log.metadata['fields'], ['contact_name', 'phone'])
        self.assertEqual(fund_log.deal, self.deal)
        self.assertEqual(fund_log.metadata['fields'], ['name', 'status'])

        self.client.patch(
            f'/api/brokers/{self.broker.pk}/',
            {'phone': '555-0199', 'contact_name': 'Blair Updated'},
            format='json',
        )
        self.client.patch(
            f'/api/funds/{self.fund.pk}/',
            {'name': 'Exclusive Fund Renamed', 'status': 'open'},
            format='json',
        )
        self.assertEqual(ActivityLog.objects.filter(metadata__subject_model='Broker').count(), 1)
        self.assertEqual(ActivityLog.objects.filter(metadata__subject_model='Fund').count(), 1)

    def test_shared_broker_and_fund_cannot_be_updated_by_nonstaff(self):
        Deal.objects.create(
            name='Shared Broker Fund Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.other_analyst,
            broker=self.broker,
            fund=self.fund,
            source_channel='broker',
            requested_amount='2000000.00',
        )

        broker_response = self.client.patch(
            f'/api/brokers/{self.broker.pk}/',
            {'phone': '555-9999'},
            format='json',
        )
        fund_response = self.client.patch(
            f'/api/funds/{self.fund.pk}/',
            {'name': 'Should Not Rename'},
            format='json',
        )

        self.assertEqual(broker_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(fund_response.status_code, status.HTTP_403_FORBIDDEN)
        self.broker.refresh_from_db()
        self.fund.refresh_from_db()
        self.assertEqual(self.broker.phone, '555-0100')
        self.assertEqual(self.fund.name, 'Exclusive Fund')

    def test_staff_can_update_shared_broker_and_fund(self):
        Deal.objects.create(
            name='Staff Shared Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.other_analyst,
            broker=self.broker,
            fund=self.fund,
            source_channel='broker',
            requested_amount='2000000.00',
        )
        self.client.force_authenticate(self.staff)

        broker_response = self.client.patch(
            f'/api/brokers/{self.broker.pk}/',
            {'status': 'inactive'},
            format='json',
        )
        fund_response = self.client.patch(
            f'/api/funds/{self.fund.pk}/',
            {'status': 'closed'},
            format='json',
        )

        self.assertEqual(broker_response.status_code, status.HTTP_200_OK)
        self.assertEqual(fund_response.status_code, status.HTTP_200_OK)
        self.broker.refresh_from_db()
        self.fund.refresh_from_db()
        self.assertEqual(self.broker.status, 'inactive')
        self.assertEqual(self.fund.status, 'closed')
        self.assertEqual(
            set(ActivityLog.objects.filter(
                metadata__subject_model='Broker',
            ).values_list('deal_id', flat=True)),
            {self.deal.pk, Deal.objects.get(name='Staff Shared Deal').pk},
        )
        self.assertEqual(
            set(ActivityLog.objects.filter(
                metadata__subject_model='Fund',
            ).values_list('deal_id', flat=True)),
            {self.deal.pk, Deal.objects.get(name='Staff Shared Deal').pk},
        )

    def test_nonstaff_cannot_delete_broker_or_fund(self):
        broker_response = self.client.delete(f'/api/brokers/{self.broker.pk}/')
        fund_response = self.client.delete(f'/api/funds/{self.fund.pk}/')

        self.assertEqual(broker_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(fund_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Broker.objects.filter(pk=self.broker.pk).exists())
        self.assertTrue(Fund.objects.filter(pk=self.fund.pk).exists())
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.broker_id, self.broker.pk)
        self.assertEqual(self.deal.fund_id, self.fund.pk)

    def test_staff_delete_allows_unattached_and_blocks_linked_broker_and_fund(self):
        unattached_broker = Broker.objects.create(
            company_name='Unattached Broker',
            contact_name='Una Broker',
            email='una@example.com',
        )
        unattached_fund = Fund.objects.create(name='Unattached Fund', status='forming')
        self.client.force_authenticate(self.staff)

        unattached_broker_response = self.client.delete(f'/api/brokers/{unattached_broker.pk}/')
        unattached_fund_response = self.client.delete(f'/api/funds/{unattached_fund.pk}/')
        linked_broker_response = self.client.delete(f'/api/brokers/{self.broker.pk}/')
        linked_fund_response = self.client.delete(f'/api/funds/{self.fund.pk}/')

        self.assertEqual(unattached_broker_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(unattached_fund_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(linked_broker_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(linked_fund_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('linked to one or more deals', linked_broker_response.data['detail'])
        self.assertIn('linked to one or more deals', linked_fund_response.data['detail'])
        self.assertTrue(Broker.objects.filter(pk=self.broker.pk).exists())
        self.assertTrue(Fund.objects.filter(pk=self.fund.pk).exists())
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.broker_id, self.broker.pk)
        self.assertEqual(self.deal.fund_id, self.fund.pk)

    def test_pure_nonowner_broker_fund_detail_and_update_match_missing(self):
        other_broker = Broker.objects.create(
            company_name='Other Analyst Broker',
            contact_name='Other Broker',
            email='other-broker@example.com',
        )
        other_fund = Fund.objects.create(name='Other Analyst Fund', status='forming')
        Deal.objects.create(
            name='Other Analyst Only Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.other_analyst,
            broker=other_broker,
            fund=other_fund,
            source_channel='broker',
            requested_amount='900000.00',
        )
        missing_id = uuid.uuid4()

        for path, payload, entity_pk in [
            ('brokers', {'phone': '555-0000'}, other_broker.pk),
            ('funds', {'name': 'Hidden Rename'}, other_fund.pk),
        ]:
            with self.subTest(path=path, method='GET'):
                hidden = self.client.get(f'/api/{path}/{entity_pk}/')
                missing = self.client.get(f'/api/{path}/{missing_id}/')
                self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(hidden.data, missing.data)
            with self.subTest(path=path, method='PATCH'):
                hidden = self.client.patch(f'/api/{path}/{entity_pk}/', payload, format='json')
                missing = self.client.patch(f'/api/{path}/{missing_id}/', payload, format='json')
                self.assertEqual(hidden.status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(hidden.data, missing.data)

        other_broker.refresh_from_db()
        other_fund.refresh_from_db()
        self.assertEqual(other_broker.phone, '')
        self.assertEqual(other_fund.name, 'Other Analyst Fund')
