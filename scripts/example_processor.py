import pandas as pd
import logging

logger = logging.getLogger(__name__)


def process(df: pd.DataFrame) -> dict:
    """Process a dataframe and return results."""
    logger.info("Starting example processor with %d rows", len(df))
    # TODO: add processing logic here
    return {"row_count": len(df), "columns": list(df.columns)}
