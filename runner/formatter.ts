import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";


export default class Formatter {
  async formatStructuredAnalysis(report: any): Promise<string> {
    let output = `# COMPREHENSIVE PERFORMANCE ANALYSIS\n\n`;

    // Load markdown report for Web Vitals context
    const markdownReport = await this.loadMarkdownReport();

    output += `## 🎯 EXECUTIVE SUMMARY\n`;
    output += `- **Performance Score**: ${report.executive_summary.performance_score}/100\n`;
    output += `- **Total CPU Execution Time**: ${report.executive_summary.total_execution_time_ms}ms\n`;
    output += `- **Total Samples**: ${report.executive_summary.total_samples}\n`;
    output += `- **Sample Interval**: ${report.executive_summary.sample_interval_ms}ms\n`;

    if (report.executive_summary.top_bottleneck) {
      output += `- **Primary CPU Bottleneck**: ${report.executive_summary.top_bottleneck.function}\n`;
      output += `- **Impact**: ${report.executive_summary.top_bottleneck.impact}\n`;
    }
    output += `\n`;

    // Web Vitals Context from Markdown Report
    if (markdownReport) {
      output += `## 📊 WEB VITALS & LONG TASKS CORRELATION\n`;
      output += markdownReport;
      output += `\n`;
    }

    // Critical Performance Issues with Context
    if (report.critical_performance_issues.length > 0) {
      output += `## 🚨 CRITICAL PERFORMANCE ISSUES (${report.critical_performance_issues.length})\n`;
      report.critical_performance_issues.forEach((issue, index) => {
        output += `### ${index + 1}. ${issue.function}\n`;
        output += `- **Severity**: ${issue.severity}\n`;
        output += `- **Impact**: ${issue.impact}\n`;
        output += `- **Location**: ${issue.location}\n`;
        output += `- **Optimization Priority**: ${this.calculateOptimizationPriority(issue)}\n\n`;
      });
    }

    // High Impact Functions with Actionable Context
    output += `## ⚡ HIGH IMPACT CPU FUNCTIONS\n`;
    output += `*Functions consuming the most CPU time and blocking the main thread*\n\n`;

    report.high_impact_functions.slice(0, 10).forEach((func, index) => {
      output += `### ${index + 1}. ${func.function}\n`;
      output += `- **File**: ${func.file}\n`;
      output += `- **CPU Time**: ${func.execution_time_ms}ms (${func.cpu_percentage}% of total)\n`;
      output += `- **Call Count**: ${func.call_count}\n`;
      output += `- **Location**: ${func.location}\n`;
      output += `- **Optimization Suggestion**: ${this.generateOptimizationSuggestion(func)}\n\n`;
    });

    // Script Performance Analysis with Long Tasks Correlation
    if (report.script_performance) {
      output += `## 🔍 SCRIPT EXECUTION & LONG TASKS ANALYSIS\n`;

      if (report.script_performance.long_running_tasks && report.script_performance.long_running_tasks.length > 0) {
        output += `### Long Running Tasks (${report.script_performance.long_running_tasks.length})\n`;
        output += `*Tasks that block the main thread and hurt user experience*\n\n`;

        report.script_performance.long_running_tasks.slice(0, 10).forEach((task, index) => {
          output += `${index + 1}. **${task.name}** - ${task.duration}ms\n`;
          output += `   - Impact on Core Web Vitals: ${this.assessLongTaskImpact(task)}\n`;
        });
        output += `\n`;
      }

      if (report.script_performance.script_execution_analysis && report.script_performance.script_execution_analysis.length > 0) {
        output += `### Script Execution Breakdown\n`;
        report.script_performance.script_execution_analysis.slice(0, 10).forEach((script, index) => {
          output += `${index + 1}. **${script.type}** - ${script.duration}ms\n`;
        });
        output += `\n`;
      }
    }

    // Cross-Referenced Optimization Recommendations
    output += `## 🎯 PRIORITIZED OPTIMIZATION RECOMMENDATIONS\n`;
    output += this.generateCrossReferencedRecommendations(report, markdownReport);
    output += `\n`;

    // LLM Analysis Context
    if (report.llm_analysis_prompt) {
      output += `## 🤖 AI ANALYSIS CONTEXT\n`;
      output += `${JSON.stringify(report.llm_analysis_prompt, null, 2)}\n\n`;
    }

    // Raw Data for Deep Analysis
    output += `## 📋 RAW PERFORMANCE DATA\n`;
    output += `\`\`\`json\n${JSON.stringify(report, null, 2)}\`\`\`\n\n`;

    return output;
  }

