import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from api.services.lifecycle_scenarios import (
    SUPPORTED_TARGETS,
    build_lifecycle_scenario,
    load_workflow_manifest,
    scenario_summary,
)


class Command(BaseCommand):
    help = 'Seed append-only, service-driven lifecycle examples into a local development database.'

    def add_arguments(self, parser):
        parser.add_argument('--actor', required=True, help='Existing staff username used for audit evidence.')
        parser.add_argument(
            '--manifest',
            help='Versioned workflow manifest path. Defaults to shared/workflow_seed.v1.json.',
        )
        parser.add_argument(
            '--target',
            action='append',
            choices=SUPPORTED_TARGETS,
            help='Pipeline stage to seed; may be repeated. Defaults to every manifest scenario.',
        )

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('Development scenario seeding is disabled unless DEBUG=True.')
        if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') != 'local':
            raise CommandError('Development scenarios require DOCUMENT_STORAGE_BACKEND=local.')
        actor = get_user_model().objects.filter(username=options['actor'], is_staff=True).first()
        if actor is None:
            raise CommandError('Actor must be an existing staff user.')
        try:
            manifest = load_workflow_manifest(options.get('manifest'))
        except ValidationError as exc:
            raise CommandError('; '.join(exc.messages)) from exc
        targets = set(options.get('target') or [])
        scenarios = [
            scenario
            for scenario in manifest.scenarios
            if not targets or scenario.target in targets
        ]
        if targets and targets - {scenario.target for scenario in scenarios}:
            missing = ', '.join(sorted(targets - {scenario.target for scenario in scenarios}))
            raise CommandError(f'Manifest has no scenario for target(s): {missing}.')
        summaries = []
        try:
            for scenario in scenarios:
                result = build_lifecycle_scenario(
                    actor=actor,
                    scenario_key=scenario.key,
                    target_status=scenario.target,
                    assert_gates=True,
                    manifest=manifest,
                )
                summaries.append(scenario_summary(result))
        except ValidationError as exc:
            raise CommandError('; '.join(exc.messages)) from exc
        self.stdout.write(json.dumps({
            'dataset_key': manifest.dataset_key,
            'schema_version': manifest.schema_version,
            'manifest_fingerprint': manifest.fingerprint,
            'manifest_path': str(manifest.path),
            'scenarios': summaries,
        }, sort_keys=True))
