from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://budget:budget_dev_pass@localhost:5432/budget_app"
    database_url_sync: str = "postgresql://budget:budget_dev_pass@localhost:5432/budget_app"
    secret_key: str = "dev-secret-change-in-production"
    simplefin_access_url: str = ""
    anthropic_api_key: str = ""
    sync_interval_hours: int = 4
    sync_stale_minutes: int = 30

    model_config = {"env_file": ".env"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