  private async loadMarkdownReport(): Promise<string | null> {
    try {
      const reportPath = join(process.cwd(), 'audit-results', 'performance-audit-report.md');
      if (existsSync(reportPath)) {
        return await readFile(reportPath, 'utf-8');
      }
    } catch (error) {
      console.warn('Could not load markdown report:', error.message);
    }
    return null;
  }

  private calculateOptimizationPriority(issue: any): string {
    if (issue.severity === 'CRITICAL') {
      return '🔴 HIGH - Address immediately';
    } else if (issue.severity === 'HIGH') {
      return '🟡 MEDIUM - Address soon';
    }
    return '🟢 LOW - Address when possible';
  }

  private generateOptimizationSuggestion(func: any): string {
    const suggestions = {
      'googletagmanager.com': 'Consider lazy loading GTM or using server-side tagging',
      'analytics': 'Implement analytics batching or use measurement protocol',
      'jquery': 'Consider replacing with vanilla JS or modern framework',
      'lodash': 'Use tree-shaking or replace with native methods',
      'moment': 'Replace with date-fns or native Date API',
      'polyfill': 'Audit if polyfills are still needed for target browsers'
    };

    for (const [key, suggestion] of Object.entries(suggestions)) {
      if (func.file.toLowerCase().includes(key) || func.function.toLowerCase().includes(key)) {
        return suggestion;
      }
    }

    if (func.cpu_percentage > 10) {
      return 'High CPU usage - consider code splitting, caching, or algorithm optimization';
    } else if (func.call_count > 1000) {
      return 'High call frequency - consider memoization or batching';
    }

    return 'Monitor for performance regressions and consider optimization if usage increases';
  }

  private assessLongTaskImpact(task: any): string {
    if (task.duration > 100) {
      return 'Severely impacts FCP, LCP, and FID - Critical optimization needed';
    } else if (task.duration > 50) {
      return 'Moderately impacts Core Web Vitals - Optimization recommended';
    }
    return 'Minor impact on Core Web Vitals - Monitor for increases';
  }

  private generateCrossReferencedRecommendations(report: any, markdownReport: string | null): string {
    let recommendations = '';

    // Priority 1: Critical Issues
    if (report.critical_performance_issues.length > 0) {
      recommendations += `### 🔴 Priority 1: Critical Issues\n`;
      report.critical_performance_issues.forEach((issue, index) => {
        recommendations += `${index + 1}. **${issue.function}** - ${issue.impact}\n`;
      });
      recommendations += `\n`;
    }

    // Priority 2: Long Tasks Optimization
    if (report.script_performance?.long_running_tasks?.length > 0) {
      recommendations += `### 🟡 Priority 2: Long Tasks Optimization\n`;
      recommendations += `- Break up long-running tasks using \`setTimeout\` or \`requestIdleCallback\`\n`;
      recommendations += `- Implement code splitting for large JavaScript bundles\n`;
      recommendations += `- Consider web workers for CPU-intensive operations\n\n`;
    }

    // Priority 3: High Impact Functions
    if (report.high_impact_functions.length > 0) {
      recommendations += `### 🟢 Priority 3: Function-Level Optimizations\n`;
      const topFunction = report.high_impact_functions[0];
      recommendations += `- Focus on optimizing \`${topFunction.function}\` (${topFunction.cpu_percentage}% CPU usage)\n`;
      recommendations += `- Consider caching, memoization, or algorithm improvements\n`;
      recommendations += `- Profile individual function calls for micro-optimizations\n\n`;
    }

    // Web Vitals Specific Recommendations
    if (markdownReport && markdownReport.includes('needs-improvement')) {
      recommendations += `### 📊 Core Web Vitals Improvements\n`;
      if (markdownReport.includes('First Contentful Paint')) {
        recommendations += `- **FCP Optimization**: Reduce render-blocking resources, optimize critical rendering path\n`;
      }
      if (markdownReport.includes('Largest Contentful Paint')) {
        recommendations += `- **LCP Optimization**: Optimize largest content element, improve server response times\n`;
      }
      recommendations += `\n`;
    }

    return recommendations;
  }
}