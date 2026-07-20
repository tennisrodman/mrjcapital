import { describe, expect, it } from 'vitest';

import {
  isOptionalHttpUrl,
  isOptionalWholeNumber,
  isOptionalYear,
  optionalNumber,
} from './formValidation';

describe('form validation helpers', () => {
  it('matches Django URLValidator handling for single-label hosts', () => {
    expect(isOptionalHttpUrl('https://intranet')).toBe(false);
    expect(isOptionalHttpUrl('http://localhost')).toBe(true);
    expect(isOptionalHttpUrl('https://localhost:8000/path')).toBe(true);
    expect(isOptionalHttpUrl('https://example.com')).toBe(true);
  });

  it('shares blank, whole-number, and year normalization rules', () => {
    expect(isOptionalWholeNumber('   ')).toBe(true);
    expect(isOptionalWholeNumber('200', 200)).toBe(true);
    expect(isOptionalWholeNumber('201', 200)).toBe(false);
    expect(isOptionalWholeNumber('1.5')).toBe(false);
    expect(isOptionalYear('1700')).toBe(true);
    expect(isOptionalYear('1699')).toBe(false);
    expect(optionalNumber(' 0 ')).toBe(0);
    expect(optionalNumber(' ')).toBeNull();
  });
});
