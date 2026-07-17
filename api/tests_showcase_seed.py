import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from api.models import (
    ActivityLog,
    Broker,
    Deal,
    DealStageEvent,
    Fund,
    Property,
    Sponsor,
)
from api.services.showcase_seed import load_showcase_manifest


User = get_user_model()


class ShowcaseSeedCommandTests(TestCase):
    def setUp(self):
        self.actor = User.objects.create_user(
            username='showcase-staff',
            password='pw',
            is_staff=True,
        )

    def run_command(self, **options):
        stdout = StringIO()
        call_command(
            'seed_showcase_data',
            actor=self.actor.username,
            stdout=stdout,
            **options,
        )
        return json.loads(stdout.getvalue())

    def test_default_mode_is_a_complete_rolled_back_dry_run(self):
        payload = self.run_command()

        self.assertEqual(payload['mode'], 'dry-run')
        self.assertTrue(payload['rolled_back'])
        self.assertEqual(payload['created']['deals'], 14)
        self.assertEqual(payload['created']['properties'], 15)
        self.assertEqual(payload['pipeline']['sourced'], 2)
        self.assertEqual(payload['pipeline']['quoting'], 2)
        self.assertEqual(Deal.objects.count(), 0)
        self.assertEqual(Sponsor.objects.count(), 0)
        self.assertEqual(ActivityLog.objects.count(), 0)

    @override_settings(DEBUG=False)
    def test_apply_is_production_safe_idempotent_and_stage_complete(self):
        first = self.run_command(apply=True)

        self.assertTrue(first['applied'])
        self.assertFalse(first['rolled_back'])
        self.assertEqual(first['created'], {
            'brokers': 4,
            'deals': 14,
            'funds': 2,
            'properties': 15,
            'sponsors': 6,
        })
        self.assertEqual(Deal.objects.count(), 14)
        self.assertEqual(Sponsor.objects.count(), 6)
        self.assertEqual(Broker.objects.count(), 4)
        self.assertEqual(Fund.objects.count(), 2)
        self.assertEqual(Property.objects.count(), 15)
        self.assertEqual(ActivityLog.objects.count(), 14)
        self.assertEqual(DealStageEvent.objects.filter(exited_at__isnull=True).count(), 14)
        self.assertEqual(
            set(Deal.objects.values_list('pipeline_status', flat=True)),
            {
                'sourced', 'screening', 'quoting', 'negotiating', 'signed',
                'closing', 'closed', 'servicing', 'on_hold', 'dead', 'exited',
            },
        )

        counts = {
            'deals': Deal.objects.count(),
            'activities': ActivityLog.objects.count(),
            'stages': DealStageEvent.objects.count(),
        }
        second = self.run_command(apply=True)
        self.assertEqual(second['created'], {
            'brokers': 0,
            'deals': 0,
            'funds': 0,
            'properties': 0,
            'sponsors': 0,
        })
        self.assertEqual(second['existing']['deals'], 14)
        self.assertEqual(counts, {
            'deals': Deal.objects.count(),
            'activities': ActivityLog.objects.count(),
            'stages': DealStageEvent.objects.count(),
        })

    def test_conflict_aborts_the_whole_apply(self):
        manifest = load_showcase_manifest()
        cobalt = manifest.sections['sponsors'][0]
        Sponsor.objects.create(
            pk=cobalt['id'],
            entity_name='Conflicting Sponsor',
            entity_type='llc',
            primary_contact_name='Conflict',
            primary_contact_email='conflict@example.com',
            relationship_rating='new',
        )

        with self.assertRaises(CommandError) as caught:
            self.run_command(apply=True)

        self.assertIn('conflicts with showcase data', str(caught.exception))
        self.assertEqual(Sponsor.objects.count(), 1)
        self.assertEqual(Broker.objects.count(), 0)
        self.assertEqual(Deal.objects.count(), 0)

    def test_actor_must_be_active_staff(self):
        self.actor.is_staff = False
        self.actor.save(update_fields=['is_staff'])

        with self.assertRaises(CommandError):
            self.run_command(apply=True)
