# web-perf-mcp

MCP Server that audits the web page for finding the bottlenecks and CPU profiling using Lighthouse and Puppeteer.

### Features

- **CPU Profiling:** Capture CPU profiling using devtools protocol and generate flamegraphs.
- **Source Map Resolution:** Map minified code back to original source files and lines.
- **Stack Trace Generation:** Generate stack trace for hot functions.
- **Optimization Recommendations:** Provide recommendations to optimize the code.

## How to use

Add the MCP Server - Example Windsurf Config

```json
{
  "mcpServers": {
    "web-perf-mcp": {
      "command": "npx",
      "args": ["web-perf-mcp"]
    }
  }
}
```

## Available Tools

### run_audit

Run a performance audit with CPU profiling on a web page using Lighthouse and Puppeteer

#### Parameters

- url: URL to audit
- device: Device type for emulation (desktop|mobile)
- profile: Enable CPU profiling (default: false)
- headless: Run in headless mode (default: true)

## analyze_data

Analyze CPU profile and/or trace events data to generate performance insights and recommendations

#### Parameters

- cpuProfilePath: Absolute path to the CPU profile JSON file (required for CPU analysis)
- traceEventsPath: Absolute path to the trace events JSON file.

## Usage as CLI

```sh
npx web-perf-mcp

npm i -g web-perf-mcp
```

Run audit and analyze profile

```sh
// run Audit for a website
npx web-perf-mcp audit --url https://example.com --profile

// analyze CPU profile and provide recommendations
npx web-perf-mcp analyze --profile path/to/profile
```
