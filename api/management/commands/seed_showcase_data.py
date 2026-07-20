import json

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from api.services.showcase_seed import (
    load_showcase_manifest,
    seed_showcase_dataset,
)


class Command(BaseCommand):
    help = (
        'Preview or apply the versioned MRJ showcase dataset. '
        'The command is a dry run unless --apply is supplied.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--actor',
            required=True,
            help='Existing active staff username assigned to showcase deals.',
        )
        parser.add_argument(
            '--manifest',
            help=(
                'Versioned showcase manifest path. '
                'Defaults to shared/showcase_seed.v1.json.'
            ),
        )
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            '--dry-run',
            action='store_true',
            help=(
                'Validate and execute the complete seed in a rolled-back '
                'transaction (default).'
            ),
        )
        mode.add_argument(
            '--apply',
            action='store_true',
            help='Commit the showcase dataset.',
        )

    def handle(self, *args, **options):
        actor = get_user_model().objects.filter(
            username=options['actor'],
            is_active=True,
            is_staff=True,
        ).first()
        if actor is None:
            raise CommandError('Actor must be an existing active staff user.')
        try:
            manifest = load_showcase_manifest(options.get('manifest'))
            with transaction.atomic():
                result = seed_showcase_dataset(actor=actor, manifest=manifest)
                if not options['apply']:
                    transaction.set_rollback(True)
        except ValidationError as exc:
            messages = getattr(exc, 'message_dict', None)
            if messages:
                detail = '; '.join(
                    f'{field}: {", ".join(values)}'
                    for field, values in messages.items()
                )
            else:
                detail = '; '.join(exc.messages)
            raise CommandError(detail) from exc

        payload = {
            'mode': 'apply' if options['apply'] else 'dry-run',
            'applied': bool(options['apply']),
            'rolled_back': not options['apply'],
            'dataset_key': result.dataset_key,
            'schema_version': manifest.schema_version,
            'manifest_path': str(manifest.path),
            'created': result.created,
            'existing': result.existing,
            'pipeline': result.pipeline,
        }
        self.stdout.write(json.dumps(payload, sort_keys=True))
