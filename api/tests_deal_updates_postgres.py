import threading
import unittest
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection
from django.test import TransactionTestCase

from api.models import Deal
from api.serializers import DealSerializer


User = get_user_model()


@unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL')
class DealUpdatePostgresContractTests(TransactionTestCase):
    reset_sequences = True

    def test_other_connection_commit_between_validation_and_save_is_preserved(self):
        user = User.objects.create_user('pg-fresh-deal-update', password='pw')
        deal = Deal.objects.create(
            name='Original name',
            investment_type='whole_loan_bridge',
            assigned_analyst=user,
            source_channel='direct',
            requested_amount='1000000.00',
        )
        serializer = DealSerializer(
            Deal.objects.get(pk=deal.pk),
            data={'name': 'Validated edit'},
            partial=True,
            context={'request': SimpleNamespace(user=user)},
        )
        serializer.is_valid(raise_exception=True)
        errors = []

        def commit_other_workflow():
            close_old_connections()
            try:
                Deal.objects.filter(pk=deal.pk).update(
                    pipeline_status='screening',
                    requested_amount='3000000.00',
                )
            except Exception as exc:  # pragma: no cover - surfaced in assertion
                errors.append(exc)
            finally:
                close_old_connections()

        worker = threading.Thread(target=commit_other_workflow)
        worker.start()
        worker.join(timeout=10)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])

        serializer.save()
        deal.refresh_from_db()
        self.assertEqual(deal.name, 'Validated edit')
        self.assertEqual(deal.pipeline_status, 'screening')
        self.assertEqual(deal.requested_amount, 3000000)
