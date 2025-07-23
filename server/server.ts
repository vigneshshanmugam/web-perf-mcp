import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { TestConfig } from '../runner/types.js';
import { TOOL_DEFINITIONS } from './tools.js';
import { PerformanceHandlers } from './handlers.js';

export class PerformanceAuditServer {
  private server: Server;
  private handlers: PerformanceHandlers;

  constructor() {
    this.server = new Server(
      {
        name: 'performance-audit-server',
        version: '0.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.handlers = new PerformanceHandlers();
    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOL_DEFINITIONS,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'run_performance_audit':
            return await this.handlers.runPerformanceAudit(args as unknown as TestConfig);
          case 'analyze_performance_data':
            return await this.handlers.analyzePerformanceData(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('Performance Audit MCP Server started');
  }
}

export default PerformanceAuditServer;
