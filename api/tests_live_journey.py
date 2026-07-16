import hashlib
import tempfile
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import (
    ActivityLog,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplate,
    Deal,
    Document,
    PipelineStatus,
    Quote,
)


User = get_user_model()


class LiveLifecycleJourneyTests(APITestCase):
    """The request sequence issued by the Live React lifecycle workspaces."""

    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings = override_settings(
            DOCUMENT_STORAGE_BACKEND='local',
            MEDIA_ROOT=self.media.name,
        )
        self.settings.enable()
        self.actor = User.objects.create_user(
            username='live-journey-staff',
            password='pw',
            is_staff=True,
        )
        self.client.force_authenticate(self.actor)

    def tearDown(self):
        self.settings.disable()
        self.media.cleanup()

    def test_live_request_contract_reaches_closed_without_override(self):
        created = self.client.post('/api/deals/', {
            'name': 'Live UI Lifecycle Journey',
            'investment_type': 'whole_loan_bridge',
            'source_channel': 'broker',
            'source_date': timezone.localdate().isoformat(),
            'requested_amount': '3500000.00',
            'purpose': 'acquisition',
            'profile': 'value_add',
            'estimated_value': '5250000.00',
            'renovation_budget': '300000.00',
            'description': 'End-to-end Live UI contract test.',
            'sponsor': {
                'entity_name': 'Live Journey Sponsor LLC',
                'entity_type': 'llc',
                'primary_contact_name': 'Jordan Sponsor',
                'primary_contact_email': 'journey-sponsor@example.invalid',
            },
            'broker': {
                'company_name': 'Live Journey Capital Markets',
                'email': 'journey-broker@example.invalid',
            },
            'properties': [{
                'address': '700 Lifecycle Way',
                'city': 'Los Angeles',
                'state': 'CA',
                'zip': '90017',
                'property_type': 'multifamily',
                'units': 48,
            }],
        }, format='json')
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        deal_id = created.data['id']

        self._transition(deal_id, PipelineStatus.SCREENING, 'Begin screening from Live UI')
        assessment = self.client.post('/api/screening-assessments/', {
            'deal': deal_id,
            'loan_amount': '3500000.00',
            'as_is_value': '5250000.00',
            'stabilized_value': '6000000.00',
            'project_cost': '4700000.00',
            'noi': '420000.00',
            'stabilized_noi': '500000.00',
            'annual_debt_service': '300000.00',
            'occupancy': '91.00',
            'proposed_rate': '8.2500',
            'proposed_term_months': 24,
            'exit_strategy': 'Renovate, stabilize, and refinance.',
            'exit_cap_rate': '5.5000',
        }, format='json')
        self.assertEqual(assessment.status_code, status.HTTP_201_CREATED, assessment.data)
        finalized = self.client.post(
            f"/api/screening-assessments/{assessment.data['id']}/finalize/",
            {'decision': 'advance', 'notes': 'Advance from the Live journey.'},
            format='json',
        )
        self.assertEqual(finalized.status_code, status.HTTP_200_OK, finalized.data)
        self._transition(deal_id, PipelineStatus.QUOTING, 'Screening approved')

        quote = self.client.post(
            '/api/quotes/',
            {'deal': deal_id, 'seed_from_screening': True},
            format='json',
        )
        self.assertEqual(quote.status_code, status.HTTP_201_CREATED, quote.data)
        quote_id = quote.data['id']
        quote = self.client.patch(f'/api/quotes/{quote_id}/', {
            'rate_type': 'fixed',
            'interest_rate': '8.2500',
            'term_months': 24,
            'amortization_type': 'interest_only',
            'recourse_type': 'limited',
            'origination_fee_pct': '1.0000',
            'expires_at': (timezone.now() + timedelta(days=30)).isoformat(),
        }, format='json')
        self.assertEqual(quote.status_code, status.HTTP_200_OK, quote.data)
        sent = self.client.post(f'/api/quotes/{quote_id}/send/', {}, format='json')
        self.assertEqual(sent.status_code, status.HTTP_200_OK, sent.data)
        self._transition(deal_id, PipelineStatus.NEGOTIATING, 'Sent terms entered negotiation')

        body = b'MRJ Live UI journey executed term sheet'
        checksum = hashlib.sha256(body).hexdigest()
        intent = self.client.post('/api/documents/upload-intent/', {
            'deal': deal_id,
            'document_name': 'Executed term sheet.txt',
            'category': 'legal',
            'subcategory': 'term_sheet',
            'file_type': 'txt',
            'content_type': 'text/plain',
            'file_size_bytes': len(body),
            'checksum_sha256': checksum,
            'visibility_roles': ['internal'],
        }, format='json')
        self.assertEqual(intent.status_code, status.HTTP_201_CREATED, intent.data)
        document_id = intent.data['document']['id']
        uploaded = self.client.put(
            f'/api/documents/{document_id}/blob/',
            data=body,
            content_type='text/plain',
        )
        self.assertEqual(uploaded.status_code, status.HTTP_200_OK, uploaded.data)
        completed = self.client.post(
            f'/api/documents/{document_id}/complete/',
            {},
            format='json',
        )
        self.assertEqual(completed.status_code, status.HTTP_200_OK, completed.data)
        attached = self.client.post(
            f'/api/quotes/{quote_id}/attachments/',
            {'document_ids': [document_id]},
            format='json',
        )
        self.assertEqual(attached.status_code, status.HTTP_200_OK, attached.data)
        executed = self.client.post(f'/api/quotes/{quote_id}/execute/', {}, format='json')
        self.assertEqual(executed.status_code, status.HTTP_200_OK, executed.data)
        self._transition(deal_id, PipelineStatus.SIGNED, 'Term sheet executed')
        self._transition(deal_id, PipelineStatus.CLOSING, 'Begin closing diligence')

        template = DDTemplate.objects.get(key='debt_acquisition')
        generated = self.client.post('/api/closing-packages/generate/', {
            'deal': deal_id,
            'template_id': str(template.pk),
            'target_close_date': (timezone.localdate() + timedelta(days=21)).isoformat(),
        }, format='json')
        self.assertEqual(generated.status_code, status.HTTP_201_CREATED, generated.data)
        for item in DDChecklistItem.objects.filter(generation_id=generated.data['id']):
            response = self.client.patch(
                f'/api/dd-checklist-items/{item.pk}/',
                {'status': 'complete'},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        for item in ConditionPrecedent.objects.filter(generation_id=generated.data['id']):
            response = self.client.patch(
                f'/api/conditions-precedent/{item.pk}/',
                {'status': 'satisfied'},
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        package = self.client.post('/api/closing-packages/', {
            'deal': deal_id,
            'actual_close_date': timezone.localdate().isoformat(),
            'funds_wired_date': timezone.localdate().isoformat(),
            'funds_wired_amount': '3500000.00',
            'final_loan_amount': '3500000.00',
            'closing_attorney': 'Live Journey Legal LLP',
            'title_company': 'Live Journey Title Company',
        }, format='json')
        self.assertEqual(package.status_code, status.HTTP_200_OK, package.data)
        closed = self._transition(deal_id, PipelineStatus.CLOSED, 'Funding confirmed and checklist cleared')

        self.assertEqual(closed.data['pipeline_status'], PipelineStatus.CLOSED)
        deal = Deal.objects.get(pk=deal_id)
        self.assertEqual(deal.stage_events.get(exited_at__isnull=True).to_status, PipelineStatus.CLOSED)
        self.assertEqual(deal.screening_assessments.count(), 1)
        self.assertEqual(deal.quotes.get().status, Quote.Status.EXECUTED)
        evidence = Document.objects.get(pk=document_id)
        self.assertTrue(evidence.is_executed)
        self.assertGreaterEqual(ActivityLog.objects.filter(deal=deal).count(), 20)

    def _transition(self, deal_id, target, reason):
        response = self.client.post(
            f'/api/deals/{deal_id}/transition/',
            {'to_status': target, 'reason': reason},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return response
