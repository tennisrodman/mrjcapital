import { describe, expect, it } from 'vitest';

import demoSeed from '@shared/demo_seed.json';
import { SPONSOR_ENTITY_TYPE_OPTIONS } from '@/components/deals/form/options';
import {
  DOCUMENT_CATEGORY_LABELS,
  INVESTMENT_TYPE_LABELS,
  PIPELINE_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  RELATIONSHIP_RATING_LABELS,
  SOURCE_CHANNEL_LABELS,
} from '@/lib/dealChoices';
import type { PipelineStatus } from '@/types/deal';
import { PIPELINE_TRANSITIONS } from './pipeline';

const MIN_COUNTS = {
  funds: 4,
  sponsors: 12,
  brokers: 8,
  properties: 30,
  deals: 28,
  documents: 60,
  activity: 36,
} as const;

const ACTIVE_DOC_STAGES = new Set<PipelineStatus>([
  'quoting',
  'negotiating',
  'signed',
  'closing',
  'closed',
  'servicing',
  'exited',
]);

function ids(rows: { id: string }[]): Set<string> {
  return new Set(rows.map((row) => row.id));
}

function expectUniqueIds(rows: { id: string }[], label: string): void {
  expect(ids(rows).size, `${label} ids should be unique`).toBe(rows.length);
}

function expectKnownAndCovered(actualValues: string[], expectedValues: string[], label: string): void {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);

  for (const value of actual) {
    expect(expected.has(value), `${label} contains unknown value ${value}`).toBe(true);
  }
  for (const value of expected) {
    expect(actual.has(value), `${label} should cover ${value}`).toBe(true);
  }
}

