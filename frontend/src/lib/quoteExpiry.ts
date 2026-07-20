const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDateParts(value: string): [number, number, number] | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

/** Format an API instant as the browser's local calendar date. */
export function localCalendarDate(
  timestamp: string | null | undefined,
  utcOffsetMinutes?: number,
): string {
  if (!timestamp) return '';
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return '';
  const offset = utcOffsetMinutes ?? instant.getTimezoneOffset();
  return new Date(instant.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

/** Store a selected calendar date as the final millisecond of that local day. */
export function expiryTimestamp(value: string, utcOffsetMinutes?: number): string | null {
  if (!value) return null;
  const parts = calendarDateParts(value);
  if (!parts) return null;
  const [year, month, day] = parts;
  const localEndOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
  const offset = utcOffsetMinutes ?? localEndOfDay.getTimezoneOffset();
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) + offset * 60_000)
    .toISOString();
}
