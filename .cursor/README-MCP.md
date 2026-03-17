# Docker MCP (this project)

The Docker MCP server is configured in `.cursor/mcp.json`. It lets the AI list containers, fetch logs, start/stop containers, manage images/volumes/networks, and help debug your Docker setup.

## Requirements

**Option A – uv (recommended)**  
Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (macOS: `brew install uv`), then restart Cursor. The config uses `uvx mcp-server-docker` and will work as-is.

**Option B – Run the server in Docker**  
If you prefer not to use uv:

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

After that, the Docker MCP tools (e.g. list containers, fetch logs) will be available in Cursor for this project.
