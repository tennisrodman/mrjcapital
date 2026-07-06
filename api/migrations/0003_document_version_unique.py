from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_document_storage_fields'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='document',
            constraint=models.UniqueConstraint(
                fields=('deal', 'category', 'document_name', 'version'),
                name='unique_document_version',
            ),
        ),
    ]
