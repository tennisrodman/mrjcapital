# Generated manually for a timestamp-preserving stage-history backfill.
# Deployment requirement: drain writes from the pre-0007 application before
# applying this migration and keep them drained until the service code that
# writes DealStageEvent is live. Old workers do not maintain the new history,
# so an overlapping rolling deploy would require a post-deploy reconciliation.

import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


PIPELINE_STATUSES = {
    'sourced',
    'screening',
    'quoting',
    'negotiating',
    'signed',
    'closing',
    'closed',
    'servicing',
    'on_hold',
    'dead',
    'exited',
}


def _pipeline_transition(activity):
    metadata = activity.metadata if isinstance(activity.metadata, dict) else {}
    if metadata.get('field') != 'pipeline_status':
        return None
    from_status = metadata.get('from') or activity.old_value or None
    to_status = metadata.get('to') or activity.new_value or None
    if to_status not in PIPELINE_STATUSES:
        return None
    if from_status not in PIPELINE_STATUSES:
        from_status = None
    return from_status, to_status


def _not_after(timestamp, latest):
    if timestamp and latest and timestamp > latest:
        return latest
    return timestamp or latest


def backfill_stage_history(apps, schema_editor):
    Deal = apps.get_model('api', 'Deal')
    DealStageEvent = apps.get_model('api', 'DealStageEvent')
    ActivityLog = apps.get_model('api', 'ActivityLog')

    for deal in Deal.objects.all().iterator(chunk_size=200):
        transitions = []
        activities = (
            ActivityLog.objects.filter(deal_id=deal.pk, action_type='status_change')
            .order_by('performed_at', 'id')
            .iterator(chunk_size=200)
        )
        for activity in activities:
            transition = _pipeline_transition(activity)
            if transition:
                transitions.append((transition[0], transition[1], activity))

        events = []
        if transitions:
            first_from_status, _, first_activity = transitions[0]
            initial_status = first_from_status or 'sourced'
            initial_entered_at = _not_after(deal.created_at, first_activity.performed_at)
            current_event = DealStageEvent(
                deal_id=deal.pk,
                from_status=None,
                to_status=initial_status,
                entered_at=initial_entered_at,
            )
            events.append(current_event)

            for from_status, to_status, activity in transitions:
                if to_status == current_event.to_status:
                    continue
                transition_at = _not_after(activity.performed_at, activity.performed_at)
                if transition_at < current_event.entered_at:
                    transition_at = current_event.entered_at
                current_event.exited_at = transition_at
                current_event = DealStageEvent(
                    deal_id=deal.pk,
                    from_status=from_status or events[-1].to_status,
                    to_status=to_status,
                    entered_at=transition_at,
                    performed_by_id=activity.performed_by_id,
                    reason=activity.reason or '',
                )
                events.append(current_event)

            # A direct historical write may not have an ActivityLog row. Keep
            # the source facts honest by creating a conservative, un-attributed
            # event from the best timestamp still available on the Deal row.
            if current_event.to_status != deal.pipeline_status:
                inferred_entered_at = deal.updated_at or current_event.entered_at
                if inferred_entered_at < current_event.entered_at:
                    inferred_entered_at = current_event.entered_at
                current_event.exited_at = inferred_entered_at
                current_event = DealStageEvent(
                    deal_id=deal.pk,
                    from_status=events[-1].to_status,
                    to_status=deal.pipeline_status,
                    entered_at=inferred_entered_at,
                )
                events.append(current_event)
        else:
            entered_at = deal.created_at or deal.updated_at
            if deal.pipeline_status != 'sourced':
                entered_at = deal.updated_at or entered_at
            current_event = DealStageEvent(
                deal_id=deal.pk,
                from_status=None,
                to_status=deal.pipeline_status,
                entered_at=entered_at,
            )
            events.append(current_event)

        DealStageEvent.objects.bulk_create(events)
        Deal.objects.filter(pk=deal.pk).update(current_stage_entered_at=current_event.entered_at)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0006_dealnote'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='deal',
            name='current_stage_entered_at',
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.CreateModel(
            name='DealStageEvent',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('from_status', models.CharField(blank=True, choices=[('sourced', 'Sourced'), ('screening', 'Screening'), ('quoting', 'Quoting'), ('negotiating', 'Negotiating'), ('signed', 'Signed'), ('closing', 'Closing'), ('closed', 'Closed'), ('servicing', 'Servicing'), ('on_hold', 'On hold'), ('dead', 'Dead'), ('exited', 'Exited')], max_length=24, null=True)),
                ('to_status', models.CharField(choices=[('sourced', 'Sourced'), ('screening', 'Screening'), ('quoting', 'Quoting'), ('negotiating', 'Negotiating'), ('signed', 'Signed'), ('closing', 'Closing'), ('closed', 'Closed'), ('servicing', 'Servicing'), ('on_hold', 'On hold'), ('dead', 'Dead'), ('exited', 'Exited')], db_index=True, max_length=24)),
                ('entered_at', models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ('exited_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('reason', models.TextField(blank=True)),
                ('is_override', models.BooleanField(default=False)),
                ('deal', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='stage_events', to='api.deal')),
                ('performed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='stage_events', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-entered_at', '-id'],
            },
        ),
        migrations.AddIndex(
            model_name='dealstageevent',
            index=models.Index(fields=['deal', '-entered_at'], name='api_stage_deal_entered_idx'),
        ),
        migrations.AddIndex(
            model_name='dealstageevent',
            index=models.Index(fields=['to_status', '-entered_at'], name='api_stage_status_entered_idx'),
        ),
        migrations.AddConstraint(
            model_name='dealstageevent',
            constraint=models.CheckConstraint(
                condition=models.Q(exited_at__isnull=True) | models.Q(exited_at__gte=models.F('entered_at')),
                name='stage_event_exit_after_entry',
            ),
        ),
        migrations.AddConstraint(
            model_name='dealstageevent',
            constraint=models.UniqueConstraint(
                condition=models.Q(exited_at__isnull=True),
                fields=('deal',),
                name='unique_open_stage_event_per_deal',
            ),
        ),
        migrations.RunPython(backfill_stage_history, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='deal',
            name='current_stage_entered_at',
            field=models.DateTimeField(db_index=True, default=django.utils.timezone.now),
        ),
    ]
