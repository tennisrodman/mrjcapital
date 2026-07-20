"""Optional PostgreSQL contract checks for money aggregate formatting.

The hermetic suite uses SQLite. Run this module against the development
PostgreSQL database to confirm the same string contract:

    DJANGO_SETTINGS_MODULE=mrj.settings.development \\
      ./.venv/bin/python -m pytest api/tests_postgres_contract.py -q
"""

import unittest
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models import Deal, PipelineStatus, Sponsor
from api.services.money import format_money_aggregate


User = get_user_model()


@unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL')
class PostgresMoneyAggregateContractTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('pg-contract', password='pw', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.sponsor = Sponsor.objects.create(
            entity_name='PG Contract Sponsor',
            entity_type='llc',
            primary_contact_name='Pat',
            primary_contact_email='pg@example.com',
            relationship_rating='new',
        )
        Deal.objects.create(
            name='PG Active',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            sponsor=self.sponsor,
            source_channel='direct',
            requested_amount=Decimal('2500000.00'),
            pipeline_status=PipelineStatus.SOURCED,
        )
        Deal.objects.create(
            name='PG Dead',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            sponsor=self.sponsor,
            source_channel='direct',
            requested_amount=Decimal('500000.00'),
            pipeline_status=PipelineStatus.DEAD,
        )

    def test_summary_money_fields_use_two_decimal_strings(self):
        self.assertEqual(format_money_aggregate(Decimal('3000000')), '3000000.00')
        response = self.client.get('/api/deals/summary/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pipeline_value'], '2500000.00')
        self.assertEqual(response.data['gross_pipeline_value'], '3000000.00')
        for row in response.data['by_pipeline_status']:
            self.assertRegex(str(row['requested_amount']), r'^\d+\.\d{2}$')
