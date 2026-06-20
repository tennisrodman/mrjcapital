import re


_PUNCTUATION = re.compile(r'[^a-z0-9\s]')
_SPACE = re.compile(r'\s+')
_SUFFIXES = {
    'avenue': 'ave',
    'boulevard': 'blvd',
    'circle': 'cir',
    'court': 'ct',
    'drive': 'dr',
    'highway': 'hwy',
    'lane': 'ln',
    'parkway': 'pkwy',
    'place': 'pl',
    'road': 'rd',
    'street': 'st',
    'suite': 'ste',
    'terrace': 'ter',
}


def normalize_address(address, city='', state='', zip_code=''):
    """Return a simple canonical address key for intake deduplication."""

    parts = [address or '', city or '', state or '', zip_code or '']
    raw = ' '.join(parts).lower().strip()
    raw = _PUNCTUATION.sub(' ', raw)
    tokens = [_SUFFIXES.get(token, token) for token in _SPACE.split(raw) if token]
    return ' '.join(tokens)
