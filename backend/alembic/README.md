# Database migrations (Alembic)

Schema changes for the backend are managed by Alembic. The container entrypoint
runs `alembic upgrade head` before starting uvicorn, so in normal operation you
don't need to do anything by hand — just commit a new revision and redeploy.

Configuration lives in:

- `backend/alembic.ini` — script location and generic settings. The `sqlalchemy.url`
  there is a placeholder; the real DSN is injected at runtime by `env.py`.
- `backend/alembic/env.py` — reads `app.config.get_settings().database_url_sync`
  and sets `target_metadata = Base.metadata`. Always uses the sync driver
  (psycopg2) because Alembic's offline/autogenerate paths don't support asyncpg.
- `backend/alembic/versions/` — one file per revision, chained by `down_revision`.

## Day-to-day commands

All commands run from `backend/` with the project's venv active and the same
environment variables the app uses (`DATABASE_URL_SYNC`, `SECRET_KEY`, ...).

### Apply pending migrations

```bash
cd backend && alembic upgrade head
```

Runs every revision between the database's current head and the latest on disk.
Idempotent: if already at head, it's a no-op.

### Create a new migration

1. Change the SQLAlchemy model(s) under `app/models/`.
2. Generate a revision against a database that is already at head:

   ```bash
   cd backend && alembic revision --autogenerate -m "add foo to accounts"
   ```

3. Review the generated file under `alembic/versions/` — autogenerate is a
   starting point, not gospel. Pay attention to index renames, server defaults,
   and data migrations (which you must write by hand).
4. Apply locally to verify:

   ```bash
   alembic upgrade head
   ```

5. Commit the model change and the revision file in the same commit.

### Inspect state

```bash
alembic current           # which revision is the DB at?
alembic history --verbose # full chain
alembic heads             # latest on disk (should be one)
alembic show <rev>        # details of a specific revision
```

### One-time: adopt Alembic on an existing deployed database

The production database already has the baseline schema from the old inline
runners. Tell Alembic it's already applied — do **not** run `upgrade head`
without stamping first, or it will try to create tables that already exist:

```bash
cd backend && alembic stamp head
```

From then on, `alembic upgrade head` on deploy just applies new revisions.

### Fresh database (dev / CI / new environment)

```bash
cd backend && alembic upgrade head
```

Creates the whole schema from the baseline. No stamp needed.

### Downgrade

```bash
alembic downgrade -1        # one step back
alembic downgrade 0001_...  # to a specific revision
alembic downgrade base      # all the way off — destructive
```

The baseline's `downgrade()` drops every table. Use with extreme care; never
run this against production.

## Conventions

- Revision file names are `NNNN_short_slug.py`; `NNNN` is zero-padded and
  monotonic for readability in directory listings (Alembic itself keys on the
  `revision` string inside the file, not the filename).
- One logical change per revision. Never edit a revision that has been applied
  to any shared database.
- Data migrations: write raw SQL via `op.execute(...)` or use SQLAlchemy core —
  never `import app.models` inside a revision (models drift from the schema the
  revision targets). The baseline is an exception because it captures the
  whole-of-schema starting point.
