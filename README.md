# perf-audit-tool

Performance auditing tool with Lighthouse, Playwright, and LLM analysis

## How

Add the MCP Server - Example Windsurf Config

```json
{
  "mcpServers": {
    "perf-audit": {
      "command": "bash",
      "args": ["-lc", "cd /path/to/perf-audit && ./run-mcp.sh"]
    }
  }
}
```
