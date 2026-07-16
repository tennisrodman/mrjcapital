from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import ActivityActionType, ActivityLog, Deal, Property, Sponsor


User = get_user_model()


class ReleaseOneIntakeFieldTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('intake-analyst', password='pw')
        self.client.force_authenticate(self.user)

    def test_new_and_changed_investment_types_are_debt_only_but_legacy_records_remain_readable(self):
        rejected_create = self.client.post(
            '/api/deals/',
            {
                'name': 'Unsupported Equity Intake',
                'investment_type': 'preferred_equity',
                'source_channel': 'direct',
                'requested_amount': '1000000.00',
            },
            format='json',
        )
        self.assertEqual(rejected_create.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('investment_type', rejected_create.data)

        debt_deal = Deal.objects.create(
            name='Debt Intake',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.user,
        )
        rejected_change = self.client.patch(
            f'/api/deals/{debt_deal.pk}/',
            {'investment_type': 'mezzanine'},
            format='json',
        )
        self.assertEqual(rejected_change.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('investment_type', rejected_change.data)

        legacy_deal = Deal.objects.create(
            name='Legacy Equity Record',
            investment_type='preferred_equity',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.user,
        )
        readable = self.client.get(f'/api/deals/{legacy_deal.pk}/')
        self.assertEqual(readable.status_code, status.HTTP_200_OK)
        self.assertEqual(readable.data['investment_type'], 'preferred_equity')

    def test_nested_create_persists_promoted_deal_sponsor_and_property_fields(self):
        response = self.client.post(
            '/api/deals/',
            {
                'name': 'Value Add Intake',
                'investment_type': 'whole_loan_bridge',
                'source_channel': 'direct',
                'requested_amount': '7500000.00',
                'purpose': 'acquisition',
                'profile': 'value_add',
                'estimated_value': '10000000.00',
                'renovation_budget': '1250000.00',
                'description': 'Bridge loan for unit renovations and lease-up.',
                'sponsor': {
                    'entity_name': 'Release One Sponsor LLC',
                    'entity_type': 'llc',
                    'primary_contact_name': 'Jordan Lee',
                    'primary_contact_email': 'jordan@example.com',
                    'relationship_rating': 'new',
                    'website': 'https://example.com',
                    'years_experience': 12,
                    'completed_projects': 18,
                    'bankruptcy_history': False,
                },
                'properties': [{
                    'address': '400 Release Way',
                    'city': 'Austin',
                    'state': 'tx',
                    'zip': '78701',
                    'property_type': 'multifamily',
                    'subtype': 'Garden apartments',
                    'units': 120,
                    'rentable_square_feet': 108000,
                    'year_built': 1998,
                    'year_renovated': 2018,
                    'county': 'Travis',
                    'msa': 'Austin-Round Rock',
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        deal = Deal.objects.get(pk=response.data['id'])
        self.assertEqual(deal.purpose, 'acquisition')
        self.assertEqual(deal.profile, 'value_add')
        self.assertEqual(str(deal.estimated_value), '10000000.00')
        self.assertEqual(str(deal.renovation_budget), '1250000.00')
        self.assertEqual(deal.description, 'Bridge loan for unit renovations and lease-up.')

        sponsor = Sponsor.objects.get(pk=deal.sponsor_id)
        self.assertEqual(sponsor.website, 'https://example.com')
        self.assertEqual(sponsor.years_experience, 12)
        self.assertEqual(sponsor.completed_projects, 18)
        self.assertIs(sponsor.bankruptcy_history, False)

        property_obj = Property.objects.get(deal_properties__deal=deal)
        self.assertEqual(property_obj.subtype, 'Garden apartments')
        self.assertEqual(property_obj.units, 120)
        self.assertEqual(property_obj.rentable_square_feet, 108000)
        self.assertEqual(property_obj.year_built, 1998)
        self.assertEqual(property_obj.year_renovated, 2018)
        self.assertEqual(property_obj.county, 'Travis')
        self.assertEqual(property_obj.state, 'TX')

        self.assertEqual(response.data['purpose'], deal.purpose)
        self.assertEqual(response.data['sponsor_detail']['years_experience'], 12)
        self.assertEqual(response.data['properties'][0]['property']['units'], 120)

    def test_deal_fields_remain_optional_and_updates_are_audited(self):
        deal = Deal.objects.create(
            name='Sparse Intake',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.user,
        )

        response = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {
                'purpose': 'refinance',
                'profile': 'stabilized',
                'estimated_value': '2000000.00',
                'renovation_budget': '100000.00',
                'description': 'Updated intake narrative.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        deal.refresh_from_db()
        self.assertEqual(deal.purpose, 'refinance')
        logged_fields = set(
            ActivityLog.objects.filter(
                deal=deal,
                action_type=ActivityActionType.FIELD_UPDATED,
            ).values_list('metadata__field', flat=True)
        )
        self.assertEqual(logged_fields, {
            'purpose',
            'profile',
            'estimated_value',
            'renovation_budget',
            'description',
        })

    def test_invalid_money_and_property_year_order_are_rejected(self):
        invalid_money = self.client.post(
            '/api/deals/',
            {
                'name': 'Invalid Money',
                'investment_type': 'whole_loan_bridge',
                'source_channel': 'direct',
                'requested_amount': '1000000.00',
                'estimated_value': '-1.00',
            },
            format='json',
        )
        self.assertEqual(invalid_money.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('estimated_value', invalid_money.data)

        invalid_property = self.client.post(
            '/api/deals/',
            {
                'name': 'Invalid Property Years',
                'investment_type': 'whole_loan_bridge',
                'source_channel': 'direct',
                'requested_amount': '1000000.00',
                'properties': [{
                    'address': '401 Release Way',
                    'city': 'Austin',
                    'state': 'TX',
                    'zip': '78701',
                    'property_type': 'multifamily',
                    'year_built': 2005,
                    'year_renovated': 2000,
                }],
            },
            format='json',
        )
        self.assertEqual(invalid_property.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('properties', invalid_property.data)

    def test_long_description_suffix_changes_are_still_audited_with_safe_excerpts(self):
        common_prefix = 'A' * 600
        deal = Deal.objects.create(
            name='Long Narrative',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.user,
            description=f'{common_prefix} first ending',
        )

        response = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'description': f'{common_prefix} second ending'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        log = ActivityLog.objects.get(
            deal=deal,
            action_type=ActivityActionType.FIELD_UPDATED,
            metadata__field='description',
        )
        self.assertEqual(len(log.old_value), 500)
        self.assertEqual(len(log.new_value), 500)
        self.assertTrue(log.old_value.endswith('...'))
        self.assertTrue(log.new_value.endswith('...'))

    def test_release_one_numeric_invariants_are_database_enforced(self):
        deal_fields = {
            'name': 'Invalid Direct Deal',
            'investment_type': 'whole_loan_bridge',
            'source_channel': 'direct',
            'requested_amount': '1000000.00',
        }
        with self.assertRaises(IntegrityError), transaction.atomic():
            Deal.objects.create(**deal_fields, estimated_value='-1.00')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Deal.objects.create(**deal_fields, renovation_budget='-1.00')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Sponsor.objects.create(
                entity_name='Invalid Experience LLC',
                entity_type='llc',
                primary_contact_name='Test',
                primary_contact_email='test@example.com',
                years_experience=201,
            )
        with self.assertRaises(IntegrityError), transaction.atomic():
            Property.objects.create(
                address='402 Release Way',
                address_normalized='402 release way austin tx 78701',
                city='Austin',
                state='TX',
                zip='78701',
                property_type='multifamily',
                year_built=2005,
                year_renovated=2000,
            )
