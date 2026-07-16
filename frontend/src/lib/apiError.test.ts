import { describe, expect, it } from 'vitest';

import { ApiError, formErrorMessage } from './apiError';

describe('formErrorMessage', () => {
  it('preserves ordinary network and storage errors', () => {
    expect(formErrorMessage(new Error('Storage service unavailable'))).toBe(
      'Storage service unavailable',
    );
  });

  it('joins DRF field errors when they exist', () => {
    const error = new ApiError('Bad request', 400, {
      file_type: ['Unsupported file type.'],
      file_size_bytes: ['File is too large.'],
    });

    expect(formErrorMessage(error)).toBe('Unsupported file type. File is too large.');
  });

  it('falls back to a detail error when no field errors exist', () => {
    const error = new ApiError('Bad request', 400, { detail: 'Upload expired.' });
    expect(formErrorMessage(error)).toBe('Upload expired.');
  });

  it('uses the caller fallback for unknown values', () => {
    expect(formErrorMessage(null, 'Could not save.')).toBe('Could not save.');
  });
});
