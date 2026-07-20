from django.contrib.auth import get_user_model
from django.test import TestCase

from api.models import ActivityActionType, Deal
from api.services.audit import create_activity_log


User = get_user_model()


class ActivityAuditTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('audit-user', password='pw')
        self.deal = Deal.objects.create(
            name='Audit Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
        )

    def test_shared_writer_rejects_blank_timeline_descriptions(self):
        with self.assertRaisesMessage(ValueError, 'Activity log description is required.'):
            create_activity_log(
                deal=self.deal,
                action_type=ActivityActionType.FIELD_UPDATED,
                performed_by=self.user,
                description='   ',
            )

    def test_shared_writer_normalizes_actor_and_description(self):
        event = create_activity_log(
            deal=self.deal,
            action_type=ActivityActionType.FIELD_UPDATED,
            performed_by=self.user,
            description='  Deal field updated  ',
            metadata={'field': 'name'},
        )

        self.assertEqual(event.description, 'Deal field updated')
        self.assertEqual(event.performed_by, self.user)
        self.assertEqual(event.metadata, {'field': 'name'})
