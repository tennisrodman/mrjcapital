import json
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.models import PipelineStatus
from api.services.lifecycle_scenarios import (
    build_lifecycle_scenario,
    scenario_summary,
)
from api.services.storage import get_document_storage


class Command(BaseCommand):
    help = 'Exercise the real deal lifecycle services; rolls back unless --commit is supplied.'

    def add_arguments(self, parser):
        parser.add_argument('--actor', required=True, help='Existing staff username used for audit evidence.')
        parser.add_argument('--commit', action='store_true', help='Persist the scenario in the development database.')
        parser.add_argument('--scenario-key', help='Stable key for a committed run; generated for rollback runs.')

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError('Lifecycle scenarios are disabled unless DEBUG=True.')
        if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') != 'local':
            raise CommandError('Lifecycle scenarios require DOCUMENT_STORAGE_BACKEND=local.')
        actor = get_user_model().objects.filter(username=options['actor'], is_staff=True).first()
        if actor is None:
            raise CommandError('Actor must be an existing staff user.')
        scenario_key = options.get('scenario_key') or f'lifecycle-exercise-{uuid.uuid4()}'
        if options['commit'] and not options.get('scenario_key'):
            scenario_key = 'lifecycle-exercise-v1'

        result = None
        with transaction.atomic():
            result = build_lifecycle_scenario(
                actor=actor,
                scenario_key=scenario_key,
                target_status=PipelineStatus.EXITED,
                assert_gates=True,
            )
            summary = scenario_summary(result)
            if not options['commit']:
                transaction.set_rollback(True)

        if not options['commit'] and result and result.created:
            storage = get_document_storage()
            for key in result.storage_keys:
                storage.delete_object(key)
            summary['rolled_back'] = True
        else:
            summary['rolled_back'] = False
        self.stdout.write(json.dumps(summary, sort_keys=True))
