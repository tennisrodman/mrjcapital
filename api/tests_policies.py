from types import SimpleNamespace

from django.test import SimpleTestCase

from api.policies import can_access_deal, is_staff_user


class AccessPolicyTests(SimpleTestCase):
    def test_staff_and_assigned_analyst_access_are_centralized(self):
        analyst = SimpleNamespace(id=7, is_authenticated=True, is_staff=False, is_superuser=False)
        other = SimpleNamespace(id=8, is_authenticated=True, is_staff=False, is_superuser=False)
        staff = SimpleNamespace(id=9, is_authenticated=True, is_staff=True, is_superuser=False)
        deal = SimpleNamespace(assigned_analyst_id=7)

        self.assertFalse(is_staff_user(analyst))
        self.assertTrue(is_staff_user(staff))
        self.assertTrue(can_access_deal(analyst, deal))
        self.assertTrue(can_access_deal(staff, deal))
        self.assertFalse(can_access_deal(other, deal))
        self.assertFalse(can_access_deal(None, deal))
