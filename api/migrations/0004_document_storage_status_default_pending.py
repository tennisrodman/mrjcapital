from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_document_version_unique'),
    ]

    operations = [
        migrations.AlterField(
            model_name='document',
            name='storage_status',
            field=models.CharField(
                choices=[('pending', 'Pending upload'), ('ready', 'Ready'), ('failed', 'Failed')],
                db_index=True,
                default='pending',
                max_length=16,
            ),
        ),
    ]
