from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class SyncLogResponse(BaseModel):
    id: str
    household_id: str
    provider: str
    status: str
    accounts_synced: int
    transactions_imported: int
    error_message: Optional[str]
    started_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SyncStatusResponse(BaseModel):
    last_sync: Optional[SyncLogResponse]
    is_stale: bool
    syncing: bool = False
