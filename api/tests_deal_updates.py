from types import SimpleNamespace

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from api.models import ActivityLog, Deal
from api.serializers import DealSerializer


User = get_user_model()


class DealUpdateFreshRowTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('fresh-deal-update', password='pw')
        self.deal = Deal.objects.create(
            name='Original name',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
            description='Original description',
        )

    def _serializer(self, instance, payload):
        serializer = DealSerializer(
            instance,
            data=payload,
            partial=True,
            context={
                'request': SimpleNamespace(user=self.user),
                'audit_ip_address': '203.0.113.30',
            },
        )
        serializer.is_valid(raise_exception=True)
        return serializer

    def test_patch_reloads_locked_row_and_preserves_changes_committed_after_validation(self):
        stale = Deal.objects.get(pk=self.deal.pk)
        serializer = self._serializer(stale, {'name': 'Analyst edit'})

        Deal.objects.filter(pk=self.deal.pk).update(
            pipeline_status='screening',
            requested_amount='2500000.00',
            description='Committed by another workflow',
        )
        updated = serializer.save()

        updated.refresh_from_db()
        self.assertEqual(updated.name, 'Analyst edit')
        self.assertEqual(updated.pipeline_status, 'screening')
        self.assertEqual(updated.requested_amount, 2500000)
        self.assertEqual(updated.description, 'Committed by another workflow')
        log = ActivityLog.objects.get(deal=updated)
        self.assertEqual(log.metadata['field'], 'name')
        self.assertEqual(log.old_value, 'Original name')
        self.assertEqual(log.new_value, 'Analyst edit')

    def test_identical_patch_does_not_write_activity_or_touch_updated_at(self):
        before = self.deal.updated_at
        serializer = self._serializer(self.deal, {'name': self.deal.name})

        updated = serializer.save()

        updated.refresh_from_db()
        self.assertEqual(updated.updated_at, before)
        self.assertFalse(ActivityLog.objects.filter(deal=updated).exists())
