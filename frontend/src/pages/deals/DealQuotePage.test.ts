import { describe, expect, it } from 'vitest';

import { expiryTimestamp, localCalendarDate } from '@/lib/quoteExpiry';

describe('quote expiration calendar conversion', () => {
  it('round-trips a Los Angeles summer date without moving it forward', () => {
    const losAngelesSummerOffset = 7 * 60;
    const selectedDate = '2026-07-20';

    const expiresAt = expiryTimestamp(selectedDate, losAngelesSummerOffset);

    expect(expiresAt).toBe('2026-07-21T06:59:59.999Z');
    expect(localCalendarDate(expiresAt, losAngelesSummerOffset)).toBe(selectedDate);
  });

  it('round-trips a Los Angeles winter date using the applicable offset', () => {
    const losAngelesWinterOffset = 8 * 60;
    const selectedDate = '2026-12-20';

    const expiresAt = expiryTimestamp(selectedDate, losAngelesWinterOffset);

    expect(expiresAt).toBe('2026-12-21T07:59:59.999Z');
    expect(localCalendarDate(expiresAt, losAngelesWinterOffset)).toBe(selectedDate);
  });

  it('keeps expiration at the final millisecond of the selected local day', () => {
    const offset = 7 * 60;
    const expiresAt = expiryTimestamp('2026-07-20', offset);

    expect(expiresAt).not.toBeNull();
    const localWallClock = new Date(new Date(expiresAt as string).getTime() - offset * 60_000);
    expect(localWallClock.toISOString()).toBe('2026-07-20T23:59:59.999Z');
  });

  it('rejects malformed or impossible calendar dates', () => {
    expect(expiryTimestamp('2026-02-31', 7 * 60)).toBeNull();
    expect(expiryTimestamp('not-a-date', 7 * 60)).toBeNull();
    expect(localCalendarDate('not-a-timestamp', 7 * 60)).toBe('');
  });
});
