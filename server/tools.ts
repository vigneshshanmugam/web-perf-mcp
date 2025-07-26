export const TOOL_DEFINITIONS = [
  {
    name: 'run_audit',
    description: 'Run a performance audit with CPU profiling on a web page using Lighthouse and Puppeteer',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to audit' },
        device: {
          type: 'string',
          enum: ['desktop', 'mobile'],
          default: 'desktop',
          description: 'Device type for emulation'
        },
        profile: {
          type: 'boolean',
          default: true,
          description: 'Include detailed CPU profiling data'
        },
        headless: {
          type: 'boolean',
          default: true,
          description: 'Run in headless mode'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'analyze_data',
    description: 'Analyze CPU profile and/or trace events data to generate performance insights and recommendations',
    inputSchema: {
      type: 'object',
      properties: {
        cpuProfilePath: {
          type: 'string',
          description: 'Absolute path to the CPU profile JSON file (for flame graph generation and find hot functions)'
        },
        traceEventsPath: {
          type: 'string',
          description: 'Absolute path to the trace events JSON file'
        }
      },
      required: ['cpuProfilePath']
    }
  }
];
