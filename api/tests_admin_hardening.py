from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from api.models import (
    Broker,
    Contact,
    DealContact,
    DealNote,
    Document,
    Fund,
    Property,
    Sponsor,
)


User = get_user_model()


class OperationalAdminHardeningTests(TestCase):
    def setUp(self):
        self.request = RequestFactory().get('/admin/')
        self.request.user = User.objects.create_superuser(
            'admin-hardening',
            email='admin@example.com',
            password='pw',
        )

    def test_operational_evidence_admins_are_fully_read_only(self):
        for model in (Document, DealNote, DealContact):
            model_admin = admin.site._registry[model]
            with self.subTest(model=model.__name__):
                self.assertFalse(model_admin.has_add_permission(self.request))
                self.assertFalse(model_admin.has_change_permission(self.request))
                self.assertFalse(model_admin.has_delete_permission(self.request))

    def test_master_data_admins_allow_seeding_but_not_mutation(self):
        for model in (Sponsor, Property, Broker, Fund, Contact):
            model_admin = admin.site._registry[model]
            with self.subTest(model=model.__name__):
                self.assertTrue(model_admin.has_add_permission(self.request))
                self.assertFalse(model_admin.has_change_permission(self.request))
                self.assertFalse(model_admin.has_delete_permission(self.request))
