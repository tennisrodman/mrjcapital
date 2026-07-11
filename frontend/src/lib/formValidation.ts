type OptionalString = string | null | undefined;

export function isOptionalWholeNumber(value: OptionalString, max?: number): boolean {
  const normalized = value?.trim();
  if (!normalized) return true;
  if (!/^\d+$/.test(normalized)) return false;
  return max === undefined || Number(normalized) <= max;
}

export function isOptionalYear(value: OptionalString): boolean {
  const normalized = value?.trim();
  if (!normalized) return true;
  const year = Number(normalized);
  return Number.isInteger(year) && year >= 1700 && year <= 2200;
}

export function optionalNumber(value: OptionalString): number | null {
  const normalized = value?.trim();
  return normalized ? Number(normalized) : null;
}

function isValidIpv4(hostname: string): boolean {
  const octets = hostname.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

function isValidDjangoHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || isValidIpv4(normalized)) return true;
  if (/^\[[0-9a-f:.]+\]$/i.test(normalized)) return true;

  const domain = normalized.endsWith('.') ? normalized.slice(0, -1) : normalized;
  const labels = domain.split('.');
  if (labels.length < 2 || domain.length > 253) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    return false;
  }
  return /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i.test(labels[labels.length - 1] ?? '');
}

/** Matches the host and scheme behavior of Django's HTTP(S) URLValidator. */
export function isOptionalHttpUrl(value: OptionalString): boolean {
  const normalized = value?.trim();
  if (!normalized) return true;
  if (/[\t\r\n]/.test(normalized)) return false;

  try {
    const url = new URL(normalized);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isValidDjangoHostname(url.hostname);
  } catch {
    return false;
  }
}
