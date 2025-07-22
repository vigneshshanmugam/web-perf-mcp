
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
}

export interface TestConfig {
  url: string;
  device?: 'desktop' | 'mobile';
  profile?: boolean;
  headless?: boolean;
}


export interface CPUProfileNode {
  id: number;
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
  functionName: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
  selfTime: number;
  totalTime: number;
  hitCount: number;
  percentage: string;
}
