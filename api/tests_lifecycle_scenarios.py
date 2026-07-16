import json
import tempfile
from io import StringIO
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from api.models import (
    ActivityLog,
    Deal,
    DocumentCategory,
    DocumentStorageStatus,
    PipelineStatus,
    Quote,
)
from api.services.lifecycle_scenarios import (
    DEFAULT_MANIFEST_PATH,
    build_lifecycle_scenario,
    load_workflow_manifest,
)


User = get_user_model()


class LifecycleScenarioTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings = override_settings(
            DEBUG=True,
            DOCUMENT_STORAGE_BACKEND='local',
            MEDIA_ROOT=self.media.name,
        )
        self.settings.enable()
        self.actor = User.objects.create_user(
            'scenario-staff',
            password='pw',
            is_staff=True,
        )

    def tearDown(self):
        self.settings.disable()
        self.media.cleanup()

    def test_full_scenario_uses_real_guards_and_creates_truthful_evidence(self):
        result = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-full-path',
            target_status=PipelineStatus.EXITED,
        )
        deal = result.deal
        self.assertEqual(deal.pipeline_status, PipelineStatus.EXITED)
        self.assertEqual(deal.screening_assessments.count(), 1)
        self.assertEqual(deal.quotes.count(), 2)
        executed = deal.quotes.get(status=Quote.Status.EXECUTED)
        evidence = executed.attachments.get()
        self.assertEqual(evidence.category, DocumentCategory.LEGAL)
        self.assertEqual(evidence.subcategory, 'term_sheet')
        self.assertEqual(evidence.storage_status, DocumentStorageStatus.READY)
        self.assertTrue(evidence.is_executed)
        self.assertEqual(len(evidence.checksum_sha256), 64)
        self.assertTrue((Path(self.media.name) / 'deal-documents' / evidence.file_url).is_file())
        self.assertEqual(deal.stage_events.count(), 9)
        self.assertEqual(
            deal.stage_events.get(exited_at__isnull=True).to_status,
            PipelineStatus.EXITED,
        )
        self.assertGreaterEqual(ActivityLog.objects.filter(deal=deal).count(), 30)
        package = deal.closing_package
        generation = package.generations.get(is_current=True)
        self.assertFalse(generation.dd_items.exclude(status='complete').exists())
        self.assertFalse(generation.conditions_precedent.exclude(status='satisfied').exists())
        closing_evidence = deal.documents.get(details__evidence_kind='closing')
        self.assertEqual(closing_evidence.category, DocumentCategory.CLOSING_DOCS)
        self.assertEqual(closing_evidence.storage_status, DocumentStorageStatus.READY)
        self.assertFalse(generation.dd_items.exclude(documents=closing_evidence).exists())
        self.assertFalse(generation.conditions_precedent.exclude(documents=closing_evidence).exists())

    def test_scenario_key_is_append_only_and_idempotent(self):
        first = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-idempotent',
            target_status=PipelineStatus.SOURCED,
        )
        counts = (Deal.objects.count(), ActivityLog.objects.count())
        second = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-idempotent',
            target_status=PipelineStatus.SOURCED,
        )
        self.assertTrue(first.created)
        self.assertFalse(second.created)
        self.assertEqual(counts, (Deal.objects.count(), ActivityLog.objects.count()))
        self.assertEqual(first.deal.pk, second.deal.pk)

    def test_exercise_command_rolls_back_database_and_blob_by_default(self):
        stdout = StringIO()
        call_command(
            'exercise_deal_lifecycle',
            actor=self.actor.username,
            scenario_key='test-command-rollback',
            stdout=stdout,
        )
        payload = json.loads(stdout.getvalue())
        self.assertTrue(payload['rolled_back'])
        self.assertFalse(Deal.objects.filter(details__scenario_key='test-command-rollback').exists())
        storage_root = Path(self.media.name) / 'deal-documents'
        leftovers = list(storage_root.rglob('*')) if storage_root.exists() else []
        self.assertEqual(leftovers, [])

    def test_seed_command_is_idempotent_for_a_named_stage(self):
        for _ in range(2):
            call_command(
                'seed_development_scenarios',
                actor=self.actor.username,
                target=[PipelineStatus.SOURCED],
                stdout=StringIO(),
            )
        self.assertEqual(
            Deal.objects.filter(details__scenario_key='development-lifecycle-v1-sourced').count(),
            1,
        )

    def test_rollback_command_does_not_delete_existing_scenario_evidence(self):
        existing = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-existing-command',
            target_status=PipelineStatus.EXITED,
        )
        evidence = existing.deal.documents.get(details__evidence_kind='quote_execution')
        blob = Path(self.media.name) / 'deal-documents' / evidence.file_url
        self.assertTrue(blob.is_file())
        call_command(
            'exercise_deal_lifecycle',
            actor=self.actor.username,
            scenario_key='test-existing-command',
            stdout=StringIO(),
        )
        self.assertTrue(blob.is_file())
        self.assertTrue(Deal.objects.filter(pk=existing.deal.pk).exists())

    def test_existing_key_cannot_silently_change_target(self):
        build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-target-collision',
            target_status=PipelineStatus.SOURCED,
        )
        with self.assertRaises(ValidationError):
            build_lifecycle_scenario(
                actor=self.actor,
                scenario_key='test-target-collision',
                target_status=PipelineStatus.EXITED,
            )

    @override_settings(DEBUG=False)
    def test_service_itself_rejects_non_debug_use(self):
        with self.assertRaises(ValidationError):
            build_lifecycle_scenario(
                actor=self.actor,
                scenario_key='test-production-guard',
                target_status=PipelineStatus.SOURCED,
            )

    def test_service_rejects_nonstaff_actor(self):
        analyst = User.objects.create_user('scenario-analyst', password='pw')
        with self.assertRaises(ValidationError):
            build_lifecycle_scenario(
                actor=analyst,
                scenario_key='test-nonstaff-guard',
                target_status=PipelineStatus.SOURCED,
            )

    def test_idempotent_reuse_rejects_missing_evidence_blob(self):
        result = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-blob-integrity',
            target_status=PipelineStatus.NEGOTIATING,
        )
        evidence = result.deal.documents.get()
        blob = Path(self.media.name) / 'deal-documents' / evidence.file_url
        blob.unlink()
        with self.assertRaises(ValidationError):
            build_lifecycle_scenario(
                actor=self.actor,
                scenario_key='test-blob-integrity',
                target_status=PipelineStatus.NEGOTIATING,
            )

    def test_default_manifest_is_versioned_and_has_stable_fingerprints(self):
        first = load_workflow_manifest()
        second = load_workflow_manifest(DEFAULT_MANIFEST_PATH)
        self.assertEqual(first.schema_version, 1)
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual(
            [scenario.fingerprint for scenario in first.scenarios],
            [scenario.fingerprint for scenario in second.scenarios],
        )
        self.assertEqual(
            {scenario.target for scenario in first.scenarios},
            set(PipelineStatus.values) & {
                PipelineStatus.SOURCED,
                PipelineStatus.SCREENING,
                PipelineStatus.QUOTING,
                PipelineStatus.NEGOTIATING,
                PipelineStatus.SIGNED,
                PipelineStatus.CLOSING,
                PipelineStatus.CLOSED,
                PipelineStatus.SERVICING,
                PipelineStatus.EXITED,
            },
        )

    def test_manifest_rejects_schema_mismatch_and_protected_fields(self):
        raw = json.loads(DEFAULT_MANIFEST_PATH.read_text(encoding='utf-8'))
        schema_path = Path(self.media.name) / 'wrong-schema.json'
        schema_path.write_text(json.dumps({**raw, 'schema_version': 2}), encoding='utf-8')
        with self.assertRaises(ValidationError):
            load_workflow_manifest(schema_path)

        raw['inputs']['deal']['pipeline_status'] = PipelineStatus.CLOSED
        protected_path = Path(self.media.name) / 'protected.json'
        protected_path.write_text(json.dumps(raw), encoding='utf-8')
        with self.assertRaises(ValidationError):
            load_workflow_manifest(protected_path)

    def test_manifest_rejects_unsupported_historical_investment_type(self):
        raw = json.loads(DEFAULT_MANIFEST_PATH.read_text(encoding='utf-8'))
        raw['inputs']['deal']['investment_type'] = 'mezzanine'
        path = Path(self.media.name) / 'unsupported-investment-type.json'
        path.write_text(json.dumps(raw), encoding='utf-8')

        with self.assertRaises(ValidationError) as caught:
            load_workflow_manifest(path)

        self.assertIn('inputs.deal.investment_type', caught.exception.message_dict)

    def test_idempotent_reuse_rejects_manifest_owned_business_drift(self):
        result = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-business-drift',
            target_status=PipelineStatus.QUOTING,
        )
        Deal.objects.filter(pk=result.deal.pk).update(requested_amount='8000000.00')

        with self.assertRaises(ValidationError) as caught:
            build_lifecycle_scenario(
                actor=self.actor,
                scenario_key='test-business-drift',
                target_status=PipelineStatus.QUOTING,
            )

        self.assertIn('inputs.deal', caught.exception.message_dict)

    def test_idempotent_reuse_rejects_master_and_workflow_drift(self):
        result = build_lifecycle_scenario(
            actor=self.actor,
            scenario_key='test-state-drift',
            target_status=PipelineStatus.NEGOTIATING,
        )
        result.deal.sponsor.__class__.objects.filter(pk=result.deal.sponsor_id).update(
            entity_name='Modified sponsor',
        )
        with self.assertRaises(ValidationError) as caught:
            build_lifecycle_scenario(
                actor=self.actor,
                scenario_key='test-state-drift',
                target_status=PipelineStatus.NEGOTIATING,
            )
        self.assertIn('masters.sponsor', caught.exception.message_dict)

        result.deal.sponsor.__class__.objects.filter(pk=result.deal.sponsor_id).update(
            entity_name='Lifecycle Scenario Sponsor LLC',
        )
        Quote.objects.filter(deal=result.deal, version=2).update(interest_rate='7.5000')
        with self.assertRaises(ValidationError) as caught:
            build_lifecycle_scenario(
                actor=self.actor,
                scenario_key='test-state-drift',
                target_status=PipelineStatus.NEGOTIATING,
            )
        self.assertIn('inputs.quote.counter', caught.exception.message_dict)

    def test_custom_manifest_fingerprint_is_idempotent_and_detects_drift(self):
        raw = json.loads(DEFAULT_MANIFEST_PATH.read_text(encoding='utf-8'))
        raw['scenarios'] = [{'key': 'custom-manifest-sourced', 'target': PipelineStatus.SOURCED}]
        path = Path(self.media.name) / 'custom-workflow.json'
        path.write_text(json.dumps(raw), encoding='utf-8')
        first_stdout = StringIO()
        call_command(
            'seed_development_scenarios',
            actor=self.actor.username,
            manifest=str(path),
            stdout=first_stdout,
        )
        first_payload = json.loads(first_stdout.getvalue())
        deal = Deal.objects.get(details__scenario_key='custom-manifest-sourced')
        counts = (Deal.objects.count(), ActivityLog.objects.count())
        self.assertEqual(deal.details['manifest_fingerprint'], first_payload['manifest_fingerprint'])

        second_stdout = StringIO()
        call_command(
            'seed_development_scenarios',
            actor=self.actor.username,
            manifest=str(path),
            stdout=second_stdout,
        )
        self.assertFalse(json.loads(second_stdout.getvalue())['scenarios'][0]['created'])
        self.assertEqual(counts, (Deal.objects.count(), ActivityLog.objects.count()))

        raw['inputs']['deal']['description'] = 'Changed without a new scenario identity.'
        path.write_text(json.dumps(raw), encoding='utf-8')
        with self.assertRaises(CommandError):
            call_command(
                'seed_development_scenarios',
                actor=self.actor.username,
                manifest=str(path),
                stdout=StringIO(),
            )
        self.assertEqual(counts, (Deal.objects.count(), ActivityLog.objects.count()))
