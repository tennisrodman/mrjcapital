import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.db.models.functions.text


def backfill_party_contacts(apps, schema_editor):
    Contact = apps.get_model('api', 'Contact')
    DealContact = apps.get_model('api', 'DealContact')
    Deal = apps.get_model('api', 'Deal')

    def contact_for(*, email, full_name, company_name, phone):
        normalized_email = (email or '').lower()
        lookup = {'email': normalized_email}
        if not normalized_email:
            lookup.update(full_name=full_name, company_name=company_name)
        contact, _ = Contact.objects.get_or_create(
            **lookup,
            defaults={
                'full_name': full_name,
                'company_name': company_name,
                'phone': phone,
            },
        )
        return contact

    for deal in Deal.objects.select_related('sponsor', 'broker').iterator():
        if deal.sponsor_id:
            sponsor = deal.sponsor
            contact = contact_for(
                email=sponsor.primary_contact_email,
                full_name=sponsor.primary_contact_name,
                company_name=sponsor.entity_name,
                phone=sponsor.primary_contact_phone,
            )
            DealContact.objects.get_or_create(
                deal=deal,
                contact=contact,
                role='sponsor_contact',
                defaults={'is_primary': True},
            )
        if deal.broker_id:
            broker = deal.broker
            contact = contact_for(
                email=broker.email,
                full_name=broker.contact_name,
                company_name=broker.company_name,
                phone=broker.phone,
            )
            DealContact.objects.get_or_create(
                deal=deal,
                contact=contact,
                role='broker_contact',
                defaults={'is_primary': True},
            )


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_screening'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Contact',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('full_name', models.CharField(db_index=True, max_length=255)),
                ('title', models.CharField(blank=True, max_length=160)),
                ('company_name', models.CharField(blank=True, db_index=True, max_length=255)),
                ('email', models.EmailField(blank=True, db_index=True, max_length=254)),
                ('phone', models.CharField(blank=True, max_length=40)),
                ('details', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_contacts', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['full_name', 'company_name', 'id'],
                'constraints': [
                    models.UniqueConstraint(
                        django.db.models.functions.text.Lower('email'),
                        condition=~models.Q(email=''),
                        name='contact_email_ci_unique',
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name='DealContact',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('role', models.CharField(choices=[
                    ('source_contact', 'Source contact'),
                    ('sponsor_contact', 'Sponsor contact'),
                    ('broker_contact', 'Broker contact'),
                    ('borrower_counsel', 'Borrower counsel'),
                    ('lender_counsel', 'Lender counsel'),
                    ('closing_contact', 'Closing contact'),
                ], db_index=True, max_length=32)),
                ('is_primary', models.BooleanField(default=False)),
                ('notes', models.TextField(blank=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('contact', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='deal_links', to='api.contact')),
                ('deal', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='contact_links', to='api.deal')),
            ],
            options={
                'ordering': ['deal', 'role', '-is_primary', 'contact__full_name'],
                'indexes': [
                    models.Index(fields=['deal', 'role'], name='api_dealcon_deal_id_role_idx'),
                    models.Index(fields=['contact', 'role'], name='api_dealcon_contact_role_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(fields=('deal', 'contact', 'role'), name='unique_deal_contact_role'),
                    models.UniqueConstraint(condition=models.Q(is_primary=True), fields=('deal', 'role'), name='unique_primary_contact_per_deal_role'),
                ],
            },
        ),
        migrations.RunPython(backfill_party_contacts, migrations.RunPython.noop),
    ]
