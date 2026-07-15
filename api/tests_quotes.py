import uuid
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
    send_quote,
    set_quote_attachments,
    update_draft_quote,
    withdraw_quote,
)


User = get_user_model()


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

    def test_send_counter_execute_and_attachment_rules(self):
        quote = create_next_quote(deal=self.deal, created_by=self.user)
        sent = send_quote(quote)
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
        sent = send_quote(quote)
        v2 = counter_quote(quote=sent, created_by=self.user)
        self.assertEqual(v2.version, 2)
        self.assertTrue(v2.is_counter)
        self.assertEqual(v2.status, Quote.Status.DRAFT)

        with self.assertRaises(ValidationError):
            execute_quote(sent)

        v2_sent = send_quote(v2)
        self.assertEqual(v2_sent.status, Quote.Status.COUNTERED)
        v3 = counter_quote(quote=v2_sent, created_by=self.user)
        self.assertEqual(v3.version, 3)

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
            {'interest_rate': '7.5000', 'origination_fee_pct': '1.0000'},
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
        sent = send_quote(quote)
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
        sent = send_quote(quote)
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
        set_quote_attachments(sent, [pending.pk])
        with self.assertRaises(ValidationError):
            execute_quote(sent)

    def test_non_draft_save_requires_status_in_update_fields(self):
        quote = create_next_quote(deal=self.deal, created_by=self.analyst, seed_from_screening=False)
        sent = send_quote(quote)
        sent.expires_at = timezone.now()
        with self.assertRaises(ValidationError):
            sent.save(update_fields=['expires_at'])
        sent.refresh_from_db()
        self.assertEqual(sent.status, Quote.Status.SENT)
