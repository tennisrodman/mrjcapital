from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import (
    ActivityActionType,
    ActivityLog,
    Deal,
    PipelineStatus,
    ScreeningAssessment,
)
from api.services.deals import (
    SCREENING_APPROVAL_REQUIRED,
    SCREENING_ASSESSMENT_MISSING,
    SCREENING_ASSESSMENT_NOT_FINALIZED,
    SCREENING_DECISION_NOT_ADVANCE,
)


User = get_user_model()


class PipelineReadinessApiTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('readiness-analyst', password='pw')
        self.staff = User.objects.create_user('readiness-staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Readiness Deal',
            investment_type='whole_loan_bridge',
            pipeline_status=PipelineStatus.SCREENING,
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
        )
        self.client.force_authenticate(self.analyst)

    def _assessment(self, *, status_value, decision='', version=1):
        finalized = status_value == ScreeningAssessment.Status.FINALIZED
        return ScreeningAssessment.objects.create(
            deal=self.deal,
            version=version,
            status=status_value,
            decision=decision,
            reviewer=self.analyst if finalized else None,
            finalized_at=timezone.now() if finalized else None,
        )

    def _transition(self, **overrides):
        payload = {
            'to_status': PipelineStatus.QUOTING,
            'reason': 'Move into quoting',
        }
        payload.update(overrides)
        return self.client.post(f'/api/deals/{self.deal.pk}/transition/', payload, format='json')

    def test_allowed_transitions_include_readiness_for_each_legal_target(self):
        response = self.client.get(f'/api/deals/{self.deal.pk}/allowed-transitions/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(set(response.data['readiness']), set(response.data['pipeline_status']))
        self.assertEqual(response.data['readiness'][PipelineStatus.QUOTING], {
            'ready': False,
            'code': SCREENING_APPROVAL_REQUIRED,
            'blockers': [SCREENING_ASSESSMENT_MISSING],
            'can_override': False,
        })
        self.assertEqual(response.data['readiness'][PipelineStatus.ON_HOLD], {
            'ready': True,
            'code': 'ready',
            'blockers': [],
            'can_override': False,
        })

        self.client.force_authenticate(self.staff)
        staff_response = self.client.get(f'/api/deals/{self.deal.pk}/allowed-transitions/')
        self.assertTrue(staff_response.data['readiness'][PipelineStatus.QUOTING]['can_override'])

    def test_missing_screening_assessment_blocks_quoting_without_side_effects(self):
        response = self._transition()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['readiness'], {
            'ready': False,
            'code': SCREENING_APPROVAL_REQUIRED,
            'blockers': [SCREENING_ASSESSMENT_MISSING],
            'can_override': False,
        })
        self.assertIs(type(response.data['readiness']['can_override']), bool)
        self.assertNotIn('readiness_code', response.data)
        self.assertNotIn('readiness_blockers', response.data)
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.pipeline_status, PipelineStatus.SCREENING)
        self.assertFalse(ActivityLog.objects.filter(deal=self.deal).exists())
        self.assertFalse(self.deal.stage_events.exists())

    def test_latest_assessment_must_be_finalized_and_advance(self):
        draft = self._assessment(status_value=ScreeningAssessment.Status.DRAFT)
        draft_response = self._transition()
        self.assertEqual(
            draft_response.data['readiness']['blockers'],
            [SCREENING_ASSESSMENT_NOT_FINALIZED],
        )

        ScreeningAssessment.objects.filter(pk=draft.pk).update(
            status=ScreeningAssessment.Status.FINALIZED,
            decision=ScreeningAssessment.Decision.REFER,
            reviewer=self.analyst,
            finalized_at=timezone.now(),
        )
        refer_response = self._transition()
        self.assertEqual(
            refer_response.data['readiness']['blockers'],
            [SCREENING_DECISION_NOT_ADVANCE],
        )

    def test_newer_draft_blocks_an_older_finalized_advance(self):
        self._assessment(
            status_value=ScreeningAssessment.Status.FINALIZED,
            decision=ScreeningAssessment.Decision.ADVANCE,
        )
        self._assessment(status_value=ScreeningAssessment.Status.DRAFT, version=2)

        response = self._transition()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            response.data['readiness']['blockers'],
            [SCREENING_ASSESSMENT_NOT_FINALIZED],
        )

    def test_staff_blocked_error_exposes_boolean_override_capability(self):
        self.client.force_authenticate(self.staff)

        response = self._transition()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIs(response.data['readiness']['can_override'], True)
        self.assertIs(type(response.data['readiness']['can_override']), bool)

    def test_finalized_advance_allows_transition_without_override(self):
        self._assessment(
            status_value=ScreeningAssessment.Status.FINALIZED,
            decision=ScreeningAssessment.Decision.ADVANCE,
        )

        response = self._transition()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pipeline_status'], PipelineStatus.QUOTING)
        event = self.deal.stage_events.get(to_status=PipelineStatus.QUOTING)
        self.assertFalse(event.is_override)
        log = ActivityLog.objects.get(
            deal=self.deal,
            action_type=ActivityActionType.STATUS_CHANGE,
        )
        self.assertFalse(log.metadata['is_override'])
        self.assertEqual(log.metadata['readiness_blockers'], [])

    def test_nonstaff_cannot_override_readiness(self):
        response = self._transition(override_readiness=True)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('override_readiness', response.data)
        self.deal.refresh_from_db()
        self.assertEqual(self.deal.pipeline_status, PipelineStatus.SCREENING)
        self.assertFalse(ActivityLog.objects.filter(deal=self.deal).exists())

    def test_staff_override_is_explicit_and_audited_with_blocker_codes(self):
        self.client.force_authenticate(self.staff)

        response = self._transition(override_readiness=True)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        event = self.deal.stage_events.get(to_status=PipelineStatus.QUOTING)
        self.assertTrue(event.is_override)
        self.assertEqual(event.performed_by, self.staff)
        log = ActivityLog.objects.get(
            deal=self.deal,
            action_type=ActivityActionType.STATUS_CHANGE,
        )
        self.assertTrue(log.metadata['is_override'])
        self.assertEqual(log.metadata['readiness_code'], SCREENING_APPROVAL_REQUIRED)
        self.assertEqual(log.metadata['readiness_blockers'], [SCREENING_ASSESSMENT_MISSING])
