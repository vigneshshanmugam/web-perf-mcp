
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
  networkThrottling?: 'fast3g' | 'slow3g';
  profile?: boolean;
  headless?: boolean;
}
