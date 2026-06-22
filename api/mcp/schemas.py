from typing import Any, NotRequired, TypedDict


JsonDict = dict[str, Any]


class DealFilters(TypedDict, total=False):
    pipeline_status: NotRequired[str | None]
    syndication_status: NotRequired[str | None]
    investment_type: NotRequired[str | None]
    source_channel: NotRequired[str | None]
    sponsor_id: NotRequired[str | None]
    broker_id: NotRequired[str | None]
    fund_id: NotRequired[str | None]
    assigned_analyst_id: NotRequired[int | str | None]
    search: NotRequired[str | None]


class DealSearchResult(TypedDict):
    total: int
    limit: int
    offset: int
    results: list[JsonDict]
