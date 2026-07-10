from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APITestCase

from api.models import Deal
from api.models.contact import Contact, DealContact, DealContactRole


class ContactApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.staff = User.objects.create_user('staff-contact', password='test', is_staff=True)
        self.analyst = User.objects.create_user('analyst-contact', password='test')
        self.other = User.objects.create_user('other-contact', password='test')
        self.deal = Deal.objects.create(
            name='Contact Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='1000000.00',
            assigned_analyst=self.analyst,
        )

    def test_contact_email_is_normalized_and_duplicate_rejected(self):
        self.client.force_authenticate(self.staff)
        created = self.client.post('/api/contacts/', {
            'full_name': 'Avery Counsel',
            'email': 'AVERY@EXAMPLE.COM',
        }, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['email'], 'avery@example.com')
        duplicate = self.client.post('/api/contacts/', {
            'full_name': 'Avery Duplicate',
            'email': 'avery@example.com',
        }, format='json')
        self.assertEqual(duplicate.status_code, 400)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Contact.objects.create(
                    full_name='Database Duplicate',
                    email='AVERY@EXAMPLE.COM',
                )

    def test_assigned_analyst_can_link_and_list_deal_contact(self):
        contact = Contact.objects.create(
            full_name='Casey Source',
            email='casey@example.com',
            created_by=self.analyst,
        )
        self.client.force_authenticate(self.analyst)
        created = self.client.post('/api/deal-contacts/', {
            'deal': str(self.deal.pk),
            'contact': str(contact.pk),
            'role': DealContactRole.SOURCE_CONTACT,
            'is_primary': True,
        }, format='json')
        self.assertEqual(created.status_code, 201)
        listed = self.client.get(f'/api/deal-contacts/?deal={self.deal.pk}')
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.data['results']), 1)

    def test_api_created_contact_is_owned_by_the_analyst_and_can_be_linked(self):
        self.client.force_authenticate(self.analyst)
        created = self.client.post('/api/contacts/', {
            'full_name': 'Analyst Created',
            'email': 'analyst-created@example.com',
        }, format='json')

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['created_by'], self.analyst.pk)
        linked = self.client.post('/api/deal-contacts/', {
            'deal': str(self.deal.pk),
            'contact': created.data['id'],
            'role': DealContactRole.SOURCE_CONTACT,
        }, format='json')
        self.assertEqual(linked.status_code, 201)

    def test_other_analyst_cannot_link_or_see_contact(self):
        contact = Contact.objects.create(full_name='Hidden Contact', email='hidden@example.com')
        DealContact.objects.create(
            deal=self.deal,
            contact=contact,
            role=DealContactRole.CLOSING_CONTACT,
        )
        self.client.force_authenticate(self.other)
        denied = self.client.post('/api/deal-contacts/', {
            'deal': str(self.deal.pk),
            'contact': str(contact.pk),
            'role': DealContactRole.SOURCE_CONTACT,
        }, format='json')
        self.assertEqual(denied.status_code, 404)
        contacts = self.client.get('/api/contacts/')
        self.assertEqual(contacts.status_code, 200)
        self.assertEqual(contacts.data['count'], 0)

    def test_analyst_cannot_attach_another_analysts_contact_to_an_accessible_deal(self):
        hidden_contact = Contact.objects.create(
            full_name='Other Analyst Contact',
            created_by=self.other,
        )
        self.client.force_authenticate(self.analyst)

        response = self.client.post('/api/deal-contacts/', {
            'deal': str(self.deal.pk),
            'contact': str(hidden_contact.pk),
            'role': DealContactRole.SOURCE_CONTACT,
        }, format='json')

        self.assertEqual(response.status_code, 404)
        self.assertFalse(DealContact.objects.filter(contact=hidden_contact, deal=self.deal).exists())

        missing = self.client.post('/api/deal-contacts/', {
            'deal': str(self.deal.pk),
            'contact': '00000000-0000-0000-0000-000000000001',
            'role': DealContactRole.SOURCE_CONTACT,
        }, format='json')
        self.assertEqual(missing.status_code, 404)

    def test_only_one_primary_contact_per_deal_role(self):
        first = Contact.objects.create(full_name='First')
        second = Contact.objects.create(full_name='Second')
        DealContact.objects.create(
            deal=self.deal,
            contact=first,
            role=DealContactRole.LENDER_COUNSEL,
            is_primary=True,
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                DealContact.objects.create(
                    deal=self.deal,
                    contact=second,
                    role=DealContactRole.LENDER_COUNSEL,
                    is_primary=True,
                )

    def test_invalid_filters_are_rejected_instead_of_raising_server_errors(self):
        self.client.force_authenticate(self.analyst)

        invalid_deal = self.client.get('/api/deal-contacts/?deal=not-a-uuid')
        invalid_role = self.client.get('/api/deal-contacts/?role=not-a-role')

        self.assertEqual(invalid_deal.status_code, 400)
        self.assertEqual(invalid_role.status_code, 400)

    def test_analyst_cannot_mutate_a_contact_shared_with_another_analyst(self):
        other_deal = Deal.objects.create(
            name='Other Contact Deal',
            investment_type='whole_loan_bridge',
            source_channel='direct',
            requested_amount='500000.00',
            assigned_analyst=self.other,
        )
        contact = Contact.objects.create(full_name='Shared Counsel')
        DealContact.objects.create(
            deal=self.deal,
            contact=contact,
            role=DealContactRole.LENDER_COUNSEL,
        )
        DealContact.objects.create(
            deal=other_deal,
            contact=contact,
            role=DealContactRole.LENDER_COUNSEL,
        )
        self.client.force_authenticate(self.analyst)

        response = self.client.patch(
            f'/api/contacts/{contact.pk}/',
            {'full_name': 'Unauthorized Rename'},
            format='json',
        )

        self.assertEqual(response.status_code, 403)
        contact.refresh_from_db()
        self.assertEqual(contact.full_name, 'Shared Counsel')

    def test_linked_contact_delete_returns_a_validation_error(self):
        contact = Contact.objects.create(full_name='Protected Contact')
        DealContact.objects.create(
            deal=self.deal,
            contact=contact,
            role=DealContactRole.CLOSING_CONTACT,
        )
        self.client.force_authenticate(self.staff)

        response = self.client.delete(f'/api/contacts/{contact.pk}/')

        self.assertEqual(response.status_code, 400)
        self.assertTrue(Contact.objects.filter(pk=contact.pk).exists())

    def test_contact_link_integrity_conflict_returns_validation_error(self):
        contact = Contact.objects.create(full_name='Conflicting Contact', created_by=self.analyst)
        self.client.force_authenticate(self.analyst)

        with patch.object(DealContact.objects, 'create', side_effect=IntegrityError('simulated race')):
            response = self.client.post('/api/deal-contacts/', {
                'deal': str(self.deal.pk),
                'contact': str(contact.pk),
                'role': DealContactRole.SOURCE_CONTACT,
            }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('detail', response.data)
