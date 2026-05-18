# MCP servers (this project)

Project MCP config: [`.cursor/mcp.json`](mcp.json). Restart Cursor after editing.

## Fly.io (`fly`)

Uses the official [flyctl MCP server](https://fly.io/docs/flyctl/mcp-server/) so agents can manage apps, machines, secrets (names), logs, and deploys for **`clarity-backend`** / **`clarity-db`** without shell-only workflows.

### Requirements

1. [flyctl](https://fly.io/docs/hands-on/install-flyctl/) on your `PATH` (`brew install flyctl`).
2. Logged in: `fly auth login` (token lives in `~/.fly/`, not in this repo).
3. Restart Cursor so the `fly` MCP server loads.

### Install / refresh (optional)

To regenerate the entry from flyctl (may use an absolute `fly` path — edit to `"fly"` for portability):

```bash
fly mcp server --cursor --config .cursor/mcp.json --server fly
```

### Security

- Do **not** put `FLY_API_ACCESS_TOKEN` or deploy URLs in tracked files — see [`.cursor/rules/secrets-and-credentials.mdc`](rules/secrets-and-credentials.mdc).
- MCP tools can change production; confirm destructive actions in chat before approving tool calls.

---

## Docker (`docker` / `MCP_DOCKER`)

The Docker MCP server lets the AI list containers, fetch logs, start/stop containers, manage images/volumes/networks, and help debug local Docker Compose.

### Requirements (Option A – uv, recommended)

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (macOS: `brew install uv`), then restart Cursor. The config uses `uvx mcp-server-docker`.

### Requirements (Option B – run server in Docker)

1. Clone and build the image:

   ```bash
   git clone https://github.com/ckreiling/mcp-server-docker.git /tmp/mcp-server-docker
   cd /tmp/mcp-server-docker && docker build -t mcp-server-docker .
   ```

2. In `.cursor/mcp.json`, replace the `"docker"` entry with:

   ```json
   "docker": {
     "command": "docker",
     "args": [
       "run",
       "-i",
       "--rm",
       "-v",
       "/var/run/docker.sock:/var/run/docker.sock",
       "mcp-server-docker:latest"
     ]
   }
   ```

3. Restart Cursor.
