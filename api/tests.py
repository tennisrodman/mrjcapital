"""Smoke tests for the MRJ Capital API auth contract."""

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


class AuthFlowTests(APITestCase):
    def setUp(self):
        self.username = 'tester'
        self.password = 's3cret-pw-123'
        self.user = User.objects.create_user(
            self.username,
            email='tester@example.com',
            password=self.password,
        )

    def test_login_returns_jwt_tokens(self):
        resp = self.client.post(
            reverse('login'),
            {'username': self.username, 'password': self.password},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn('access', resp.data['tokens'])
        self.assertIn('refresh', resp.data['tokens'])
        self.assertEqual(resp.data['user']['username'], self.username)

    def test_login_wrong_password_is_401(self):
        resp = self.client.post(
            reverse('login'),
            {'username': self.username, 'password': 'wrong'},
            format='json',
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_missing_fields_is_400(self):
        resp = self.client.post(reverse('login'), {'username': self.username}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_user_info_requires_authentication(self):
        resp = self.client.get(reverse('user_info'))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_user_info_with_token_returns_profile(self):
        login = self.client.post(
            reverse('login'),
            {'username': self.username, 'password': self.password},
            format='json',
        )
        access = login.data['tokens']['access']
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        resp = self.client.get(reverse('user_info'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data['username'], self.username)
        self.assertEqual(resp.data['email'], 'tester@example.com')
        self.assertIn('is_staff', resp.data)

    def test_unknown_api_route_returns_json_404(self):
        resp = self.client.get('/api/does-not-exist/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(resp.json()['error'], 'Not found')
