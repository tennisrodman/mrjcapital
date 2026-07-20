from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db.models import QuerySet
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import (
    ActivityLog,
    ClosingChecklistGeneration,
    ClosingPackage,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplate,
    Document,
    DocumentStorageStatus,
    ORDINARY_REGENERATION_REASON,
    PipelineStatus,
)
from api.models.choices import ActivityActionType
from api.models.deal import Deal
from api.services.closing import (
    create_dd_item,
    generate_closing_checklist,
    set_dd_documents,
    update_dd_item,
    upsert_closing_package,
)
from api.services.deals import (
    CLOSING_CP_INCOMPLETE,
    CLOSING_DD_INCOMPLETE,
    CLOSING_FUNDING_DETAILS_INCOMPLETE,
    CLOSING_PACKAGE_REQUIRED,
    pipeline_transition_readiness,
)


User = get_user_model()


class ClosingModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('closing-model', password='pw')
        self.deal = Deal.objects.create(
            name='Closing Model Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.CLOSING,
        )

    def test_seeded_templates_exist(self):
        keys = set(DDTemplate.objects.values_list('key', flat=True))
        self.assertTrue({'debt_acquisition', 'bridge_loan', 'equity_investment'}.issubset(keys))

    def test_package_and_generation_cannot_be_deleted(self):
        package = ClosingPackage.objects.create(deal=self.deal)
        generation = ClosingChecklistGeneration.objects.create(
            package=package,
            version=1,
            template_key='debt_acquisition',
            template_name='Debt acquisition',
            is_current=True,
            generated_at=package.created_at,
            supersede_reason='',
        )
        with self.assertRaises(ValidationError):
            package.delete()
        with self.assertRaises(ValidationError):
            generation.delete()


class ClosingServiceApiTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('closing-analyst', password='pw')
        self.other = User.objects.create_user('closing-other', password='pw')
        self.staff = User.objects.create_user('closing-staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Closing API Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='2500000.00',
            pipeline_status=PipelineStatus.CLOSING,
        )
        self.template = DDTemplate.objects.get(key='debt_acquisition')
        self.client.force_authenticate(self.analyst)

    def test_get_packages_never_creates(self):
        response = self.client.get(f'/api/closing-packages/?deal={self.deal.pk}')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)
        self.assertFalse(ClosingPackage.objects.filter(deal=self.deal).exists())

    def test_closed_readiness_requires_funding_facts_and_cleared_current_checklist(self):
        missing = pipeline_transition_readiness(self.deal, PipelineStatus.CLOSED, self.analyst)
        self.assertIn(CLOSING_PACKAGE_REQUIRED, missing['blockers'])

        generation = generate_closing_checklist(
            self.deal,
            self.template,
            performed_by=self.analyst,
        )
        partial = pipeline_transition_readiness(self.deal, PipelineStatus.CLOSED, self.analyst)
        self.assertIn(CLOSING_FUNDING_DETAILS_INCOMPLETE, partial['blockers'])
        self.assertIn(CLOSING_DD_INCOMPLETE, partial['blockers'])
        self.assertIn(CLOSING_CP_INCOMPLETE, partial['blockers'])

        package = generation.package
        package.actual_close_date = timezone.localdate()
        package.funds_wired_date = timezone.localdate()
        package.funds_wired_amount = '2500000.00'
        package.final_loan_amount = '2500000.00'
        package.closing_attorney = 'Morgan Counsel'
        package.title_company = 'Reliable Title'
        package.save()
        now = timezone.now()
        generation.dd_items.update(
            status=DDChecklistItem.Status.COMPLETE,
            completed_at=now,
            completed_by=self.analyst,
        )
        generation.conditions_precedent.update(
            status=ConditionPrecedent.Status.SATISFIED,
            satisfied_at=now,
            satisfied_by=self.analyst,
        )

        ready = pipeline_transition_readiness(self.deal, PipelineStatus.CLOSED, self.analyst)
        self.assertTrue(ready['ready'])

    def test_closed_readiness_rejects_future_completion_dates(self):
        generation = generate_closing_checklist(
            self.deal,
            self.template,
            performed_by=self.analyst,
        )
        package = generation.package
        package.actual_close_date = timezone.localdate() + timedelta(days=1)
        package.funds_wired_date = timezone.localdate()
        package.funds_wired_amount = '2500000.00'
        package.final_loan_amount = '2500000.00'
        package.closing_attorney = 'Morgan Counsel'
        package.title_company = 'Reliable Title'
        package.save()
        now = timezone.now()
        generation.dd_items.update(
            status=DDChecklistItem.Status.COMPLETE,
            completed_at=now,
            completed_by=self.analyst,
        )
        generation.conditions_precedent.update(
            status=ConditionPrecedent.Status.SATISFIED,
            satisfied_at=now,
            satisfied_by=self.analyst,
        )

        readiness = pipeline_transition_readiness(self.deal, PipelineStatus.CLOSED, self.analyst)

        self.assertFalse(readiness['ready'])
        self.assertIn(CLOSING_FUNDING_DETAILS_INCOMPLETE, readiness['blockers'])

    def test_closed_readiness_requires_every_template_derived_item(self):
        generation = generate_closing_checklist(
            self.deal,
            self.template,
            performed_by=self.analyst,
        )
        missing_dd = generation.dd_items.filter(source_template_item__isnull=False).first()
        missing_cp = generation.conditions_precedent.filter(source_template_item__isnull=False).first()
        QuerySet.delete(DDChecklistItem.objects.filter(pk=missing_dd.pk))
        QuerySet.delete(ConditionPrecedent.objects.filter(pk=missing_cp.pk))
        now = timezone.now()
        generation.dd_items.update(
            status=DDChecklistItem.Status.COMPLETE,
            completed_at=now,
            completed_by=self.analyst,
        )
        generation.conditions_precedent.update(
            status=ConditionPrecedent.Status.SATISFIED,
            satisfied_at=now,
            satisfied_by=self.analyst,
        )
        package = generation.package
        package.actual_close_date = timezone.localdate()
        package.funds_wired_date = timezone.localdate()
        package.funds_wired_amount = '2500000.00'
        package.final_loan_amount = '2500000.00'
        package.closing_attorney = 'Morgan Counsel'
        package.title_company = 'Reliable Title'
        package.save()

        readiness = pipeline_transition_readiness(self.deal, PipelineStatus.CLOSED, self.analyst)

        self.assertFalse(readiness['ready'])
        self.assertIn(CLOSING_DD_INCOMPLETE, readiness['blockers'])
        self.assertIn(CLOSING_CP_INCOMPLETE, readiness['blockers'])

    def test_empty_template_does_not_invent_checklist_requirements(self):
        empty_template = DDTemplate.objects.create(
            key='custom_empty',
            name='Custom empty checklist',
        )
        generation = generate_closing_checklist(
            self.deal,
            empty_template,
            performed_by=self.analyst,
        )
        package = generation.package
        package.actual_close_date = timezone.localdate()
        package.funds_wired_date = timezone.localdate()
        package.funds_wired_amount = '2500000.00'
        package.final_loan_amount = '2500000.00'
        package.closing_attorney = 'Morgan Counsel'
        package.title_company = 'Reliable Title'
        package.save()

        readiness = pipeline_transition_readiness(self.deal, PipelineStatus.CLOSED, self.analyst)

        self.assertTrue(readiness['ready'])

    def test_upsert_create_and_partial_update(self):
        create = self.client.post(
            '/api/closing-packages/',
            {'deal': str(self.deal.pk), 'target_close_date': '2026-09-01', 'notes': 'first'},
            format='json',
        )
        self.assertEqual(create.status_code, status.HTTP_201_CREATED)
        package_id = create.data['id']

        update = self.client.post(
            '/api/closing-packages/',
            {'deal': str(self.deal.pk), 'notes': 'second'},
            format='json',
        )
        self.assertEqual(update.status_code, status.HTTP_200_OK)
        self.assertEqual(update.data['id'], package_id)
        self.assertEqual(update.data['notes'], 'second')
        self.assertEqual(update.data['target_close_date'], '2026-09-01')

        clear = self.client.patch(
            f'/api/closing-packages/{package_id}/',
            {'target_close_date': None},
            format='json',
        )
        self.assertEqual(clear.status_code, status.HTTP_200_OK)
        self.assertIsNone(clear.data['target_close_date'])

    def test_generate_checklist_and_ordinary_regenerate(self):
        response = self.client.post(
            '/api/closing-packages/generate/',
            {
                'deal': str(self.deal.pk),
                'template_id': str(self.template.pk),
                'target_close_date': '2026-10-01',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['version'], 1)
        self.assertTrue(response.data['is_current'])
        package = ClosingPackage.objects.get(deal=self.deal)
        self.assertEqual(package.target_close_date, date(2026, 10, 1))
        self.assertGreater(DDChecklistItem.objects.filter(generation_id=response.data['id']).count(), 0)

        again = self.client.post(
            '/api/closing-packages/generate/',
            {'deal': str(self.deal.pk), 'template_id': str(self.template.pk)},
            format='json',
        )
        self.assertEqual(again.status_code, status.HTTP_201_CREATED)
        self.assertEqual(again.data['version'], 2)
        prior = ClosingChecklistGeneration.objects.get(package=package, version=1)
        self.assertFalse(prior.is_current)
        self.assertEqual(prior.supersede_reason, ORDINARY_REGENERATION_REASON)

    def test_generate_does_not_change_existing_package_date(self):
        self.client.post(
            '/api/closing-packages/',
            {'deal': str(self.deal.pk), 'target_close_date': '2026-08-01'},
            format='json',
        )
        self.client.post(
            '/api/closing-packages/generate/',
            {
                'deal': str(self.deal.pk),
                'template_id': str(self.template.pk),
                'target_close_date': '2026-12-01',
            },
            format='json',
        )
        package = ClosingPackage.objects.get(deal=self.deal)
        self.assertEqual(package.target_close_date, date(2026, 8, 1))

    def test_templates_are_read_only(self):
        response = self.client.post('/api/dd-templates/', {'key': 'x', 'name': 'X'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_other_analyst_gets_404(self):
        self.client.post(
            '/api/closing-packages/generate/',
            {'deal': str(self.deal.pk), 'template_id': str(self.template.pk)},
            format='json',
        )
        package = ClosingPackage.objects.get(deal=self.deal)
        self.client.force_authenticate(self.other)
        response = self.client.get(f'/api/closing-packages/{package.pk}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_mutation_requires_closing_stage(self):
        self.deal.pipeline_status = PipelineStatus.SIGNED
        self.deal.save(update_fields=['pipeline_status'])
        response = self.client.post(
            '/api/closing-packages/generate/',
            {'deal': str(self.deal.pk), 'template_id': str(self.template.pk)},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_complete_waive_and_terminal_immutability(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        response = self.client.patch(
            f'/api/dd-checklist-items/{item.pk}/',
            {'status': 'complete'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        blocked = self.client.patch(
            f'/api/dd-checklist-items/{item.pk}/',
            {'title': 'changed'},
            format='json',
        )
        self.assertEqual(blocked.status_code, status.HTTP_400_BAD_REQUEST)

    def test_force_supersede_preserves_prior_generation(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        update_dd_item(item, performed_by=self.analyst, status='complete')
        self.client.force_authenticate(self.staff)
        response = self.client.post(
            '/api/closing-packages/generate/',
            {
                'deal': str(self.deal.pk),
                'template_id': str(self.template.pk),
                'force': True,
                'force_reason': 'Restarting underwriting',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        prior = ClosingChecklistGeneration.objects.get(
            package__deal=self.deal,
            version=1,
        )
        self.assertFalse(prior.is_current)
        self.assertEqual(prior.supersede_reason, 'Restarting underwriting')
        self.assertTrue(prior.dd_items.filter(status='complete').exists())

    def test_force_on_clean_generation_requires_reason_and_supersede_audit(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        self.client.force_authenticate(self.staff)
        missing_reason = self.client.post(
            '/api/closing-packages/generate/',
            {
                'deal': str(self.deal.pk),
                'template_id': str(self.template.pk),
                'force': True,
                'force_reason': '   ',
            },
            format='json',
        )
        self.assertEqual(missing_reason.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('force_reason', missing_reason.data)

        response = self.client.post(
            '/api/closing-packages/generate/',
            {
                'deal': str(self.deal.pk),
                'template_id': str(self.template.pk),
                'force': True,
                'force_reason': 'Board asked for a clean restart',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        prior = ClosingChecklistGeneration.objects.get(
            package__deal=self.deal,
            version=1,
        )
        self.assertFalse(prior.is_current)
        self.assertEqual(prior.supersede_reason, 'Board asked for a clean restart')
        self.assertNotEqual(prior.supersede_reason, ORDINARY_REGENERATION_REASON)
        self.assertTrue(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.CLOSING_SUPERSEDED,
            ).exists()
        )
        superseded = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.CLOSING_SUPERSEDED,
        ).latest('performed_at')
        self.assertTrue(superseded.metadata.get('force'))

    def test_non_staff_cannot_force_supersede(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        update_dd_item(item, performed_by=self.analyst, status='complete')
        self.client.force_authenticate(self.analyst)
        response = self.client.post(
            '/api/closing-packages/generate/',
            {
                'deal': str(self.deal.pk),
                'template_id': str(self.template.pk),
                'force': True,
                'force_reason': 'Analyst attempting force',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('force', response.data)
        self.assertEqual(
            ClosingChecklistGeneration.objects.filter(package__deal=self.deal, is_current=True).count(),
            1,
        )
        self.assertEqual(
            ClosingChecklistGeneration.objects.get(package__deal=self.deal, is_current=True).version,
            1,
        )

    def test_prior_generation_item_immutable_while_closing(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        prior_item = DDChecklistItem.objects.filter(
            generation__package__deal=self.deal,
            generation__version=1,
        ).first()
        response = self.client.patch(
            f'/api/dd-checklist-items/{prior_item.pk}/',
            {'status': 'in_progress'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_custom_item_and_document_attach(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        created = self.client.post(
            '/api/dd-checklist-items/',
            {'deal': str(self.deal.pk), 'title': 'Custom counsel memo', 'due_date': '2026-09-15'},
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(created.data['source_template_item'])

        doc = Document.objects.create(
            deal=self.deal,
            document_name='Memo',
            category='closing_docs',
            version=1,
            file_url='closing/memo.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['internal'],
        )
        linked = self.client.post(
            f'/api/dd-checklist-items/{created.data["id"]}/documents/',
            {'document_ids': [str(doc.pk)]},
            format='json',
        )
        self.assertEqual(linked.status_code, status.HTTP_200_OK)
        self.assertEqual(len(linked.data['documents']), 1)

        closing_logs = ActivityLog.objects.filter(
            deal=self.deal,
            action_type__startswith='closing_',
        )
        self.assertTrue(closing_logs.exists())
        self.assertFalse(closing_logs.filter(description='').exists())
        descriptions = set(closing_logs.values_list('description', flat=True))
        self.assertIn('Due diligence item added: Custom counsel memo', descriptions)
        self.assertIn('1 closing document linked to due diligence item', descriptions)

        delete_doc = self.client.delete(f'/api/documents/{doc.pk}/')
        self.assertEqual(delete_doc.status_code, status.HTTP_400_BAD_REQUEST)
        detail = self.client.get(f'/api/documents/{doc.pk}/')
        self.assertTrue(detail.data['can_edit'])
        self.assertFalse(detail.data['can_delete'])
        self.assertEqual(
            detail.data['delete_block_reason'],
            'Document is linked to a closing checklist item and cannot be deleted.',
        )

    def test_put_is_method_not_allowed(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        response = self.client.put(
            f'/api/dd-checklist-items/{item.pk}/',
            {'title': 'Hacked'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        cp = ConditionPrecedent.objects.filter(generation__package__deal=self.deal).first()
        response = self.client.put(
            f'/api/conditions-precedent/{cp.pk}/',
            {'title': 'Hacked'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_hidden_document_not_leaked_and_terminal_add_preserves_invisible(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        hidden = Document.objects.create(
            deal=self.deal,
            document_name='Investor only',
            category='investor_docs',
            version=1,
            file_url='closing/hidden.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['investor'],
        )
        visible = Document.objects.create(
            deal=self.deal,
            document_name='Internal memo',
            category='closing_docs',
            version=1,
            file_url='closing/visible.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['internal'],
        )
        self.client.force_authenticate(self.staff)
        linked = self.client.post(
            f'/api/dd-checklist-items/{item.pk}/documents/',
            {'document_ids': [str(hidden.pk)]},
            format='json',
        )
        self.assertEqual(linked.status_code, status.HTTP_200_OK)
        self.assertEqual(len(linked.data['documents']), 1)

        update_dd_item(item, performed_by=self.staff, status='complete')
        self.client.force_authenticate(self.analyst)
        listed = self.client.get(f'/api/dd-checklist-items/{item.pk}/')
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual(listed.data['documents'], [])

        added = self.client.post(
            f'/api/dd-checklist-items/{item.pk}/documents/',
            {'document_ids': [str(visible.pk)]},
            format='json',
        )
        self.assertEqual(added.status_code, status.HTTP_200_OK)
        self.assertEqual({doc['id'] for doc in added.data['documents']}, {str(visible.pk)})
        item.refresh_from_db()
        self.assertEqual(
            set(item.documents.values_list('pk', flat=True)),
            {hidden.pk, visible.pk},
        )

    def test_queryset_delete_blocked_and_unknown_owner_rejected(self):
        package = ClosingPackage.objects.create(deal=self.deal)
        with self.assertRaises(ValidationError):
            ClosingPackage.objects.filter(pk=package.pk).delete()
        generate_closing_checklist(self.deal, self.template, performed_by=self.analyst)
        with self.assertRaises(ValidationError):
            ClosingChecklistGeneration.objects.filter(package__deal=self.deal).delete()
        with self.assertRaises(ValidationError):
            DDChecklistItem.objects.filter(generation__package__deal=self.deal).delete()
        response = self.client.post(
            '/api/dd-checklist-items/',
            {'deal': str(self.deal.pk), 'title': 'Owned', 'owner': 999999},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('owner', response.data)

    def test_inaccessible_deal_generate_is_404(self):
        missing = self.client.post(
            '/api/closing-packages/generate/',
            {'deal': '00000000-0000-0000-0000-000000000099', 'template_id': str(self.template.pk)},
            format='json',
        )
        self.client.force_authenticate(self.other)
        other = self.client.post(
            '/api/closing-packages/generate/',
            {'deal': str(self.deal.pk), 'template_id': str(self.template.pk)},
            format='json',
        )
        self.assertEqual(missing.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(missing.data, other.data)