describe('demo seed data', () => {
  it('meets the minimum collection sizes', () => {
    expect(demoSeed.funds.length).toBeGreaterThanOrEqual(MIN_COUNTS.funds);
    expect(demoSeed.sponsors.length).toBeGreaterThanOrEqual(MIN_COUNTS.sponsors);
    expect(demoSeed.brokers.length).toBeGreaterThanOrEqual(MIN_COUNTS.brokers);
    expect(demoSeed.properties.length).toBeGreaterThanOrEqual(MIN_COUNTS.properties);
    expect(demoSeed.deals.length).toBeGreaterThanOrEqual(MIN_COUNTS.deals);
    expect(demoSeed.documents.length).toBeGreaterThanOrEqual(MIN_COUNTS.documents);
    expect(demoSeed.activity.length).toBeGreaterThanOrEqual(MIN_COUNTS.activity);
  });

  it('keeps ids unique and references valid', () => {
    expectUniqueIds(demoSeed.funds, 'fund');
    expectUniqueIds(demoSeed.sponsors, 'sponsor');
    expectUniqueIds(demoSeed.brokers, 'broker');
    expectUniqueIds(demoSeed.properties, 'property');
    expectUniqueIds(demoSeed.deals, 'deal');
    expectUniqueIds(demoSeed.documents, 'document');
    expectUniqueIds(demoSeed.activity, 'activity');

    const fundIds = ids(demoSeed.funds);
    const sponsorIds = ids(demoSeed.sponsors);
    const brokerIds = ids(demoSeed.brokers);
    const propertyIds = ids(demoSeed.properties);
    const dealIds = ids(demoSeed.deals);

    for (const deal of demoSeed.deals) {
      const brokerId = 'broker' in deal ? deal.broker : null;
      const fundId = 'fund' in deal ? deal.fund : null;
      expect(sponsorIds.has(deal.sponsor), `${deal.id} sponsor should exist`).toBe(true);
      if (brokerId) expect(brokerIds.has(brokerId), `${deal.id} broker should exist`).toBe(true);
      if (fundId) expect(fundIds.has(fundId), `${deal.id} fund should exist`).toBe(true);

      let primaryCount = 0;
      for (const [rawPropertyId, isPrimary] of deal.properties) {
        const propertyId = String(rawPropertyId);
        expect(propertyIds.has(propertyId), `${deal.id} property ${propertyId} should exist`).toBe(true);
        if (isPrimary) primaryCount += 1;
      }
      expect(primaryCount, `${deal.id} should have exactly one primary property`).toBe(1);
    }

    for (const document of demoSeed.documents) {
      expect(dealIds.has(document.deal), `${document.id} deal should exist`).toBe(true);
    }
    for (const entry of demoSeed.activity) {
      expect(dealIds.has(entry.deal), `${entry.id} deal should exist`).toBe(true);
    }
  });

  it('covers the frontend choice sets', () => {
    expectKnownAndCovered(
      demoSeed.deals.map((deal) => deal.investment_type),
      Object.keys(INVESTMENT_TYPE_LABELS),
      'investment_type',
    );
    expectKnownAndCovered(
      demoSeed.deals.map((deal) => deal.source_channel),
      Object.keys(SOURCE_CHANNEL_LABELS),
      'source_channel',
    );
    expectKnownAndCovered(
      demoSeed.deals.map((deal) => deal.pipeline_status),
      Object.keys(PIPELINE_STATUS_LABELS),
      'pipeline_status',
    );
    expectKnownAndCovered(
      demoSeed.sponsors.map((sponsor) => sponsor.relationship_rating),
      Object.keys(RELATIONSHIP_RATING_LABELS),
      'relationship_rating',
    );
    expectKnownAndCovered(
      demoSeed.sponsors.map((sponsor) => sponsor.entity_type),
      SPONSOR_ENTITY_TYPE_OPTIONS.map((option) => option.value),
      'sponsor entity_type',
    );
    expectKnownAndCovered(
      demoSeed.properties.map((property) => property.property_type),
      Object.keys(PROPERTY_TYPE_LABELS),
      'property_type',
    );
    expectKnownAndCovered(
      demoSeed.documents.map((document) => document.category),
      Object.keys(DOCUMENT_CATEGORY_LABELS),
      'document category',
    );
  });

  it('keeps document counts dense on active/historical deals and light elsewhere', () => {
    const documentsByDeal = new Map<string, number>();
    for (const document of demoSeed.documents) {
      documentsByDeal.set(document.deal, (documentsByDeal.get(document.deal) ?? 0) + 1);
    }

    for (const deal of demoSeed.deals) {
      const count = documentsByDeal.get(deal.id) ?? 0;
      if (ACTIVE_DOC_STAGES.has(deal.pipeline_status as PipelineStatus)) {
        expect(count, `${deal.id} should have 3-6 documents`).toBeGreaterThanOrEqual(3);
        expect(count, `${deal.id} should have 3-6 documents`).toBeLessThanOrEqual(6);
      } else {
        expect(count, `${deal.id} should have 0-2 documents`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('keeps activity newest-first per deal and uses legal pipeline transitions', () => {
    const activityTimesByDeal = new Map<string, number[]>();

    for (const entry of demoSeed.activity) {
      const from = entry.old_value as PipelineStatus;
      const to = entry.new_value as PipelineStatus;
      expect(from in PIPELINE_TRANSITIONS, `${entry.id} old_value should be known`).toBe(true);
      expect(to in PIPELINE_TRANSITIONS, `${entry.id} new_value should be known`).toBe(true);

      if (from === 'on_hold') {
        const pausedFromStatus = 'paused_from_status' in entry ? entry.paused_from_status : undefined;
        expect(pausedFromStatus, `${entry.id} resume should include paused_from_status`).toBeTruthy();
        expect(to === 'dead' || to === pausedFromStatus, `${entry.id} resume target should be legal`).toBe(true);
      } else {
        expect(PIPELINE_TRANSITIONS[from].includes(to), `${entry.id} ${from} -> ${to} should be legal`).toBe(true);
      }

      const timestamp = new Date(entry.performed_at).getTime();
      expect(Number.isNaN(timestamp), `${entry.id} performed_at should parse`).toBe(false);
      const times = activityTimesByDeal.get(entry.deal) ?? [];
      times.push(timestamp);
      activityTimesByDeal.set(entry.deal, times);
    }

    for (const [dealId, times] of activityTimesByDeal) {
      for (let index = 1; index < times.length; index += 1) {
        expect(times[index], `${dealId} activity should be newest-first`).toBeLessThanOrEqual(times[index - 1]);
      }
    }
  });
});
