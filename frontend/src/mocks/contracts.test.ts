import { describe, expect, it } from 'vitest';

import contractsJson from '@shared/workflow_contracts.json';
import type { ActivityLogEntry, Deal, DocumentUploadIntentResponse, Paginated } from '@/types/deal';
import { mockApiRequest } from './handlers';
import { PIPELINE_TRANSITIONS } from './pipeline';
import { DEMO_SYNDICATION_TRANSITIONS } from './workflowContracts';

interface UploadContractCase {
  name: string;
  file_type: string;
  file_size_bytes: number;
  valid: boolean;
  expected_file_type?: string;
  expected_content_type?: string;
  category?: string;
  visibility_roles?: string[];
  error_field?: string;
  error_message?: string;
}

const uploadContract = contractsJson.document_upload as {
  default_max_bytes: number;
  allowed_file_types: string[];
  allowed_categories: string[];
  allowed_visibility_roles: string[];
  cases: UploadContractCase[];
};

describe('shared Demo/Live workflow contracts', () => {
  it('uses the shared pipeline and syndication state graph in Demo mode', () => {
    expect(PIPELINE_TRANSITIONS).toEqual(contractsJson.lifecycle.pipeline_transitions);
    expect(DEMO_SYNDICATION_TRANSITIONS).toEqual(
      contractsJson.lifecycle.syndication_transitions,
    );
  });

  it('matches the document upload validation vectors in Demo mode', async () => {
    const deal = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Demo upload contract',
        investment_type: 'whole_loan_bridge',
        requested_amount: '1000000.00',
        source_channel: 'direct',
        source_date: '2026-07-15',
      }),
    });

    for (const contractCase of uploadContract.cases) {
      const request = mockApiRequest<DocumentUploadIntentResponse>(
        'api/documents/upload-intent/',
        {
          method: 'POST',
          body: JSON.stringify({
            deal: deal.id,
            document_name: `Contract ${contractCase.name}`,
            category: contractCase.category ?? 'legal',
            file_type: contractCase.file_type,
            file_size_bytes: contractCase.file_size_bytes,
            content_type: '',
            ...(contractCase.visibility_roles
              ? { visibility_roles: contractCase.visibility_roles }
              : {}),
          }),
        },
      );

      if (contractCase.valid) {
        const result = await request;
        expect(result.document.file_type, contractCase.name).toBe(
          contractCase.expected_file_type,
        );
        expect(result.document.content_type, contractCase.name).toBe(
          contractCase.expected_content_type,
        );
      } else {
        await expect(request, contractCase.name).rejects.toMatchObject({
          status: 400,
          data: {
            [contractCase.error_field!]: [contractCase.error_message],
          },
        });
      }
    }
  });

  it('mirrors upload endpoint guards and completion idempotency errors', async () => {
    const deal = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Demo upload endpoint guards',
        investment_type: 'whole_loan_bridge',
        requested_amount: '1000000.00',
        source_channel: 'direct',
        source_date: '2026-07-15',
      }),
    });
    await expect(
      mockApiRequest('api/documents/', {
        method: 'POST',
        body: JSON.stringify({ deal: deal.id }),
      }),
    ).rejects.toMatchObject({
      status: 403,
      data: { detail: 'Direct document creation is disabled. Use upload-intent.' },
    });

    const intent = await mockApiRequest<DocumentUploadIntentResponse>(
      'api/documents/upload-intent/',
      {
        method: 'POST',
        body: JSON.stringify({
          deal: deal.id,
          document_name: 'Completion guard',
          category: 'legal',
          file_type: 'pdf',
          file_size_bytes: 1024,
        }),
      },
    );
    const startedActivity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${deal.id}`,
    );
    expect(startedActivity.results).toContainEqual(
      expect.objectContaining({
        action_type: 'document_upload_started',
        metadata: expect.objectContaining({ document_id: intent.document.id }),
      }),
    );
    await mockApiRequest(`api/documents/${intent.document.id}/complete/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const completedActivity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${deal.id}`,
    );
    expect(completedActivity.results).toContainEqual(
      expect.objectContaining({
        action_type: 'document_upload',
        metadata: expect.objectContaining({ document_id: intent.document.id }),
      }),
    );
    await expect(
      mockApiRequest(`api/documents/${intent.document.id}/complete/`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    ).rejects.toMatchObject({
      status: 409,
      data: { detail: 'Document upload is not pending.' },
    });
  });
});
