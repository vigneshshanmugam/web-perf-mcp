
export interface MetricRating {
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor' | 'unknown';
  average: number;
  min: number;
  max: number;
}

// Performance metrics schema
export interface PerformanceMetrics {
  url: string;
  timestamp: string;
  testRuns: number;
  coreWebVitals: {
    fcp: MetricRating;
    lcp: MetricRating;
    cls: MetricRating;
    ttfb: MetricRating;
  };
  performanceScore: number;
  diagnostics: Array<{
    id: string;
    title: string;
    description: string;
    severity: 'error' | 'warning' | 'info';
  }>;
}

export interface TestConfig {
  url: string;
  device?: 'desktop' | 'mobile';
  networkThrottling?: 'fast3g' | 'slow3g' | 'none';
  runs?: number;
  cpuProfiling?: boolean;
  headless?: boolean;
}
