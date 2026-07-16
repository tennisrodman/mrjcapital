import json
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from api.models import Deal, DocumentCategory
from api.serializers import (
    ALLOWED_DOCUMENT_VISIBILITY_ROLES,
    DocumentUploadIntentSerializer,
)
from api.services.storage import ALLOWED_FILE_TYPES
from api.services.deals import (
    ACTIVE_PIPELINE_EXCLUDED_STATUSES,
    PIPELINE_TRANSITIONS,
    SYNDICATION_TRANSITIONS,
)


User = get_user_model()
CONTRACTS = json.loads(
    (Path(settings.BASE_DIR) / 'shared' / 'workflow_contracts.json').read_text()
)


class DocumentUploadContractTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user('contract-analyst', password='pw')
        self.deal = Deal.objects.create(
            name='Upload Contract Deal',
            investment_type='whole_loan_bridge',
            assigned_analyst=self.user,
            source_channel='direct',
            requested_amount='1000000.00',
        )

    def test_backend_matches_shared_upload_contract(self):
        contract = CONTRACTS['document_upload']
        self.assertEqual(sorted(ALLOWED_FILE_TYPES), contract['allowed_file_types'])
        self.assertEqual(
            sorted(DocumentCategory.values),
            contract['allowed_categories'],
        )
        self.assertEqual(
            sorted(ALLOWED_DOCUMENT_VISIBILITY_ROLES),
            contract['allowed_visibility_roles'],
        )

        with override_settings(DOCUMENT_MAX_UPLOAD_BYTES=contract['default_max_bytes']):
            for case in contract['cases']:
                with self.subTest(case=case['name']):
                    payload = {
                        'deal': str(self.deal.pk),
                        'document_name': f"Contract {case['name']}",
                        'category': case.get('category', 'legal'),
                        'file_type': case['file_type'],
                        'file_size_bytes': case['file_size_bytes'],
                        'content_type': '',
                    }
                    if 'visibility_roles' in case:
                        payload['visibility_roles'] = case['visibility_roles']
                    serializer = DocumentUploadIntentSerializer(data=payload)
                    self.assertEqual(serializer.is_valid(), case['valid'], serializer.errors)
                    if case['valid']:
                        self.assertEqual(
                            serializer.validated_data['file_type'],
                            case['expected_file_type'],
                        )
                        self.assertEqual(
                            serializer.validated_data['content_type'],
                            case['expected_content_type'],
                        )
                    else:
                        field_errors = serializer.errors[case['error_field']]
                        self.assertEqual(str(field_errors[0]), case['error_message'])

    def test_backend_matches_shared_lifecycle_graph(self):
        contract = CONTRACTS['lifecycle']
        self.assertEqual(
            sorted(str(status) for status in ACTIVE_PIPELINE_EXCLUDED_STATUSES),
            sorted(contract['active_pipeline_excluded_statuses']),
        )
        actual_pipeline = {
            str(source): sorted(str(target) for target in targets)
            for source, targets in PIPELINE_TRANSITIONS.items()
        }
        expected_pipeline = {
            source: sorted(targets)
            for source, targets in contract['pipeline_transitions'].items()
        }
        self.assertEqual(actual_pipeline, expected_pipeline)

        actual_syndication = {
            str(source): sorted(str(target) for target in targets)
            for source, targets in SYNDICATION_TRANSITIONS.items()
        }
        expected_syndication = {
            source: sorted(targets)
            for source, targets in contract['syndication_transitions'].items()
        }
        self.assertEqual(actual_syndication, expected_syndication)
