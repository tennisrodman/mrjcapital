from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from api.models import (
    ActivityActionType,
    ActivityLog,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplate,
    Deal,
    Document,
    DocumentBlobDeletion,
    DocumentStorageStatus,
    PipelineStatus,
)
from api.services.closing import (
    create_cp_item,
    create_dd_item,
    generate_closing_checklist,
    upsert_closing_package,
)
from api.services.documents import (
    enqueue_document_blob_deletion,
    process_pending_blob_deletions,
)


User = get_user_model()


class ClosingMutationIntegrityTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('closing-integrity', password='pw')
        self.deal = Deal.objects.create(
            name='Closing integrity deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.CLOSING,
        )
        self.template = DDTemplate.objects.get(key='debt_acquisition')
        self.generation = generate_closing_checklist(
            self.deal,
            self.template,
            performed_by=self.analyst,
        )
        self.client.force_authenticate(self.analyst)

    def test_template_items_cannot_be_deleted_but_custom_open_items_can(self):
        template_dd = self.generation.dd_items.filter(status=DDChecklistItem.Status.PENDING).first()
        template_cp = self.generation.conditions_precedent.filter(
            status=ConditionPrecedent.Status.OPEN,
        ).first()

        dd_response = self.client.delete(f'/api/dd-checklist-items/{template_dd.pk}/')
        cp_response = self.client.delete(f'/api/conditions-precedent/{template_cp.pk}/')
        self.assertEqual(dd_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(cp_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(DDChecklistItem.objects.filter(pk=template_dd.pk).exists())
        self.assertTrue(ConditionPrecedent.objects.filter(pk=template_cp.pk).exists())

        custom_dd = create_dd_item(self.deal, title='Custom DD', performed_by=self.analyst)
        custom_cp = create_cp_item(self.deal, title='Custom CP', performed_by=self.analyst)
        self.assertEqual(
            self.client.delete(f'/api/dd-checklist-items/{custom_dd.pk}/').status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertEqual(
            self.client.delete(f'/api/conditions-precedent/{custom_cp.pk}/').status_code,
            status.HTTP_204_NO_CONTENT,
        )

    def test_identical_item_patches_do_not_save_or_log(self):
        dd = self.generation.dd_items.first()
        cp = self.generation.conditions_precedent.first()
        dd_updated_at = dd.updated_at
        cp_updated_at = cp.updated_at
        before = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.CLOSING_ITEM_UPDATED,
        ).count()

        dd_response = self.client.patch(
            f'/api/dd-checklist-items/{dd.pk}/',
            {'title': dd.title, 'status': dd.status},
            format='json',
        )
        cp_response = self.client.patch(
            f'/api/conditions-precedent/{cp.pk}/',
            {'description': cp.description, 'status': cp.status},
            format='json',
        )
        self.assertEqual(dd_response.status_code, status.HTTP_200_OK)
        self.assertEqual(cp_response.status_code, status.HTTP_200_OK)
        dd.refresh_from_db()
        cp.refresh_from_db()
        self.assertEqual(dd.updated_at, dd_updated_at)
        self.assertEqual(cp.updated_at, cp_updated_at)
        self.assertEqual(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.CLOSING_ITEM_UPDATED,
            ).count(),
            before,
        )

    def test_package_audit_lists_only_actual_diffs_and_identical_patch_is_noop(self):
        package = self.generation.package
        package.notes = 'unchanged'
        package.save(update_fields=['notes', 'updated_at'])
        before = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.CLOSING_PACKAGE_UPDATED,
        ).count()

        changed = self.client.patch(
            f'/api/closing-packages/{package.pk}/',
            {'notes': 'unchanged', 'title_company': 'Reliable Title'},
            format='json',
        )
        self.assertEqual(changed.status_code, status.HTTP_200_OK)
        log = ActivityLog.objects.filter(
            deal=self.deal,
            action_type=ActivityActionType.CLOSING_PACKAGE_UPDATED,
        ).latest('performed_at')
        self.assertEqual(log.metadata['fields'], ['title_company'])
        self.assertEqual(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.CLOSING_PACKAGE_UPDATED,
            ).count(),
            before + 1,
        )

        identical = self.client.patch(
            f'/api/closing-packages/{package.pk}/',
            {'notes': 'unchanged', 'title_company': 'Reliable Title'},
            format='json',
        )
        self.assertEqual(identical.status_code, status.HTTP_200_OK)
        self.assertEqual(
            ActivityLog.objects.filter(
                deal=self.deal,
                action_type=ActivityActionType.CLOSING_PACKAGE_UPDATED,
            ).count(),
            before + 1,
        )

    def test_future_actual_dates_are_rejected_by_api_and_service(self):
        tomorrow = timezone.localdate() + timedelta(days=1)
        response = self.client.patch(
            f'/api/closing-packages/{self.generation.package_id}/',
            {'actual_close_date': tomorrow.isoformat()},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('actual_close_date', response.data)

        with self.assertRaises(ValidationError):
            upsert_closing_package(
                self.deal,
                performed_by=self.analyst,
                fields_present={'funds_wired_date'},
                funds_wired_date=tomorrow,
            )


class NoteAttachmentIntegrityTests(APITestCase):
    def setUp(self):
        self.analyst = User.objects.create_user('note-integrity', password='pw')
        self.staff = User.objects.create_user('note-integrity-staff', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Note integrity deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.analyst,
            source_channel='direct',
            requested_amount='1000000.00',
        )
        self.visible = self._document('visible.pdf', DocumentStorageStatus.READY, ['internal'])
        self.hidden = self._document('hidden.pdf', DocumentStorageStatus.READY, ['counsel'])
        self.pending = self._document('pending.pdf', DocumentStorageStatus.PENDING, ['internal'])
        self.client.force_authenticate(self.analyst)

    def _document(self, name, storage_status, roles):
        return Document.objects.create(
            deal=self.deal,
            document_name=name,
            category='closing_docs',
            file_url=f'notes/{name}',
            file_type='pdf',
            storage_status=storage_status,
            visibility_roles=roles,
        )

    def test_create_rejects_pending_and_hidden_attachments(self):
        for document in (self.pending, self.hidden):
            response = self.client.post(
                '/api/deal-notes/',
                {
                    'deal': str(self.deal.pk),
                    'body': 'Evidence note',
                    'attachments': [str(document.pk)],
                },
                format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            self.assertIn('attachments', response.data)

    def test_edit_preserves_hidden_existing_attachment_without_leaking_it(self):
        created = self.client.post(
            '/api/deal-notes/',
            {
                'deal': str(self.deal.pk),
                'body': 'Analyst evidence note',
                'attachments': [str(self.visible.pk)],
            },
            format='json',
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        note = self.deal.notes.get(pk=created.data['id'])
        # Existing staff-only evidence can predate the visibility guard or be
        # added by an authorized staff workflow.  An analyst edit must retain it.
        note.attachments.add(self.hidden)

        detail = self.client.get(f'/api/deal-notes/{created.data["id"]}/')
        self.assertEqual(detail.data['attachments'], [str(self.visible.pk)])
        edited = self.client.patch(
            f'/api/deal-notes/{created.data["id"]}/',
            {'attachments': [], 'body': 'Analyst edit'},
            format='json',
        )
        self.assertEqual(edited.status_code, status.HTTP_200_OK)
        self.assertEqual(edited.data['attachments'], [])
        note.refresh_from_db()
        self.assertEqual(set(note.attachments.values_list('pk', flat=True)), {self.hidden.pk})


class RecordingStorage:
    def __init__(self):
        self.deleted = []

    def delete_object(self, key):
        self.deleted.append(key)


class BlobDeletionEligibilityTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user('blob-delete-integrity', password='pw')
        self.deal = Deal.objects.create(
            name='Blob deletion deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
        )

    def _document(self, key):
        return Document.objects.create(
            deal=self.deal,
            document_name='pending.pdf',
            category='closing_docs',
            file_url=key,
            file_type='pdf',
            storage_status=DocumentStorageStatus.PENDING,
            visibility_roles=['internal'],
        )

    @override_settings(
        DOCUMENT_STORAGE_BACKEND='r2',
        R2_PRESIGN_UPLOAD_EXPIRY=300,
        R2_PRESIGN_DELETE_SAFETY_SKEW=30,
    )
    def test_r2_deletion_waits_until_signed_put_expiry_plus_skew(self):
        document = self._document('r2/pending.pdf')
        requested_at = timezone.now()
        deletion = enqueue_document_blob_deletion(
            document,
            reason=DocumentBlobDeletion.Reason.USER_DELETE,
            requested_by=self.user,
        )
        self.assertGreaterEqual(
            deletion.next_attempt_at,
            document.uploaded_date + timedelta(seconds=330),
        )
        self.assertGreater(deletion.next_attempt_at, requested_at)
        storage = RecordingStorage()
        result = process_pending_blob_deletions(storage=storage)
        self.assertEqual(result, {'completed': 0, 'failed': 0})
        self.assertEqual(storage.deleted, [])

    @override_settings(DOCUMENT_STORAGE_BACKEND='local')
    def test_local_deletion_is_immediately_eligible(self):
        document = self._document('local/pending.pdf')
        deletion = enqueue_document_blob_deletion(
            document,
            reason=DocumentBlobDeletion.Reason.USER_DELETE,
            requested_by=self.user,
        )
        self.assertLessEqual(deletion.next_attempt_at, timezone.now())
        storage = RecordingStorage()
        result = process_pending_blob_deletions(storage=storage)
        self.assertEqual(result, {'completed': 1, 'failed': 0})
        self.assertEqual(storage.deleted, ['local/pending.pdf'])
