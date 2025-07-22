
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
}

export interface TestConfig {
  url: string;
  device?: 'desktop' | 'mobile';
  networkThrottling?: 'fast3g' | 'slow3g';
  runs?: number;
  cpuProfiling?: boolean;
  headless?: boolean;
}
