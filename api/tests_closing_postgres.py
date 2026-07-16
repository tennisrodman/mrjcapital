"""PostgreSQL contract tests for Closing concurrency and constraints.

Required before merge/release of roadmap 2a:

    DJANGO_SETTINGS_MODULE=mrj.settings.development \\
      ./.venv/bin/python -m pytest api/tests_closing_postgres.py -q
"""

import threading
import unittest
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import connection, connections, transaction
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import (
    ClosingChecklistGeneration,
    ClosingPackage,
    DDChecklistItem,
    DDTemplate,
    DDTemplateItem,
    Document,
    DocumentStorageStatus,
    PipelineStatus,
)
from api.models.deal import Deal
from api.services.closing import (
    create_dd_item,
    generate_closing_checklist,
    set_dd_documents,
)


User = get_user_model()


def _close_thread_connections():
    connections.close_all()


@unittest.skipUnless(connection.vendor == 'postgresql', 'Requires PostgreSQL')
class ClosingPostgresContractTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user('closing-pg', password='pw', is_staff=True)
        self.deal = Deal.objects.create(
            name='Closing PG Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
            pipeline_status=PipelineStatus.CLOSING,
        )
        self.template, _ = DDTemplate.objects.get_or_create(
            key='debt_acquisition',
            defaults={
                'name': 'Debt acquisition',
                'description': 'Standard acquisition financing closing checklist.',
                'is_active': True,
            },
        )
        if not self.template.items.exists():
            DDTemplateItem.objects.create(
                template=self.template,
                sort_order=1,
                kind=DDTemplateItem.Kind.DD,
                title='Title commitment',
                description='',
                default_days_before_target_close=14,
            )
            DDTemplateItem.objects.create(
                template=self.template,
                sort_order=1,
                kind=DDTemplateItem.Kind.CP,
                title='Executed loan documents received',
                description='',
                default_days_before_target_close=0,
            )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_partial_unique_current_generation(self):
        package = ClosingPackage.objects.create(deal=self.deal)
        now = timezone.now()
        ClosingChecklistGeneration.objects.create(
            package=package,
            version=1,
            template_key='debt_acquisition',
            template_name='Debt acquisition',
            is_current=True,
            generated_at=now,
            supersede_reason='',
        )
        with self.assertRaises(Exception):
            ClosingChecklistGeneration.objects.create(
                package=package,
                version=2,
                template_key='debt_acquisition',
                template_name='Debt acquisition',
                is_current=True,
                generated_at=now,
                supersede_reason='',
            )

    def test_lifecycle_constraint_rejects_current_with_supersede_metadata(self):
        package = ClosingPackage.objects.create(deal=self.deal)
        with self.assertRaises(Exception):
            ClosingChecklistGeneration.objects.create(
                package=package,
                version=1,
                template_key='debt_acquisition',
                template_name='Debt acquisition',
                is_current=True,
                generated_at=timezone.now(),
                superseded_at=timezone.now() + timedelta(seconds=1),
                supersede_reason='nope',
            )

    def test_lifecycle_constraint_rejects_current_with_superseded_by(self):
        package = ClosingPackage.objects.create(deal=self.deal)
        with self.assertRaises(Exception):
            ClosingChecklistGeneration.objects.create(
                package=package,
                version=1,
                template_key='debt_acquisition',
                template_name='Debt acquisition',
                is_current=True,
                generated_at=timezone.now(),
                superseded_by=self.user,
                supersede_reason='',
            )

    def test_concurrent_custom_item_sort_allocation(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.user)
        barrier = threading.Barrier(5)
        errors = []

        def worker(title):
            try:
                barrier.wait(timeout=5)
                create_dd_item(self.deal, title=title, performed_by=self.user)
            except Exception as exc:
                errors.append(exc)
            finally:
                _close_thread_connections()

        threads = [
            threading.Thread(target=worker, args=(f'Custom {index}',))
            for index in range(5)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        generation = ClosingChecklistGeneration.objects.get(package__deal=self.deal, is_current=True)
        sorts = list(generation.dd_items.order_by('sort_order').values_list('sort_order', flat=True))
        self.assertEqual(len(sorts), len(set(sorts)))

    def test_concurrent_generation_attempts(self):
        barrier = threading.Barrier(2)
        errors = []
        results = []

        def worker():
            try:
                barrier.wait(timeout=5)
                generation = generate_closing_checklist(
                    self.deal,
                    self.template,
                    performed_by=self.user,
                )
                results.append(generation.version)
            except Exception as exc:
                errors.append(exc)
            finally:
                _close_thread_connections()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        # Under deal locking both workers succeed: versions 1 then 2, one current.
        self.assertEqual(sorted(results), [1, 2])
        self.assertEqual(errors, [])
        self.assertEqual(
            ClosingChecklistGeneration.objects.filter(package__deal=self.deal, is_current=True).count(),
            1,
        )
        self.assertEqual(
            ClosingChecklistGeneration.objects.get(package__deal=self.deal, is_current=True).version,
            2,
        )

    def test_stage_transition_racing_item_mutation(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.user)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        barrier = threading.Barrier(2)
        mutate_status = []
        leave_ok = []

        def mutate():
            try:
                barrier.wait(timeout=5)
                response = self.client.patch(
                    f'/api/dd-checklist-items/{item.pk}/',
                    {'status': 'in_progress'},
                    format='json',
                )
                mutate_status.append(response.status_code)
            finally:
                _close_thread_connections()

        def leave_closing():
            try:
                barrier.wait(timeout=5)
                with transaction.atomic():
                    deal = Deal.objects.select_for_update().get(pk=self.deal.pk)
                    deal.pipeline_status = PipelineStatus.CLOSED
                    deal.save(update_fields=['pipeline_status'])
                leave_ok.append(True)
            finally:
                _close_thread_connections()

        threads = [threading.Thread(target=mutate), threading.Thread(target=leave_closing)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(leave_ok, [True])
        self.assertEqual(len(mutate_status), 1)
        self.deal.refresh_from_db()
        item.refresh_from_db()
        # Valid outcome pairs under deal locking:
        # - mutate first (200) then leave Closing
        # - leave first then mutate rejects (400)
        if mutate_status[0] == 200:
            self.assertEqual(item.status, 'in_progress')
        else:
            self.assertEqual(mutate_status[0], 400)
            self.assertEqual(item.status, 'pending')
            self.assertEqual(self.deal.pipeline_status, PipelineStatus.CLOSED)

    def test_document_delete_racing_attachment(self):
        generate_closing_checklist(self.deal, self.template, performed_by=self.user)
        item = DDChecklistItem.objects.filter(generation__package__deal=self.deal).first()
        doc = Document.objects.create(
            deal=self.deal,
            document_name='Evidence.pdf',
            category='closing_docs',
            version=1,
            file_url='closing/evidence.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.READY,
            visibility_roles=['internal'],
            uploaded_by=self.user,
        )
        barrier = threading.Barrier(2)
        attach_errors = []
        delete_status = []

        def attach():
            try:
                barrier.wait(timeout=5)
                set_dd_documents(item, [str(doc.pk)], performed_by=self.user, user=self.user)
            except Exception as exc:
                attach_errors.append(exc)
            finally:
                _close_thread_connections()

        def delete_doc():
            try:
                barrier.wait(timeout=5)
                response = self.client.delete(f'/api/documents/{doc.pk}/')
                delete_status.append(response.status_code)
            finally:
                _close_thread_connections()

        threads = [threading.Thread(target=attach), threading.Thread(target=delete_doc)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(len(delete_status), 1)
        linked = Document.objects.filter(pk=doc.pk, dd_checklist_items=item).exists()
        doc_exists = Document.objects.filter(pk=doc.pk).exists()

        # Valid outcome pairs:
        # A) attach wins → delete blocked (400), doc remains linked
        # B) delete wins → attach fails (document unavailable), doc gone
        if delete_status[0] == 400:
            self.assertTrue(linked)
            self.assertTrue(doc_exists)
            self.assertEqual(attach_errors, [])
        elif delete_status[0] == 204:
            self.assertFalse(doc_exists)
            self.assertEqual(len(attach_errors), 1)
            self.assertIsInstance(attach_errors[0], ValidationError)
        else:
            self.fail(f'Unexpected delete status {delete_status[0]}')

    def test_document_complete_racing_delete(self):
        doc = Document.objects.create(
            deal=self.deal,
            document_name='Pending.pdf',
            category='closing_docs',
            version=1,
            file_url='closing/pending.pdf',
            file_type='pdf',
            storage_status=DocumentStorageStatus.PENDING,
            visibility_roles=['internal'],
            uploaded_by=self.user,
        )
        barrier = threading.Barrier(2)
        complete_status = []
        delete_status = []

        def complete():
            try:
                barrier.wait(timeout=5)
                response = self.client.post(f'/api/documents/{doc.pk}/complete/', {}, format='json')
                complete_status.append(response.status_code)
            finally:
                _close_thread_connections()

        def delete_doc():
            try:
                barrier.wait(timeout=5)
                response = self.client.delete(f'/api/documents/{doc.pk}/')
                delete_status.append(response.status_code)
            finally:
                _close_thread_connections()

        threads = [threading.Thread(target=complete), threading.Thread(target=delete_doc)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(len(complete_status), 1)
        self.assertEqual(len(delete_status), 1)
        exists = Document.objects.filter(pk=doc.pk).exists()
        # Under deal-first locking one writer wins cleanly: either ready doc remains
        # or the row is gone. Never leave a pending row after a successful complete.
        if exists:
            refreshed = Document.objects.get(pk=doc.pk)
            self.assertEqual(refreshed.storage_status, DocumentStorageStatus.READY)
            self.assertIn(complete_status[0], {200, 409})
            self.assertIn(delete_status[0], {400, 404, 204, 409})
        else:
            self.assertEqual(delete_status[0], 204)
            self.assertIn(complete_status[0], {404, 409, 422})
