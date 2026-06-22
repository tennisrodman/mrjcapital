from asgiref.sync import sync_to_async
from mcp.server.fastmcp import FastMCP

from api.mcp.auth import resolve_mcp_user
from api.mcp.deal_queries import (
    get_deal,
    get_deal_allowed_transitions,
    get_deal_statuses,
    get_deal_summary,
    search_deals,
)


mcp = FastMCP('MRJ Capital')


async def _run_query(func, **kwargs):
    def call():
        return func(resolve_mcp_user(), **kwargs)

    return await sync_to_async(call, thread_sensitive=True)()


@mcp.tool()
async def mrj_search_deals(
    pipeline_status: str | None = None,
    syndication_status: str | None = None,
    investment_type: str | None = None,
    source_channel: str | None = None,
    sponsor_id: str | None = None,
    broker_id: str | None = None,
    fund_id: str | None = None,
    assigned_analyst_id: int | None = None,
    search: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Search MRJ deals with staff-only read access."""
    return await _run_query(
        search_deals,
        pipeline_status=pipeline_status,
        syndication_status=syndication_status,
        investment_type=investment_type,
        source_channel=source_channel,
        sponsor_id=sponsor_id,
        broker_id=broker_id,
        fund_id=fund_id,
        assigned_analyst_id=assigned_analyst_id,
        search=search,
        limit=limit,
        offset=offset,
    )


@mcp.tool()
async def mrj_get_deal(deal_id: str, include_details: bool = False) -> dict:
    """Get one MRJ deal by id."""
    return await _run_query(get_deal, deal_id=deal_id, include_details=include_details)


@mcp.tool()
async def mrj_get_deal_statuses() -> dict:
    """Get MRJ deal status vocabularies and transition maps."""
    return await _run_query(get_deal_statuses)


@mcp.tool()
async def mrj_get_deal_allowed_transitions(deal_id: str) -> dict:
    """Get allowed next pipeline and syndication statuses for one MRJ deal."""
    return await _run_query(get_deal_allowed_transitions, deal_id=deal_id)


@mcp.tool()
async def mrj_get_deal_summary(
    pipeline_status: str | None = None,
    syndication_status: str | None = None,
    investment_type: str | None = None,
    source_channel: str | None = None,
    sponsor_id: str | None = None,
    broker_id: str | None = None,
    fund_id: str | None = None,
    assigned_analyst_id: int | None = None,
    search: str | None = None,
) -> dict:
    """Summarize MRJ deal counts and requested amounts."""
    return await _run_query(
        get_deal_summary,
        pipeline_status=pipeline_status,
        syndication_status=syndication_status,
        investment_type=investment_type,
        source_channel=source_channel,
        sponsor_id=sponsor_id,
        broker_id=broker_id,
        fund_id=fund_id,
        assigned_analyst_id=assigned_analyst_id,
        search=search,
    )


def run_stdio():
    mcp.run(transport='stdio')
