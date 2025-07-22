export const TOOL_DEFINITIONS = [
  {
    name: 'run_performance_audit',
    description: 'Run a comprehensive performance audit on a web page using Lighthouse and Playwright',
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
        networkThrottling: {
          type: 'string',
          enum: ['fast3g', 'slow3g'],
          default: 'fast3g',
          description: 'Network throttling simulation'
        },
        profile: {
          type: 'boolean',
          default: true,
          description: 'Include detailed CPU profiling data'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'get_performance_history',
    description: 'Retrieve historical performance data for comparison and trend analysis',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to get history for' },
        days: { type: 'number', default: 30, description: 'Number of days of history to retrieve' }
      },
      required: ['url']
    }
  },
  {
    name: 'compare_performance',
    description: 'Compare performance metrics between two URLs or time periods',
    inputSchema: {
      type: 'object',
      properties: {
        baselineUrl: { type: 'string', description: 'Baseline URL for comparison' },
        targetUrl: { type: 'string', description: 'Target URL to compare against baseline' },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          default: ['fcp', 'lcp', 'cls', 'ttfb'],
          description: 'Specific metrics to compare'
        }
      },
      required: ['baselineUrl', 'targetUrl']
    }
  },
  {
    name: 'analyze_performance_trends',
    description: 'Analyze performance trends and generate insights for optimization',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'Performance data identifier or cache key' },
        focusAreas: {
          type: 'array',
          items: { type: 'string' },
          default: ['loading', 'interactivity', 'visual-stability'],
          description: 'Areas to focus optimization suggestions on'
        }
      },
      required: ['data']
    }
  },
  {
    name: 'analyze_performance_data',
    description: 'Analyze CPU profile and/or trace events data to generate comprehensive performance insights and recommendations',
    inputSchema: {
      type: 'object',
      properties: {
        cpuProfilePath: {
          type: 'string',
          description: 'Absolute path to the CPU profile JSON file (required for CPU analysis)'
        },
        traceEventsPath: {
          type: 'string',
          description: 'Absolute path to the trace events JSON file (optional, enhances analysis when provided)'
        }
      },
      required: ['cpuProfilePath']
    }
  }
];
