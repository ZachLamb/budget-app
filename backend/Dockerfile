FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Entrypoint runs `alembic upgrade head` before starting uvicorn. Extra args
# passed via `docker run` or the compose `command:` key are forwarded to
# uvicorn (e.g. `--reload` for the dev container).
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
