from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import ActivityActionType, ActivityLog, Deal, DealStageEvent, PipelineStatus
from api.services.deals import initialize_deal_stage_event, transition_pipeline_status


class DealStageHistoryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('stage-analyst', password='pw')
        self.client.force_authenticate(self.user)

    def create_deal(self, **overrides):
        values = {
            'name': 'Stage History Deal',
            'investment_type': 'whole_loan_bridge',
            'assigned_analyst': self.user,
            'source_channel': 'direct',
            'requested_amount': '2500000.00',
        }
        values.update(overrides)
        return Deal.objects.create(**values)

    def test_pipeline_transition_closes_and_opens_stage_events_with_activity_log(self):
        deal = self.create_deal()

        transitioned = transition_pipeline_status(
            deal,
            PipelineStatus.SCREENING,
            self.user,
            'Initial package complete',
        )
        transitioned.refresh_from_db()

        events = list(transitioned.stage_events.order_by('entered_at', 'id'))
        self.assertEqual(len(events), 2)
        initial_event, current_event = events
        self.assertIsNone(initial_event.from_status)
        self.assertEqual(initial_event.to_status, PipelineStatus.SOURCED)
        self.assertEqual(initial_event.exited_at, transitioned.current_stage_entered_at)
        self.assertEqual(current_event.from_status, PipelineStatus.SOURCED)
        self.assertEqual(current_event.to_status, PipelineStatus.SCREENING)
        self.assertEqual(current_event.entered_at, transitioned.current_stage_entered_at)
        self.assertIsNone(current_event.exited_at)
        self.assertEqual(current_event.performed_by, self.user)
        self.assertEqual(current_event.reason, 'Initial package complete')
        self.assertFalse(current_event.is_override)

        response = self.client.get(f'/api/deals/{deal.pk}/stage-history/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['to_status'] for row in response.data['results']], [
            PipelineStatus.SCREENING,
            PipelineStatus.SOURCED,
        ])
        self.assertEqual(response.data['results'][0]['performed_by_detail']['username'], self.user.username)

        log = ActivityLog.objects.get(action_type=ActivityActionType.STATUS_CHANGE)
        self.assertEqual(log.old_value, PipelineStatus.SOURCED)
        self.assertEqual(log.new_value, PipelineStatus.SCREENING)

    def test_failed_status_audit_rolls_back_deal_and_stage_events(self):
        deal = self.create_deal()

        with patch('api.services.deals.ActivityLog.objects.create', side_effect=IntegrityError('audit failed')):
            with self.assertRaises(IntegrityError):
                transition_pipeline_status(
                    deal,
                    PipelineStatus.SCREENING,
                    self.user,
                    'Initial package complete',
                )

        deal.refresh_from_db()
        self.assertEqual(deal.pipeline_status, PipelineStatus.SOURCED)
        self.assertEqual(deal.stage_events.count(), 0)
        self.assertEqual(ActivityLog.objects.filter(deal=deal).count(), 0)

    def test_api_create_initializes_open_stage_event_and_exposes_current_stage_metrics(self):
        response = self.client.post(
            '/api/deals/',
            {
                'name': 'API Stage Event Deal',
                'investment_type': 'whole_loan_bridge',
                'source_channel': 'direct',
                'requested_amount': '1000000.00',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        deal = Deal.objects.get(pk=response.data['id'])
        event = DealStageEvent.objects.get(deal=deal, exited_at__isnull=True)
        self.assertIsNone(event.from_status)
        self.assertEqual(event.to_status, PipelineStatus.SOURCED)
        self.assertEqual(event.entered_at, deal.current_stage_entered_at)
        self.assertEqual(response.data['days_in_current_stage'], 0)
        self.assertIn('current_stage_entered_at', response.data)

    def test_summary_exposes_current_and_completed_stage_timing(self):
        deal = self.create_deal()
        now = timezone.now().replace(microsecond=0)
        initial_event = initialize_deal_stage_event(deal, performed_by=self.user)
        DealStageEvent.objects.filter(pk=initial_event.pk).update(
            entered_at=now - timedelta(days=5),
            exited_at=now - timedelta(days=3),
        )
        DealStageEvent.objects.create(
            deal=deal,
            from_status=PipelineStatus.SOURCED,
            to_status=PipelineStatus.SCREENING,
            entered_at=now - timedelta(days=3),
            performed_by=self.user,
            reason='Fixture transition',
        )
        Deal.objects.filter(pk=deal.pk).update(
            pipeline_status=PipelineStatus.SCREENING,
            current_stage_entered_at=now - timedelta(days=3),
        )

        response = self.client.get('/api/deals/summary/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['average_days_in_current_stage'], 3)
        by_status = {row['pipeline_status']: row for row in response.data['by_pipeline_status']}
        self.assertEqual(by_status[PipelineStatus.SCREENING]['average_days_in_current_stage'], 3)
        self.assertEqual(str(by_status[PipelineStatus.SCREENING]['requested_amount']), '2500000.00')
        durations = {row['pipeline_status']: row for row in response.data['average_stage_duration_days']}
        self.assertEqual(durations[PipelineStatus.SOURCED]['average_days'], 2)
        self.assertEqual(durations[PipelineStatus.SOURCED]['completed_events'], 1)

    def test_summary_stage_age_uses_fractional_days_and_excludes_post_pipeline_deals(self):
        now = timezone.now().replace(microsecond=0)
        active = self.create_deal(
            name='Twenty Hour Active Deal',
            pipeline_status=PipelineStatus.SCREENING,
            current_stage_entered_at=now - timedelta(hours=20),
        )
        self.create_deal(
            name='Old Terminal Deal',
            pipeline_status=PipelineStatus.DEAD,
            current_stage_entered_at=now - timedelta(days=600),
        )

        with patch('api.viewsets.timezone.now', return_value=now):
            response = self.client.get('/api/deals/summary/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['active_deals'], 1)
        self.assertEqual(response.data['average_days_in_current_stage'], 0.83)
        by_status = {row['pipeline_status']: row for row in response.data['by_pipeline_status']}
        self.assertEqual(by_status[PipelineStatus.SCREENING]['average_days_in_current_stage'], 0.83)
        self.assertEqual(by_status[PipelineStatus.DEAD]['average_days_in_current_stage'], 0)
        self.assertEqual(active.pipeline_status, PipelineStatus.SCREENING)

    def test_deal_field_audit_logs_safe_values_without_copying_details(self):
        deal = self.create_deal()
        sensitive_value = '123-45-6789'

        response = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {
                'name': 'Renamed Stage History Deal',
                'requested_amount': '3000000.00',
                'details': {'strategy': 'bridge'},
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        logs = list(
            ActivityLog.objects.filter(deal=deal, action_type=ActivityActionType.FIELD_UPDATED)
            .order_by('metadata__field')
        )
        self.assertEqual({log.metadata['field'] for log in logs}, {'name', 'requested_amount'})
        by_field = {log.metadata['field']: log for log in logs}
        self.assertEqual(by_field['name'].old_value, 'Stage History Deal')
        self.assertEqual(by_field['name'].new_value, 'Renamed Stage History Deal')
        self.assertEqual(by_field['requested_amount'].old_value, '2500000.00')
        self.assertEqual(by_field['requested_amount'].new_value, '3000000.00')
        self.assertTrue(all(sensitive_value not in str(log.metadata) for log in logs))
        self.assertTrue(all(sensitive_value not in log.old_value for log in logs))
        self.assertTrue(all(sensitive_value not in log.new_value for log in logs))

        rejected = self.client.patch(
            f'/api/deals/{deal.pk}/',
            {'details': {'ssn': sensitive_value}},
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        deal.refresh_from_db()
        self.assertNotIn('ssn', deal.details)

    def test_stage_history_prevents_hard_deleting_a_deal(self):
        deal = self.create_deal()
        initialize_deal_stage_event(deal, performed_by=self.user)

        response = self.client.delete(f'/api/deals/{deal.pk}/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Deal.objects.filter(pk=deal.pk).exists())
        self.assertTrue(DealStageEvent.objects.filter(deal=deal).exists())
