import uuid
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import (
    Deal,
    Document,
    DocumentCategory,
    DocumentStorageStatus,
    PipelineStatus,
    Quote,
    ScreeningAssessment,
)
from api.services.deals import (
    QUOTE_EXECUTION_REQUIRED,
    QUOTE_READINESS_REQUIRED,
    QUOTE_REQUIRED_FOR_NEGOTIATING,
    pipeline_transition_readiness,
    transition_pipeline_status,
)
from api.services.quotes import (
    counter_quote,
    create_next_quote,
    execute_quote,
    expire_quote,
    send_quote,
    set_quote_attachments,
    update_draft_quote,
    withdraw_quote,
)


User = get_user_model()


def make_sendable(quote):
    return update_draft_quote(
        quote,
        loan_amount=quote.loan_amount or Decimal('1000000.00'),
        rate_type=Quote.RateType.FIXED,
        interest_rate=quote.interest_rate or Decimal('8.0000'),
        term_months=quote.term_months or 24,
        amortization_type=Quote.AmortizationType.INTEREST_ONLY,
        recourse_type=Quote.RecourseType.LIMITED,
        expires_at=timezone.now() + timedelta(days=30),
    )


class QuoteModelSmokeTests(APITestCase):
    def test_quote_model_is_importable_and_defaults_to_draft(self):
        user = User.objects.create_user('q-smoke', password='pw')
        deal = Deal.objects.create(
            name='Quote Smoke',
            investment_type='whole_loan_bridge',
            assigned_analyst=user,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.QUOTING,
        )
        quote = Quote.objects.create(deal=deal, version=1, created_by=user)
        self.assertEqual(quote.status, Quote.Status.DRAFT)
        self.assertEqual(quote.attachments.count(), 0)
        self.assertTrue(quote.is_current)


class QuoteServiceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('q-svc', password='pw')
        self.deal = Deal.objects.create(
            name='Quote Service Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='2500000.00',
            pipeline_status=PipelineStatus.QUOTING,
        )
        ScreeningAssessment.objects.create(
            deal=self.deal,
            version=1,
            status=ScreeningAssessment.Status.FINALIZED,
            decision=ScreeningAssessment.Decision.ADVANCE,
            reviewer=self.user,
            loan_amount=Decimal('2500000.00'),
            proposed_rate=Decimal('8.2500'),
            proposed_term_months=24,
            finalized_at=timezone.now(),
        )

    def _ready_term_sheet(self, *, subcategory='term_sheet', category=DocumentCategory.LEGAL):
        return Document.objects.create(
            deal=self.deal,
            document_name='Term Sheet',
            category=category,
            subcategory=subcategory,
            file_url=f'deals/{self.deal.pk}/{uuid.uuid4()}/v1/term.pdf',
            file_type='pdf',
            content_type='application/pdf',
            file_size_bytes=32,
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['internal'],
            uploaded_by=self.user,
        )

    def test_create_seeds_from_finalized_screening_and_calculates_fees(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user, seed_from_screening=True)
        self.assertEqual(quote.version, 1)
        self.assertEqual(quote.loan_amount, Decimal('2500000.00'))
        self.assertEqual(quote.interest_rate, Decimal('8.2500'))
        self.assertEqual(quote.term_months, 24)
        updated = update_draft_quote(
            quote,
            origination_fee_pct=Decimal('1.0000'),
            holdback_amount=Decimal('250000.00'),
        )
        self.assertEqual(updated.origination_fee_amount, Decimal('25000.00'))
        self.assertEqual(updated.initial_funding_amount, Decimal('2250000.00'))

    def test_cannot_create_quote_outside_quoting_or_negotiating(self):
        self.deal.pipeline_status = PipelineStatus.SCREENING
        self.deal.save(update_fields=['pipeline_status', 'updated_at'])
        with self.assertRaises(ValidationError):
            create_next_quote(deal=self.deal, created_by=self.user)

    def test_second_draft_blocked_while_draft_open(self):
        create_next_quote(deal=self.deal, created_by=self.user)
        with self.assertRaises(ValidationError):
            create_next_quote(deal=self.deal, created_by=self.user)

    def test_incomplete_quote_cannot_be_sent(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user, seed_from_screening=False)
        with self.assertRaises(ValidationError) as caught:
            send_quote(quote)
        self.assertIn('loan_amount', caught.exception.message_dict)
        quote.refresh_from_db()
        self.assertEqual(quote.status, Quote.Status.DRAFT)

    def test_zero_loan_and_missing_amortization_period_cannot_be_sent(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user, seed_from_screening=False)
        quote = update_draft_quote(
            quote,
            loan_amount=Decimal('0'),
            rate_type=Quote.RateType.FIXED,
            interest_rate=Decimal('8.0000'),
            term_months=24,
            amortization_type=Quote.AmortizationType.FULL_AMORT,
            recourse_type=Quote.RecourseType.LIMITED,
            expires_at=timezone.now() + timedelta(days=30),
        )

        with self.assertRaises(ValidationError) as caught:
            send_quote(quote)

        self.assertEqual(
            set(caught.exception.message_dict),
            {'loan_amount', 'amortization_months'},
        )
        quote.refresh_from_db()
        self.assertEqual(quote.status, Quote.Status.DRAFT)

    def test_send_counter_execute_and_attachment_rules(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user)
        sent = send_quote(make_sendable(quote))
        self.assertEqual(sent.status, Quote.Status.SENT)
        self.assertIsNotNone(sent.sent_at)

        with self.assertRaises(ValidationError):
            update_draft_quote(sent, interest_rate=Decimal('9.0000'))

        with self.assertRaises(ValidationError):
            execute_quote(sent)

        bad_doc = self._ready_term_sheet(category=DocumentCategory.FINANCIALS, subcategory='')
        with self.assertRaises(ValidationError):
            set_quote_attachments(sent, [bad_doc.pk])

        good_doc = self._ready_term_sheet()
        set_quote_attachments(sent, [good_doc.pk])
        executed = execute_quote(sent)
        self.assertEqual(executed.status, Quote.Status.EXECUTED)
        self.assertIsNotNone(executed.signed_at)

    def test_counter_from_sent_and_from_countered_requires_current(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user)
        sent = send_quote(make_sendable(quote))
        v2 = counter_quote(quote=sent, created_by=self.user)
        self.assertEqual(v2.version, 2)
        self.assertTrue(v2.is_counter)
        self.assertEqual(v2.status, Quote.Status.DRAFT)

        with self.assertRaises(ValidationError):
            execute_quote(sent)

        v2_sent = send_quote(make_sendable(v2))
        self.assertEqual(v2_sent.status, Quote.Status.COUNTERED)
        v3 = counter_quote(quote=v2_sent, created_by=self.user)
        self.assertEqual(v3.version, 3)

    def test_expired_quote_cannot_be_countered_or_executed_and_cannot_expire_early(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user)
        sent = send_quote(make_sendable(quote))

        with self.assertRaises(ValidationError) as early:
            expire_quote(sent)
        self.assertIn('expires_at', early.exception.message_dict)

        Quote.objects.filter(pk=sent.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        sent.refresh_from_db()
        with self.assertRaises(ValidationError) as countered:
            counter_quote(quote=sent, created_by=self.user)
        self.assertIn('expires_at', countered.exception.message_dict)
        with self.assertRaises(ValidationError) as executed:
            execute_quote(sent)
        self.assertIn('expires_at', executed.exception.message_dict)

        expired = expire_quote(sent)
        self.assertEqual(expired.status, Quote.Status.EXPIRED)

    def test_withdraw_current_draft(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user)
        withdrawn = withdraw_quote(quote)
        self.assertEqual(withdrawn.status, Quote.Status.WITHDRAWN)
        replacement = create_next_quote(deal=self.deal, created_by=self.user)
        self.assertEqual(replacement.version, 2)


class QuoteApiTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('q-api', password='pw')
        self.other = User.objects.create_user('q-other', password='pw')
        self.deal = Deal.objects.create(
            name='Quote API Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.QUOTING,
        )
        ScreeningAssessment.objects.create(
            deal=self.deal,
            version=1,
            status=ScreeningAssessment.Status.FINALIZED,
            decision=ScreeningAssessment.Decision.ADVANCE,
            reviewer=self.analyst,
            finalized_at=timezone.now(),
        )
        self.client.force_authenticate(self.analyst)

    def test_create_send_attach_execute_via_api(self):
        create = self.client.post(
            '/api/quotes/',
            {'deal': str(self.deal.pk), 'seed_from_screening': True},
            format='json',
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        quote_id = create.data['id']

        patch = self.client.patch(
            f'/api/quotes/{quote_id}/',
            {
                'loan_amount': '1000000.00',
                'rate_type': 'fixed',
                'interest_rate': '7.5000',
                'term_months': 24,
                'amortization_type': 'interest_only',
                'recourse_type': 'limited',
                'expires_at': (timezone.now() + timedelta(days=30)).isoformat(),
                'origination_fee_pct': '1.0000',
            },
            format='json',
        )
        self.assertEqual(patch.status_code, status.HTTP_200_OK)

        send = self.client.post(f'/api/quotes/{quote_id}/send/', {}, format='json')
        self.assertEqual(send.status_code, status.HTTP_200_OK)
        self.assertEqual(send.data['status'], 'sent')

        document = Document.objects.create(
            deal=self.deal,
            document_name='Executed TS',
            category=DocumentCategory.LEGAL,
            subcategory='term_sheet',
            file_url=f'deals/{self.deal.pk}/{uuid.uuid4()}/v1/ts.pdf',
            file_type='pdf',
            content_type='application/pdf',
            file_size_bytes=10,
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['internal'],
            uploaded_by=self.analyst,
        )
        attach = self.client.post(
            f'/api/quotes/{quote_id}/attachments/',
            {'document_ids': [str(document.pk)]},
            format='json',
        )
        self.assertEqual(attach.status_code, status.HTTP_200_OK)

        execute = self.client.post(f'/api/quotes/{quote_id}/execute/', {}, format='json')
        self.assertEqual(execute.status_code, status.HTTP_200_OK)
        self.assertEqual(execute.data['status'], 'executed')

        delete = self.client.delete(f'/api/quotes/{quote_id}/')
        self.assertEqual(delete.status_code, status.HTTP_400_BAD_REQUEST)

    def test_other_analyst_cannot_see_quote(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst)
        self.client.force_authenticate(self.other)
        response = self.client.get(f'/api/quotes/{quote.pk}/')
        missing = self.client.get(f'/api/quotes/{uuid.uuid4()}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data, missing.data)

    def test_interest_reserve_months_must_be_at_least_one(self):
        response = self.client.post(
            '/api/quotes/',
            {
                'deal': str(self.deal.pk),
                'seed_from_screening': False,
                'interest_reserve_months': 0,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('interest_reserve_months', response.data)


class QuoteReadinessTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('q-ready', password='pw')
        self.staff = User.objects.create_user('q-staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Quote Ready Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.QUOTING,
        )

    def test_current_quote_gates_negotiating_and_signed(self):
        readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.analyst,
        )
        self.assertFalse(readiness['ready'])
        self.assertEqual(readiness['code'], QUOTE_READINESS_REQUIRED)
        self.assertIn(QUOTE_REQUIRED_FOR_NEGOTIATING, readiness['blockers'])

        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote))
        readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.analyst,
        )
        self.assertTrue(readiness['ready'])

        # Counter draft must block Negotiating even though v1 remains sent.
        counter_quote(quote=sent, created_by=self.analyst)
        readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.analyst,
        )
        self.assertFalse(readiness['ready'])
        self.assertIn(QUOTE_REQUIRED_FOR_NEGOTIATING, readiness['blockers'])

        self.deal.pipeline_status = PipelineStatus.NEGOTIATING
        self.deal.save(update_fields=['pipeline_status', 'updated_at'])
        signed_readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.SIGNED,
            self.analyst,
        )
        self.assertFalse(signed_readiness['ready'])
        self.assertEqual(signed_readiness['code'], QUOTE_READINESS_REQUIRED)
        self.assertIn(QUOTE_EXECUTION_REQUIRED, signed_readiness['blockers'])

    def test_past_due_active_quote_blocks_negotiating_but_executed_quote_remains_valid(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote), performed_by=self.analyst)
        Quote.objects.filter(pk=sent.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        sent.refresh_from_db()

        expired_readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.analyst,
        )
        self.assertFalse(expired_readiness['ready'])
        self.assertIn(QUOTE_REQUIRED_FOR_NEGOTIATING, expired_readiness['blockers'])

        Quote.objects.filter(pk=sent.pk).update(expires_at=timezone.now() + timedelta(days=1))
        sent.refresh_from_db()
        document = Document.objects.create(
            deal=self.deal,
            document_name='Executed TS',
            category=DocumentCategory.LEGAL,
            subcategory='term_sheet',
            file_url=f'deals/{self.deal.pk}/{uuid.uuid4()}/v1/ts.pdf',
            file_type='pdf',
            content_type='application/pdf',
            file_size_bytes=10,
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['internal'],
            uploaded_by=self.analyst,
        )
        set_quote_attachments(sent, [document.pk], user=self.analyst)
        executed = execute_quote(sent, performed_by=self.analyst)
        Quote.objects.filter(pk=executed.pk).update(expires_at=timezone.now() - timedelta(days=1))

        executed_readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.analyst,
        )
        self.assertTrue(executed_readiness['ready'])

    def test_staff_override_records_quote_readiness_code(self):
        transitioned = transition_pipeline_status(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.staff,
            'Staff override into negotiating',
            override_readiness=True,
        )
        self.assertEqual(transitioned.pipeline_status, PipelineStatus.NEGOTIATING)
        event = transitioned.stage_events.order_by('-entered_at').first()
        self.assertTrue(event.is_override)
        from api.models import ActivityLog
        log = ActivityLog.objects.filter(deal=self.deal).order_by('-performed_at').first()
        self.assertEqual(log.metadata.get('readiness_code'), QUOTE_READINESS_REQUIRED)
        self.assertIn(QUOTE_REQUIRED_FOR_NEGOTIATING, log.metadata.get('readiness_blockers', []))

    def test_wrong_subcategory_and_pending_attachment_blocked(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote))
        wrong_sub = Document.objects.create(
            deal=self.deal,
            document_name='Wrong Sub',
            category=DocumentCategory.LEGAL,
            subcategory='phase_1',
            file_url=f'deals/{self.deal.pk}/{uuid.uuid4()}/v1/x.pdf',
            file_type='pdf',
            content_type='application/pdf',
            file_size_bytes=10,
            storage_status=DocumentStorageStatus.READY,
            uploaded_by=self.analyst,
        )
        with self.assertRaises(ValidationError):
            set_quote_attachments(sent, [wrong_sub.pk])

        pending = Document.objects.create(
            deal=self.deal,
            document_name='Pending TS',
            category=DocumentCategory.LEGAL,
            subcategory='term_sheet',
            file_url=f'deals/{self.deal.pk}/{uuid.uuid4()}/v1/p.pdf',
            file_type='pdf',
            content_type='application/pdf',
            file_size_bytes=10,
            storage_status=DocumentStorageStatus.PENDING,
            uploaded_by=self.analyst,
        )
        with self.assertRaises(ValidationError):
            set_quote_attachments(sent, [pending.pk], user=self.analyst)

    def test_non_draft_save_requires_status_in_update_fields(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote))
        sent.expires_at = timezone.now()
        with self.assertRaises(ValidationError):
            sent.save(update_fields=['expires_at'])
        sent.refresh_from_db()
        self.assertEqual(sent.status, Quote.Status.SENT)


class QuoteIntegrityTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('q-integ', password='pw')
        self.deal = Deal.objects.create(
            name='Quote Integrity Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.QUOTING,
        )
        self.client.force_authenticate(self.analyst)

    def _ready_term_sheet(self):
        return Document.objects.create(
            deal=self.deal,
            document_name='Executed TS',
            category=DocumentCategory.LEGAL,
            subcategory='term_sheet',
            file_url=f'deals/{self.deal.pk}/{uuid.uuid4()}/v1/ts.pdf',
            file_type='pdf',
            content_type='application/pdf',
            file_size_bytes=20,
            storage_status=DocumentStorageStatus.READY,
            uploaded_by=self.analyst,
            visibility_roles=['internal'],
        )

    def test_executed_attachment_cannot_be_deleted(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote), performed_by=self.analyst)
        doc = self._ready_term_sheet()
        set_quote_attachments(sent, [doc.pk], user=self.analyst)
        execute_quote(sent, performed_by=self.analyst)
        doc.refresh_from_db()
        self.assertTrue(doc.is_executed)
        response = self.client.delete(f'/api/documents/{doc.pk}/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Document.objects.filter(pk=doc.pk).exists())
        detail = self.client.get(f'/api/documents/{doc.pk}/')
        self.assertFalse(detail.data['can_edit'])
        self.assertFalse(detail.data['can_delete'])
        self.assertEqual(
            detail.data['delete_block_reason'],
            'Document is attached to an executed quote and cannot be deleted.',
        )

    def test_executed_attachment_metadata_cannot_be_patched(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote), performed_by=self.analyst)
        doc = self._ready_term_sheet()
        set_quote_attachments(sent, [doc.pk], user=self.analyst)
        execute_quote(sent, performed_by=self.analyst)
        response = self.client.patch(
            f'/api/documents/{doc.pk}/',
            {
                'subcategory': 'loi',
                'notes': 'Rewritten evidence notes',
                'details': {'replaced': True},
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('subcategory', response.data)
        doc.refresh_from_db()
        self.assertEqual(doc.subcategory, 'term_sheet')

    def test_quote_mutations_blocked_outside_quoting_negotiating(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        self.deal.pipeline_status = PipelineStatus.ON_HOLD
        self.deal.paused_from_status = PipelineStatus.QUOTING
        self.deal.save(update_fields=['pipeline_status', 'paused_from_status'])
        with self.assertRaises(ValidationError):
            send_quote(quote, performed_by=self.analyst)
        with self.assertRaises(ValidationError):
            update_draft_quote(quote, performed_by=self.analyst, notes='nope')

    def test_quote_actions_write_activity_logs(self):
        from api.models import ActivityActionType, ActivityLog

        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        self.assertTrue(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.QUOTE_CREATED,
            ).exists()
        )

    def test_identical_draft_patch_creates_no_activity(self):
        from api.models import ActivityActionType, ActivityLog

        quote = create_next_quote(
            deal=self.deal,
            created_by=self.analyst,
            seed_from_screening=False,
            notes='No change',
        )
        before_updated_at = quote.updated_at
        before_count = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.QUOTE_UPDATED,
        ).count()

        unchanged = update_draft_quote(
            quote,
            performed_by=self.analyst,
            notes='No change',
        )

        self.assertEqual(unchanged.updated_at, before_updated_at)
        self.assertEqual(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.QUOTE_UPDATED,
            ).count(),
            before_count,
        )
        send_quote(make_sendable(quote), performed_by=self.analyst)
        self.assertTrue(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.QUOTE_SENT,
                performed_by=self.analyst,
            ).exists()
        )

    def test_identical_attachment_update_creates_no_activity(self):
        from api.models import ActivityActionType, ActivityLog

        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        document = self._ready_term_sheet()
        set_quote_attachments(quote, [document.pk], user=self.analyst)
        before_count = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.QUOTE_ATTACHMENTS_UPDATED,
        ).count()

        unchanged = set_quote_attachments(quote, [document.pk], user=self.analyst)

        self.assertEqual(set(unchanged.attachments.values_list('pk', flat=True)), {document.pk})
        self.assertEqual(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.QUOTE_ATTACHMENTS_UPDATED,
            ).count(),
            before_count,
        )

    def test_holdback_cannot_exceed_loan_amount(self):
        with self.assertRaises(ValidationError):
            create_next_quote(
                deal=self.deal,
                created_by=self.analyst,
                seed_from_screening=False,
                loan_amount=Decimal('1000000.00'),
                holdback_amount=Decimal('1500000.00'),
                rate_type=Quote.RateType.FIXED,
                interest_rate=Decimal('8.0000'),
                amortization_type=Quote.AmortizationType.INTEREST_ONLY,
                recourse_type=Quote.RecourseType.LIMITED,
            )

    def test_queryset_delete_blocked(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        with self.assertRaises(ValidationError):
            Quote.objects.filter(pk=quote.pk).delete()

    def test_signed_readiness_requires_execution_evidence(self):
        from api.services.deals import QUOTE_EXECUTION_EVIDENCE_REQUIRED

        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(make_sendable(quote), performed_by=self.analyst)
        doc = self._ready_term_sheet()
        set_quote_attachments(sent, [doc.pk], user=self.analyst)
        execute_quote(sent, performed_by=self.analyst)
        transition_pipeline_status(
            self.deal,
            PipelineStatus.NEGOTIATING,
            self.analyst,
            'Move to negotiating',
        )
        self.deal.refresh_from_db()
        Quote.objects.get(pk=sent.pk).attachments.clear()
        readiness = pipeline_transition_readiness(
            self.deal,
            PipelineStatus.SIGNED,
            self.analyst,
        )
        self.assertFalse(readiness['ready'])
        self.assertIn(QUOTE_EXECUTION_EVIDENCE_REQUIRED, readiness['blockers'])
