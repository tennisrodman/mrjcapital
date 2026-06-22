/** Error carrying the HTTP status and parsed response body (e.g. DRF field errors). */
export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** Pulls a human-readable message out of a DRF error body. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) {
    const data = error.data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const detail = record.detail ?? record.error;
      if (typeof detail === 'string') return detail;
      const first = Object.values(record)[0];
      if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
      if (typeof first === 'string') return first;
    }
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

/** Maps a DRF 400 body to a flat field → message record for form display. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(error.data as Record<string, unknown>)) {
    if (Array.isArray(value) && typeof value[0] === 'string') result[key] = value[0];
    else if (typeof value === 'string') result[key] = value;
  }
  return result;
}
