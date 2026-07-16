from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models.deletion import ProtectedError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from api.models.deal import Deal
from api.models.screening import ScreeningAssessment
from api.services.screening import (
    calculate_screening_metrics,
    create_next_assessment,
    finalize_assessment,
    get_current_assessment,
    update_draft_assessment,
)


User = get_user_model()
SCREENING_URL = '/api/screening-assessments/'


class ScreeningCalculationTests(TestCase):
    def test_decimal_formulas_and_quick_score_are_deterministic(self):
        metrics = calculate_screening_metrics(
            loan_amount=Decimal('750000.00'),
            as_is_value=Decimal('1000000.00'),
            stabilized_value=Decimal('1200000.00'),
            project_cost=Decimal('900000.00'),
            noi=Decimal('100000.00'),
            annual_debt_service=Decimal('80000.00'),
            max_ltv=Decimal('0.7500'),
            max_ltc=Decimal('0.8500'),
            min_dscr=Decimal('1.2000'),
            min_debt_yield=Decimal('0.1000'),
        )

        self.assertEqual(metrics['ltv_as_is'], Decimal('0.7500'))
        self.assertEqual(metrics['ltv_stabilized'], Decimal('0.6250'))
        self.assertEqual(metrics['ltc'], Decimal('0.8333'))
        self.assertEqual(metrics['dscr'], Decimal('1.2500'))
        self.assertEqual(metrics['debt_yield'], Decimal('0.1333'))
        self.assertEqual(metrics['quick_score'], 100)

    def test_zero_or_missing_denominators_return_none_not_an_exception(self):
        metrics = calculate_screening_metrics(
            loan_amount=Decimal('0.00'),
            as_is_value=Decimal('0.00'),
            stabilized_value=Decimal('0.00'),
            project_cost=Decimal('0.00'),
            noi=Decimal('0.00'),
            annual_debt_service=Decimal('0.00'),
        )

        for field_name in ['ltv_as_is', 'ltv_stabilized', 'ltc', 'dscr', 'debt_yield']:
            self.assertIsNone(metrics[field_name])
        self.assertEqual(metrics['quick_score'], 0)

    def test_fractional_thresholds_reject_percentage_point_values(self):
        assessment = ScreeningAssessment(
            deal=Deal.objects.create(
                name='Threshold Deal',
                investment_type='whole_loan_bridge',
                source_channel='direct',
                requested_amount='1000000.00',
            ),
            version=1,
            max_ltv=Decimal('75'),
        )

        with self.assertRaises(ValidationError):
            assessment.full_clean()

    def test_threshold_scoring_uses_the_persisted_four_decimal_ratio(self):
        passing = calculate_screening_metrics(
            loan_amount=Decimal('75004'),
            as_is_value=Decimal('100000'),
            project_cost=Decimal('100000'),
            noi=Decimal('10000'),
            annual_debt_service=Decimal('8000'),
        )
        failing = calculate_screening_metrics(
            loan_amount=Decimal('75005'),
            as_is_value=Decimal('100000'),
            project_cost=Decimal('100000'),
            noi=Decimal('10000'),
            annual_debt_service=Decimal('8000'),
        )

        self.assertEqual(passing['ltv_as_is'], Decimal('0.7500'))
        self.assertEqual(passing['quick_score'], 100)
        self.assertEqual(failing['ltv_as_is'], Decimal('0.7501'))
        self.assertEqual(failing['quick_score'], 75)


