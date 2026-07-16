from django.core.validators import MinValueValidator
from django.db import migrations, models


def normalize_zero_interest_reserve(apps, schema_editor):
    Quote = apps.get_model('api', 'Quote')
    Quote.objects.filter(interest_reserve_months=0).update(
        interest_reserve_months=None,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0018_alter_activitylog_action_type_documentblobdeletion'),
    ]

    operations = [
        migrations.RunPython(
            normalize_zero_interest_reserve,
            migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name='quote',
            name='interest_reserve_months',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                validators=[MinValueValidator(1)],
            ),
        ),
        migrations.AddConstraint(
            model_name='quote',
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(interest_reserve_months__isnull=True)
                    | models.Q(interest_reserve_months__gt=0)
                ),
                name='quote_interest_reserve_positive',
            ),
        ),
    ]
