import { describe, expect, it } from 'vitest';

import type { Deal, DealDocument, DocumentUploadIntentResponse, Paginated } from '@/types/deal';
import type { Quote } from '@/types/quote';
import type { ScreeningAssessment } from '@/types/screening';
import { mockApiRequest } from './handlers';

async function createQuotingDeal(name: string): Promise<Deal> {
  const deal = await mockApiRequest<Deal>('api/deals/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      investment_type: 'whole_loan_bridge',
      requested_amount: '7500000.00',
      source_channel: 'direct',
      source_date: '2026-07-10',
    }),
  });
  await mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'screening', reason: 'Ready for screening.' }),
  });
  const assessment = await mockApiRequest<ScreeningAssessment>('api/screening-assessments/', {
    method: 'POST',
    body: JSON.stringify({
      deal: deal.id,
      loan_amount: '6500000',
      as_is_value: '10000000',
      project_cost: '8000000',
      noi: '1000000',
      stabilized_noi: '1200000',
      annual_debt_service: '700000',
      occupancy: '92.50',
      proposed_rate: '8.25',
      proposed_term_months: 24,
      exit_strategy: 'Refinance after stabilization.',
      exit_cap_rate: '5.5000',
    }),
  });
  await mockApiRequest(`api/screening-assessments/${assessment.id}/finalize/`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'advance' }),
  });
  return mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'quoting', reason: 'Screening approved.', override_readiness: false }),
  });
}

describe('quote mock API', () => {
  it('supports send → attach legal term sheet → execute on the current version', async () => {
    const deal = await createQuotingDeal('Quote Send Attach Execute');

    const created = await mockApiRequest<Quote>('api/quotes/', {
      method: 'POST',
      body: JSON.stringify({
        deal: deal.id,
        seed_from_screening: true,
        loan_amount: '6500000.00',
        rate_type: 'fixed',
        interest_rate: '8.2500',
        term_months: 24,
        amortization_type: 'interest_only',
        recourse_type: 'limited',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        origination_fee_pct: '1.00',
        holdback_amount: '500000.00',
      }),
    });

    expect(created).toMatchObject({
      deal: deal.id,
      version: 1,
      status: 'draft',
      is_current: true,
      origination_fee_amount: '65000.00',
      initial_funding_amount: '6000000.00',
    });

    const sent = await mockApiRequest<Quote>(`api/quotes/${created.id}/send/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).not.toBeNull();

    await expect(
      mockApiRequest(`api/quotes/${created.id}/execute/`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    ).rejects.toMatchObject({
      status: 400,
      data: {
        attachments: [
          'Attach at least one ready legal term sheet or LOI document before executing.',
        ],
      },
    });

    const intent = await mockApiRequest<DocumentUploadIntentResponse>(
      'api/documents/upload-intent/',
      {
        method: 'POST',
        body: JSON.stringify({
          deal: deal.id,
          document_name: 'Executed Term Sheet',
          category: 'legal',
          subcategory: 'term_sheet',
          file_type: 'pdf',
          content_type: 'application/pdf',
          file_size_bytes: 2048,
        }),
      },
    );
    const document = await mockApiRequest<DealDocument>(
      `api/documents/${intent.document.id}/complete/`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    expect(document).toMatchObject({
      category: 'legal',
      subcategory: 'term_sheet',
      storage_status: 'ready',
    });

    const attached = await mockApiRequest<Quote>(`api/quotes/${created.id}/attachments/`, {
      method: 'POST',
      body: JSON.stringify({ document_ids: [document.id] }),
    });
    expect(attached.attachments).toEqual([document.id]);

    const executed = await mockApiRequest<Quote>(`api/quotes/${created.id}/execute/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(executed).toMatchObject({
      status: 'executed',
      is_current: true,
    });
    expect(executed.signed_at).not.toBeNull();

    const listed = await mockApiRequest<Paginated<Quote>>(
      `api/quotes/?deal=${deal.id}&current=true`,
    );
    expect(listed.results).toHaveLength(1);
    expect(listed.results[0].status).toBe('executed');
  });

  it('does not set sent_at when send readiness fails', async () => {
    const deal = await createQuotingDeal('Quote Incomplete Send');
    const created = await mockApiRequest<Quote>('api/quotes/', {
      method: 'POST',
      body: JSON.stringify({
        deal: deal.id,
        seed_from_screening: false,
        loan_amount: '6500000.00',
        rate_type: 'fixed',
        interest_rate: '8.2500',
        term_months: 24,
        amortization_type: 'interest_only',
        recourse_type: 'limited',
      }),
    });
    expect(created.sent_at).toBeNull();

    await expect(
      mockApiRequest(`api/quotes/${created.id}/send/`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    ).rejects.toMatchObject({ status: 400 });

    const listed = await mockApiRequest<Paginated<Quote>>(`api/quotes/?deal=${deal.id}&current=true`);
    expect(listed.results[0].status).toBe('draft');
    expect(listed.results[0].sent_at).toBeNull();
  });

  it('rejects zero-dollar and incomplete amortizing quotes', async () => {
    const deal = await createQuotingDeal('Quote Invalid Economics');
    const created = await mockApiRequest<Quote>('api/quotes/', {
      method: 'POST',
      body: JSON.stringify({
        deal: deal.id,
        seed_from_screening: false,
        loan_amount: '0',
        rate_type: 'fixed',
        interest_rate: '8.2500',
        term_months: 24,
        amortization_type: 'full_amort',
        recourse_type: 'limited',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    });

    expect(created.is_send_ready).toBe(false);
    expect(created.missing_send_fields).toEqual(expect.arrayContaining([
      'loan_amount',
      'amortization_months',
    ]));
    await expect(mockApiRequest(`api/quotes/${created.id}/send/`, {
      method: 'POST',
      body: JSON.stringify({}),
    })).rejects.toMatchObject({ status: 400 });
  });

  it('locks executed quote evidence subcategory metadata', async () => {
    const deal = await createQuotingDeal('Quote Evidence Metadata Lock');
    const created = await mockApiRequest<Quote>('api/quotes/', {
      method: 'POST',
      body: JSON.stringify({
        deal: deal.id,
        seed_from_screening: true,
        loan_amount: '6500000.00',
        rate_type: 'fixed',
        interest_rate: '8.2500',
        term_months: 24,
        amortization_type: 'interest_only',
        recourse_type: 'limited',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    });
    await mockApiRequest(`api/quotes/${created.id}/send/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const intent = await mockApiRequest<DocumentUploadIntentResponse>(
      'api/documents/upload-intent/',
      {
        method: 'POST',
        body: JSON.stringify({
          deal: deal.id,
          document_name: 'Locked Term Sheet',
          category: 'legal',
          subcategory: 'term_sheet',
          file_type: 'pdf',
          content_type: 'application/pdf',
          file_size_bytes: 2048,
        }),
      },
    );
    const document = await mockApiRequest<DealDocument>(
      `api/documents/${intent.document.id}/complete/`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    await mockApiRequest(`api/quotes/${created.id}/attachments/`, {
      method: 'POST',
      body: JSON.stringify({ document_ids: [document.id] }),
    });
    await mockApiRequest(`api/quotes/${created.id}/execute/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await expect(
      mockApiRequest(`api/documents/${document.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ subcategory: 'loi' }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      data: { subcategory: ['Executed document metadata cannot be changed.'] },
    });
  });
});
