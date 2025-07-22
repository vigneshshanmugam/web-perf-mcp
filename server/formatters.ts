import { PerformanceMetrics } from '../common/types.js';

export function formatResultsForLLM(results: PerformanceMetrics): string {
  return `
PERFORMANCE AUDIT RESULTS

URL: ${results.url}
Overall Performance Score: ${results.performanceScore}/100
Timestamp: ${results.timestamp}

Core Web Vitals:
- First Contentful Paint (FCP): ${results.coreWebVitals.fcp.value}ms (${results.coreWebVitals.fcp.rating})
- Largest Contentful Paint (LCP): ${results.coreWebVitals.lcp.value}ms (${results.coreWebVitals.lcp.rating})
- Cumulative Layout Shift (CLS): ${results.coreWebVitals.cls.value} (${results.coreWebVitals.cls.rating})
- Time to First Byte (TTFB): ${results.coreWebVitals.ttfb.value}ms (${results.coreWebVitals.ttfb.rating})

Data: ${JSON.stringify(results, null, 2)}
`;
}

export function generateAnalysisPrompt(results: PerformanceMetrics): string {
  return `Please analyze this performance data and provide specific, actionable optimization recommendations. Focus on the most impactful improvements first.

${formatResultsForLLM(results)}

Consider the following in your analysis:
1. Which Core Web Vitals need the most attention?
2. What are the root causes of performance issues?
3. Are there any critical rendering path bottlenecks?
4. How can the main thread blocking time be reduced?
5. What specific code or configuration changes would you recommend?

Please provide concrete, implementable suggestions with estimated impact.`;
}
