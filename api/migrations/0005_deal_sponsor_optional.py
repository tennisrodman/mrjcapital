import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_document_version_unique'),
    ]

    operations = [
        migrations.AlterField(
            model_name='deal',
            name='sponsor',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='deals',
                to='api.sponsor',
            ),
        ),
    ]
