"""Normalize money aggregates for stable API/MCP JSON across database backends."""

from decimal import Decimal, ROUND_HALF_UP

_MONEY_QUANT = Decimal('0.01')


def format_money_aggregate(value) -> str:
    """Return a two-decimal money string (e.g. ``\"3000000.00\"``).

    SQLite Sum aggregates often omit trailing zeros; PostgreSQL returns
    ``Decimal('3000000.00')``. Callers should always use this helper for
    pipeline value fields so clients and contract tests see one shape.
    """
    if value is None:
        return '0.00'
    return str(Decimal(value).quantize(_MONEY_QUANT, rounding=ROUND_HALF_UP))
