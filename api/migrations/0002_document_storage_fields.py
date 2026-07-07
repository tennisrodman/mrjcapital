from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='subcategory',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='document',
            name='content_type',
            field=models.CharField(blank=True, max_length=127),
        ),
        migrations.AddField(
            model_name='document',
            name='file_size_bytes',
            field=models.PositiveBigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='document',
            name='checksum_sha256',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='document',
            name='storage_status',
            field=models.CharField(
                choices=[('pending', 'Pending upload'), ('ready', 'Ready'), ('failed', 'Failed')],
                db_index=True,
                default='pending',
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name='document',
            name='pipeline_stage_at_upload',
            field=models.CharField(
                blank=True,
                choices=[
                    ('sourced', 'Sourced'),
                    ('screening', 'Screening'),
                    ('quoting', 'Quoting'),
                    ('negotiating', 'Negotiating'),
                    ('signed', 'Signed'),
                    ('closing', 'Closing'),
                    ('closed', 'Closed'),
                    ('servicing', 'Servicing'),
                    ('on_hold', 'On hold'),
                    ('dead', 'Dead'),
                    ('exited', 'Exited'),
                ],
                max_length=24,
                null=True,
            ),
        ),
        migrations.AddIndex(
            model_name='document',
            index=models.Index(fields=['deal', 'storage_status'], name='api_documen_deal_id_stor_idx'),
        ),
        migrations.AddIndex(
            model_name='document',
            index=models.Index(fields=['storage_status', 'uploaded_date'], name='api_documen_storag_upl_idx'),
        ),
    ]