class ScreeningServiceTests(TestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('screening_analyst', password='pw')
        self.deal = Deal.objects.create(
            name='Screening Service Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.analyst,
        )

    def _create_draft(self, **overrides):
        values = {
            'loan_amount': Decimal('750000.00'),
            'as_is_value': Decimal('1000000.00'),
            'project_cost': Decimal('900000.00'),
            'noi': Decimal('100000.00'),
            'stabilized_noi': Decimal('120000.00'),
            'annual_debt_service': Decimal('80000.00'),
            'occupancy': Decimal('92.00'),
            'proposed_rate': Decimal('8.0000'),
            'proposed_term_months': 24,
            'exit_strategy': 'Refinance after stabilization.',
            'exit_cap_rate': Decimal('5.5000'),
        }
        values.update(overrides)
        return create_next_assessment(deal=self.deal, **values)

    def test_versions_are_serialized_and_current_is_derived_without_rewriting_final_history(self):
        first = self._create_draft()
        finalized = finalize_assessment(
            assessment=first,
            reviewer=self.analyst,
            decision=ScreeningAssessment.Decision.ADVANCE,
            notes='Strong initial fit.',
        )
        second = self._create_draft(loan_amount=Decimal('700000.00'))

        self.assertEqual(first.version, 1)
        self.assertEqual(second.version, 2)
        self.assertEqual(get_current_assessment(self.deal).pk, second.pk)
        self.assertFalse(finalized.is_current)
        self.assertTrue(second.is_current)
        finalized.refresh_from_db()
        self.assertEqual(finalized.status, ScreeningAssessment.Status.FINALIZED)
        self.assertEqual(finalized.decision, ScreeningAssessment.Decision.ADVANCE)

    def test_only_one_current_draft_can_exist(self):
        first = self._create_draft()

        with self.assertRaises(ValidationError):
            self._create_draft(loan_amount=Decimal('700000.00'))

        self.assertTrue(first.is_current)
        self.assertEqual(ScreeningAssessment.objects.filter(deal=self.deal).count(), 1)

    def test_database_constraint_rejects_multiple_drafts_for_a_deal(self):
        ScreeningAssessment.objects.create(deal=self.deal, version=1)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                ScreeningAssessment.objects.create(deal=self.deal, version=2)

    def test_finalization_records_reviewer_decision_and_blocks_later_mutations(self):
        draft = self._create_draft()
        finalized = finalize_assessment(
            assessment=draft,
            reviewer=self.analyst,
            decision=ScreeningAssessment.Decision.REFER,
            notes='Need sponsor follow-up.',
        )

        self.assertEqual(finalized.status, ScreeningAssessment.Status.FINALIZED)
        self.assertEqual(finalized.reviewer, self.analyst)
        self.assertIsNotNone(finalized.finalized_at)
        self.assertEqual(finalized.decision, ScreeningAssessment.Decision.REFER)
        self.assertEqual(finalized.notes, 'Need sponsor follow-up.')

        with self.assertRaises(ValidationError):
            update_draft_assessment(assessment=finalized, notes='Retroactive edit')
        with self.assertRaises(ValidationError):
            finalized.delete()
        with self.assertRaises(ProtectedError):
            self.analyst.delete()

    def test_finalization_requires_a_supported_decision(self):
        draft = self._create_draft()

        with self.assertRaises(ValidationError):
            finalize_assessment(
                assessment=draft,
                reviewer=self.analyst,
                decision='',
            )

        draft.refresh_from_db()
        self.assertEqual(draft.status, ScreeningAssessment.Status.DRAFT)
        self.assertEqual(draft.decision, '')

    def test_advance_requires_complete_manual_underwriting_inputs(self):
        draft = self._create_draft(exit_strategy='', exit_cap_rate=None)
        with self.assertRaises(ValidationError) as caught:
            finalize_assessment(
                assessment=draft,
                reviewer=self.analyst,
                decision=ScreeningAssessment.Decision.ADVANCE,
            )
        self.assertEqual(set(caught.exception.message_dict), {'exit_strategy', 'exit_cap_rate'})
        draft.refresh_from_db()
        self.assertEqual(draft.status, ScreeningAssessment.Status.DRAFT)

    def test_advance_rejects_zero_economic_denominators(self):
        draft = self._create_draft(
            loan_amount=Decimal('0'),
            as_is_value=Decimal('0'),
            project_cost=Decimal('0'),
            annual_debt_service=Decimal('0'),
        )

        with self.assertRaises(ValidationError) as caught:
            finalize_assessment(
                assessment=draft,
                reviewer=self.analyst,
                decision=ScreeningAssessment.Decision.ADVANCE,
            )

        self.assertEqual(
            set(caught.exception.message_dict),
            {'loan_amount', 'as_is_value', 'project_cost', 'annual_debt_service'},
        )
        draft.refresh_from_db()
        self.assertEqual(draft.status, ScreeningAssessment.Status.DRAFT)

    def test_finalize_transaction_leaves_draft_unchanged_when_save_fails(self):
        draft = self._create_draft()

        with patch.object(ScreeningAssessment, 'save', side_effect=IntegrityError('forced finalization failure')):
            with self.assertRaises(IntegrityError):
                finalize_assessment(
                    assessment=draft,
                    reviewer=self.analyst,
                    decision=ScreeningAssessment.Decision.DECLINE,
                    notes='Should not persist.',
                )

        draft.refresh_from_db()
        self.assertEqual(draft.status, ScreeningAssessment.Status.DRAFT)
        self.assertIsNone(draft.reviewer)
        self.assertIsNone(draft.finalized_at)
        self.assertEqual(draft.decision, '')


class ScreeningAssessmentApiTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('screening_api_analyst', password='pw')
        self.other_analyst = User.objects.create_user('screening_api_other', password='pw')
        self.staff = User.objects.create_user('screening_api_staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Screening API Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.analyst,
        )
        self.other_deal = Deal.objects.create(
            name='Other Screening API Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.other_analyst,
        )
        self.client.force_authenticate(self.analyst)

    def _payload(self, deal=None, **overrides):
        values = {
            'deal': str((deal or self.deal).pk),
            'loan_amount': '750000.00',
            'as_is_value': '1000000.00',
            'stabilized_value': '1200000.00',
            'project_cost': '900000.00',
            'noi': '100000.00',
            'stabilized_noi': '120000.00',
            'annual_debt_service': '80000.00',
            'occupancy': '92.50',
            'proposed_rate': '8.2500',
            'proposed_term_months': 24,
            'current_average_rent': '1800.00',
            'market_rent': '2000.00',
            'condition_rating': 'good',
            'unit_mix': 'Mixed one- and two-bedroom units.',
            'exit_strategy': 'Refinance after stabilization.',
            'exit_cap_rate': '5.5000',
            'equity_summary': 'Manual upside review only.',
            'equity_target_irr': '18.0000',
            'equity_target_multiple': '1.8000',
            'equity_target_hold_months': 36,
        }
        values.update(overrides)
        return values

    def test_deal_scoping_hides_other_analysts_assessments_and_allows_staff(self):
        own = create_next_assessment(deal=self.deal, loan_amount=Decimal('500000.00'))
        other = create_next_assessment(deal=self.other_deal, loan_amount=Decimal('500000.00'))

        listing = self.client.get(SCREENING_URL)
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in _results(listing)], [str(own.pk)])

        hidden_detail = self.client.get(f'{SCREENING_URL}{other.pk}/')
        self.assertEqual(hidden_detail.status_code, status.HTTP_404_NOT_FOUND)

        hidden_create = self.client.post(SCREENING_URL, self._payload(self.other_deal), format='json')
        self.assertEqual(hidden_create.status_code, status.HTTP_404_NOT_FOUND)
        missing_create = self.client.post(
            SCREENING_URL,
            self._payload(deal=SimpleNamespace(pk='00000000-0000-0000-0000-000000000001')),
            format='json',
        )
        self.assertEqual(missing_create.status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(self.staff)
        staff_detail = self.client.get(f'{SCREENING_URL}{other.pk}/')
        self.assertEqual(staff_detail.status_code, status.HTTP_200_OK)

    def test_api_finalization_sets_decision_and_enforces_immutability(self):
        created = self.client.post(SCREENING_URL, self._payload(), format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        assessment_id = created.data['id']
        self.assertEqual(created.data['version'], 1)
        self.assertTrue(created.data['is_current'])
        self.assertEqual(created.data['quick_score'], 100)

        finalized = self.client.post(
            f'{SCREENING_URL}{assessment_id}/finalize/',
            {'decision': ScreeningAssessment.Decision.ADVANCE, 'notes': 'Advance to quote.'},
            format='json',
        )
        self.assertEqual(finalized.status_code, status.HTTP_200_OK)
        self.assertEqual(finalized.data['status'], ScreeningAssessment.Status.FINALIZED)
        self.assertEqual(finalized.data['decision'], ScreeningAssessment.Decision.ADVANCE)
        self.assertEqual(finalized.data['reviewer'], self.analyst.pk)
        self.assertEqual(finalized.data['notes'], 'Advance to quote.')

        mutation = self.client.patch(
            f'{SCREENING_URL}{assessment_id}/',
            {'notes': 'This must not land.'},
            format='json',
        )
        self.assertEqual(mutation.status_code, status.HTTP_400_BAD_REQUEST)
        deletion = self.client.delete(f'{SCREENING_URL}{assessment_id}/')
        self.assertEqual(deletion.status_code, status.HTTP_400_BAD_REQUEST)
        deal_deletion = self.client.delete(f'/api/deals/{self.deal.pk}/')
        self.assertEqual(deal_deletion.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(ScreeningAssessment.objects.filter(pk=assessment_id).exists())

    def test_api_rejects_a_second_draft_for_the_same_deal(self):
        first = self.client.post(SCREENING_URL, self._payload(), format='json')
        second = self.client.post(SCREENING_URL, self._payload(loan_amount='700000.00'), format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('status', second.data)

        deletion = self.client.delete(f"{SCREENING_URL}{first.data['id']}/")
        self.assertEqual(deletion.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(ScreeningAssessment.objects.filter(pk=first.data['id']).exists())

    def test_api_rejects_percentage_points_for_fractional_thresholds(self):
        response = self.client.post(SCREENING_URL, self._payload(max_ltv='75'), format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('max_ltv', response.data)

    def test_current_filter_returns_only_latest_version(self):
        first = self.client.post(SCREENING_URL, self._payload(), format='json')
        finalized = self.client.post(
            f"{SCREENING_URL}{first.data['id']}/finalize/",
            {'decision': ScreeningAssessment.Decision.ADVANCE},
            format='json',
        )
        second = self.client.post(
            SCREENING_URL,
            self._payload(loan_amount='700000.00'),
            format='json',
        )
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(finalized.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data['version'], 1)
        self.assertEqual(second.data['version'], 2)

        current = self.client.get(f'{SCREENING_URL}?deal={self.deal.pk}&current=true')
        self.assertEqual(current.status_code, status.HTTP_200_OK)
        results = _results(current)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['id'], second.data['id'])
        self.assertTrue(results[0]['is_current'])


def _results(response):
    data = response.data
    return data.get('results', data) if isinstance(data, dict) else data
