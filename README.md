# web-perf-mcp

MCP Server that audits the web page for finding the bottlenecks and CPU profiling using Lighthouse and Puppeteer.

### Features

- CPU profiling
- Source mapping
- Flamegraph generation
- Provide recommendations to optimize the code

## How

Add the MCP Server - Example Windsurf Config

```json
{
  "mcpServers": {
    "web-perf-mcp": {
      "command": "bash",
      "args": ["-lc", "cd /path/to/web-perf-mcp && ./run-mcp.sh"]
    }
  }
}
```
