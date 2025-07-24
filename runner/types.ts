import { Result } from "lighthouse";


export interface TestConfig {
  url: string;
  device?: 'desktop' | 'mobile';
  profile?: boolean;
  headless?: boolean;
}

export interface MetricRating {
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor' | 'unknown';
}

// Performance metrics schema
export interface PerformanceMetrics {
  url: string;
  timestamp: string;
  coreWebVitals: {
    fcp: MetricRating;
    lcp: MetricRating;
    cls: MetricRating;
    ttfb: MetricRating;
  };
  performanceScore: number;
  longTasks: Result["audits"]["long-tasks"];
}

// CPU Profile Analysis
export interface CPUProfileAnalysis {
  executive_summary: {
    total_execution_time_ms: number;
    total_samples: number;
    sample_interval_ms: number;
  };

  high_impact_functions: Array<{
    function: string;
    file: string;
    execution_time_ms: number;
    cpu_percentage: string;
    call_count: number;
    location: string;
    originalFile?: string;
    originalLine?: number;
    originalColumn?: number;
    originalName?: string | null;
    isSourceMapped?: boolean;
    // Enhanced fields for better LLM analysis
    fullOriginalPath?: string;
    sourceMapUrl?: string;
    resolvedStackTrace?: string;
  }>;
  flamegraph_analysis?: {
    callStack: {
      deepestStacks: Array<{ depth: number, path: string[] }>;
      mostFrequentPaths: Array<{ path: string[], frequency: number }>;
      criticalPath: Array<{
        function: string;
        selfTime: number;
        totalTime: number;
        percentage: string;
        location: string;
      }>;
    };
    hotPaths: Array<{ path: string[], totalTime: number, percentage: string }>;
    functionHierarchy: {
      rootFunctions: Array<{ name: string, selfTime: number, children: Array<{ name: string, selfTime: number }> }>;
      leafFunctions: Array<any>;
    };
    visualSummary: {
      totalExecutionTime: number;
      topCPUConsumers: Array<{ name: string, percentage: string, visualWeight: number }>;
      bottleneckDistribution: Array<{ severity: string, function: string, impact: string }>;
      executionPattern: { pattern: string, description: string };
    };
  };
}


export interface CPUProfileNode {
  id: number;
  selfTime: number;
  totalTime: number;
  parent: CPUProfileNode | null;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  children?: number[];
  hitCount?: number;
}

export interface CPUProfile {
  nodes: CPUProfileNode[];
  samples: number[];
  timeDeltas?: number[];
  startTime?: number;
  endTime?: number;
  sampleInterval?: number;
}

export interface AggregatedFunction {
  nodeId: number;               // CPU profile node ID for call stack traversal
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  selfTime: number;
  totalTime: number;
  hitCount: number;
  percentage: string;
  originalFile?: string;
  originalLine?: number;
  originalColumn?: number;
  originalName?: string | null;
  isSourceMapped?: boolean;
  // Enhanced fields for better LLM analysis
  fullOriginalPath?: string;    // Complete untruncated original path
  sourceMapUrl?: string;        // URL of the source map used
  resolvedStackTrace?: string;  // Complete stack trace context
}
