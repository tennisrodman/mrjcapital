from uuid import uuid4

from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError as DRFValidationError

from api.drf import (
    boolean_filter_value,
    django_validation_response,
    raise_drf_validation,
    uuid_filter_value,
)


class DRFHelpersTests(SimpleTestCase):
    def test_uuid_filter_value_accepts_uuid_strings_and_standardizes_errors(self):
        value = uuid4()
        self.assertEqual(uuid_filter_value(str(value), 'deal'), value)

        with self.assertRaises(DRFValidationError) as raised:
            uuid_filter_value('not-a-uuid', 'deal')
        self.assertEqual(str(raised.exception.detail['deal']), 'Invalid UUID.')

    def test_boolean_filter_value_accepts_api_spellings(self):
        self.assertIs(boolean_filter_value('TRUE', 'current'), True)
        self.assertIs(boolean_filter_value('0', 'current'), False)
        with self.assertRaises(DRFValidationError):
            boolean_filter_value('yes', 'current')

    def test_raise_drf_validation_preserves_field_errors(self):
        with self.assertRaises(DRFValidationError) as raised:
            raise_drf_validation(DjangoValidationError({'loan_amount': 'Required.'}))
        self.assertEqual(raised.exception.detail['loan_amount'][0], 'Required.')

    def test_django_validation_response_preserves_readiness_context(self):
        error = DjangoValidationError({'pipeline_status': 'Not ready.'})
        error.readiness = {'ready': False, 'blockers': ['quote_execution_required']}

        response = django_validation_response(error)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['pipeline_status'], ['Not ready.'])
        self.assertEqual(response.data['readiness'], error.readiness)
