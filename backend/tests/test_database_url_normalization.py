from app.database import normalize_asyncpg_url


def test_adds_asyncpg_driver_to_plain_postgresql_url():
    assert normalize_asyncpg_url("postgresql://u:p@host/db") == "postgresql+asyncpg://u:p@host/db"


def test_leaves_already_asyncpg_url_unchanged():
    url = "postgresql+asyncpg://u:p@host/db"
    assert normalize_asyncpg_url(url) == url


def test_strips_sslmode_and_channel_binding_neon_gives_by_default():
    url = "postgresql://u:p@host/db?channel_binding=require&sslmode=require"
    out = normalize_asyncpg_url(url)
    assert "sslmode" not in out
    assert "channel_binding" not in out
    assert out.startswith("postgresql+asyncpg://u:p@host/db")


def test_keeps_other_query_params():
    url = "postgresql://u:p@host/db?sslmode=require&application_name=myapp"
    out = normalize_asyncpg_url(url)
    assert "application_name=myapp" in out
    assert "sslmode" not in out
