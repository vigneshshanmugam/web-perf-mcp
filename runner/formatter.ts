import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CPUProfileAnalysis } from "./types";


export default class Formatter {
  async formatStructuredAnalysis(report: CPUProfileAnalysis): Promise<string> {
    let output = `# COMPREHENSIVE PERFORMANCE ANALYSIS\n\n`;

    output += `## 🎯 EXECUTIVE SUMMARY\n`;
    output += `- **Total CPU Execution Time**: ${report.executive_summary.total_execution_time_ms}ms\n`;
    output += `- **Total Samples**: ${report.executive_summary.total_samples}\n`;
    output += `- **Sample Interval**: ${report.executive_summary.sample_interval_ms}ms\n`;
    output += `\n`;

    const markdownReport = await this.loadMarkdownReport();
    if (markdownReport) {
      output += `## 📊 WEB VITALS & LONG TASKS CORRELATION\n`;
      output += markdownReport;
      output += `\n`;
    }

    output += `## ⚡ HIGH IMPACT CPU FUNCTIONS\n`;
    output += `*Functions consuming the most CPU time and blocking the main thread*\n\n`;

    if (report.high_impact_functions.length > 0) {
      output += `### Function Performance Details\n\n`;
      output += `| Function | Original Source | File | CPU Time | CPU % | Calls | Source Mapped \n`;
      output += `|----------|----------------|------|----------|-------|-------|---------------|\n`;

      report.high_impact_functions.slice(0, 10).forEach((func) => {
        const originalSource = func.originalFile && func.isSourceMapped
          ? `${func.originalFile}:${func.originalLine}`
          : 'N/A';
        const sourceMapped = func.isSourceMapped ? '✅' : '❌';
        output += `| ${func.function} | ${originalSource} | ${func.file} | ${func.execution_time_ms}ms | ${func.cpu_percentage}% | ${func.call_count} | ${sourceMapped} |\n`;
      });
      output += `\n`;
    }

    if (report.script_performance) {
      output += `## 🔍 SCRIPT EXECUTION\n\n`;
      if (report.script_performance.script_execution_analysis && report.script_performance.script_execution_analysis.length > 0) {
        output += `### Script Execution Breakdown\n\n`;
        output += `| Script Type | Duration | URL | Start Time |\n`;
        output += `|-------------|----------|-----|------------|\n`;

        report.script_performance.script_execution_analysis.slice(0, 10).forEach((script) => {
          const hostname = script.url ? new URL(script.url).hostname : 'Unknown';
          output += `| ${script.type} | ${script.duration}ms | ${hostname} | ${script.startTime.toFixed(1)}ms |\n`;
        });
        output += `\n`;
      }
    }

    // Flamegraph Analysis for LLM
    if (report.flamegraph_analysis) {
      output += `## 🔥 FLAMEGRAPH ANALYSIS\n\n`;
      output += this.formatFlamegraphAnalysis(report.flamegraph_analysis);
    }

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

  private formatFlamegraphAnalysis(flamegraph: any): string {
    let output = '';

    // Execution Pattern Analysis
    if (flamegraph.visualSummary?.executionPattern) {
      output += `### 📊 Execution Pattern\n\n`;
      output += `**Pattern**: ${flamegraph.visualSummary.executionPattern.pattern}\n`;
      output += `**Description**: ${flamegraph.visualSummary.executionPattern.description}\n\n`;
    }

    // Critical Path Analysis
    if (flamegraph.callStack?.criticalPath) {
      output += `### 🎯 Critical Execution Path\n\n`;
      output += `| Function | Self Time | Total Time | CPU % | Location |\n`;
      output += `|----------|-----------|------------|-------|----------|\n`;

      flamegraph.callStack.criticalPath.forEach((func: any) => {
        output += `| ${func.function} | ${func.selfTime}ms | ${func.totalTime}ms | ${func.percentage}% | ${func.location} |\n`;
      });
      output += `\n`;
    }

    // Hot Paths Analysis
    if (flamegraph.hotPaths && flamegraph.hotPaths.length > 0) {
      output += `### 🔥 Hot Execution Paths\n\n`;
      output += `*Most time-consuming call sequences*\n\n`;

      flamegraph.hotPaths.forEach((hotPath: any, index: number) => {
        output += `**${index + 1}. Path (${hotPath.percentage}% CPU, ${hotPath.totalTime}ms)**\n`;
        output += `\`\`\`\n${hotPath.path.join(' → ')}\`\`\`\n\n`;
      });
    }

    // CPU Distribution
    if (flamegraph.visualSummary?.topCPUConsumers) {
      output += `### ⚡ CPU Time Distribution\n\n`;
      output += `| Function | CPU % | Visual Weight |\n`;
      output += `|----------|-------|---------------|\n`;

      flamegraph.visualSummary.topCPUConsumers.forEach((consumer: any) => {
        const bars = '█'.repeat(Math.max(1, Math.floor(consumer.visualWeight / 5)));
        output += `| ${consumer.name} | ${consumer.percentage}% | ${bars} |\n`;
      });
      output += `\n`;
    }

    // Function Hierarchy
    if (flamegraph.functionHierarchy?.rootFunctions) {
      output += `### 🌳 Function Call Hierarchy\n\n`;
      output += `**Root Functions** (Entry points):\n`;
      flamegraph.functionHierarchy.rootFunctions.forEach((root: any) => {
        output += `- **${root.name}** (${root.selfTime}ms self time)\n`;
      });
      output += `\n`;

      if (flamegraph.functionHierarchy.leafFunctions?.length > 0) {
        output += `**Leaf Functions** (Terminal functions):\n`;
        flamegraph.functionHierarchy.leafFunctions.slice(0, 5).forEach((leaf: any) => {
          output += `- **${leaf.functionName}** (${leaf.selfTime}ms, ${leaf.percentage}% CPU)\n`;
        });
        output += `\n`;
      }
    }

    // LLM Analysis Prompt
    output += `### 🤖 LLM Analysis Context\n\n`;
    output += `Look at all the data provided above to identify optimization opportunities that contains web performance metrics, CPU profile analysis, and script execution analysis.\n`;
    output += `Suggest performance optimization opportunities and provide even code examples to handle the hot functions.\n\n`;
    return output;
  }
}