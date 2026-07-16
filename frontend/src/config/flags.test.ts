import { describe, expect, it } from 'vitest';

import { getDemoIsStaff, listPathForEntityDetail, setDemoIsStaffForTests } from './flags';

describe('listPathForEntityDetail', () => {
  it('redirects deal detail and nested deal routes to /deals', () => {
    expect(listPathForEntityDetail('/deals/deal-1')).toBe('/deals');
    expect(listPathForEntityDetail('/deals/deal-1/closing')).toBe('/deals');
    expect(listPathForEntityDetail('/deals/deal-1/quotes')).toBe('/deals');
  });

  it('keeps list and create routes stable', () => {
    expect(listPathForEntityDetail('/deals')).toBe('/deals');
    expect(listPathForEntityDetail('/deals/new')).toBe('/deals/new');
    expect(listPathForEntityDetail('/deals/new/something')).toBe('/deals/new/something');
    expect(listPathForEntityDetail('/login')).toBe('/login');
  });
});

describe('demo staff persona', () => {
  it('defaults to analyst and can flip for tests', () => {
    setDemoIsStaffForTests(false);
    expect(getDemoIsStaff()).toBe(false);
    setDemoIsStaffForTests(true);
    expect(getDemoIsStaff()).toBe(true);
    setDemoIsStaffForTests(false);
  });
});
