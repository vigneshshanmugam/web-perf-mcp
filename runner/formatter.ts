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
      output += `| Function | Original Source | Minified File | CPU Time | CPU % | Calls | Source Mapped \n`;
      output += `|----------|----------------|---------------|----------|-------|-------|---------------|\n`;

      report.high_impact_functions.slice(0, 10).forEach((func) => {
        // Use fullOriginalPath if available, otherwise fall back to originalFile
        const originalSource = func.isSourceMapped
          ? (func.fullOriginalPath || (func.originalFile ? `${func.originalFile}:${func.originalLine}:${func.originalColumn}` : 'N/A'))
          : 'N/A';

        // Extract just the filename from the full path for cleaner display
        const displaySource = func.isSourceMapped && func.fullOriginalPath
          ? `${func.fullOriginalPath.split('/').pop()}:${func.originalLine}:${func.originalColumn}`
          : originalSource;

        const sourceMapped = func.isSourceMapped ? '✅' : '❌';
        const minifiedFile = func.file.split('/').pop() || func.file; // Show just filename for minified

        output += `| ${func.function} | ${displaySource} | ${minifiedFile} | ${func.execution_time_ms}ms | ${func.cpu_percentage}% | ${func.call_count} | ${sourceMapped} |\n`;
      });
      output += `\n`;


    }

    // Flamegraph Analysis for LLM
    if (report.flamegraph_analysis) {
      output += `## 🔥 FLAMEGRAPH ANALYSIS\n\n`;
      output += this.formatFlamegraphAnalysis(report.flamegraph_analysis, report.high_impact_functions);
    }

    return output;
  }

  private async loadMarkdownReport(): Promise<string | null> {
    try {
      const reportPath = join(process.cwd(), 'results', 'report.md');
      if (existsSync(reportPath)) {
        return await readFile(reportPath, 'utf-8');
      }
    } catch (error) {
      console.warn('Could not load markdown report:', error.message);
    }
    return null;
  }

  private formatFlamegraphAnalysis(flamegraph: any, highImpactFunctions: any[]): string {
    let output = '';

    // Helper function to resolve function names using source map data
    const resolveFunctionName = (originalName: string, location?: string) => {
      // Try to find a matching function in high impact functions
      const matchedFunc = highImpactFunctions.find(func =>
        func.function === originalName ||
        (location && func.location === location)
      );

      if (matchedFunc && matchedFunc.isSourceMapped && matchedFunc.fullOriginalPath) {
        const filename = matchedFunc.fullOriginalPath.split('/').pop();
        return `${matchedFunc.function} (${filename}:${matchedFunc.originalLine}:${matchedFunc.originalColumn})`;
      }

      return originalName;
    };

    // Execution Pattern Analysis
    if (flamegraph.visualSummary?.executionPattern) {
      output += `### 📊 Execution Pattern\n\n`;
      output += `**Pattern**: ${flamegraph.visualSummary.executionPattern.pattern}\n`;
      output += `**Description**: ${flamegraph.visualSummary.executionPattern.description}\n\n`;
    }

    // Critical Path Analysis
    if (flamegraph.callStack?.criticalPath) {
      output += `### 🎯 Critical Execution Path\n\n`;
      output += `| Function | Self Time | Total Time | CPU % | Original Source |\n`;
      output += `|----------|-----------|------------|-------|----------------|\n`;

      flamegraph.callStack.criticalPath.forEach((func: any) => {
        const resolvedName = resolveFunctionName(func.function, func.location);
        const originalSource = func.location;
        output += `| ${resolvedName} | ${func.selfTime}ms | ${func.totalTime}ms | ${func.percentage}% | ${originalSource} |\n`;
      });
      output += `\n`;
    }

    // Hot Paths Analysis
    if (flamegraph.hotPaths && flamegraph.hotPaths.length > 0) {
      output += `### 🔥 Hot Execution Paths\n\n`;
      output += `*Most time-consuming call sequences*\n\n`;

      flamegraph.hotPaths.forEach((hotPath: any, index: number) => {
        // Resolve function names in the path
        const resolvedPath = hotPath.path.map((funcName: string) => resolveFunctionName(funcName));
        output += `**${index + 1}. Path (${hotPath.percentage}% CPU, ${hotPath.totalTime}ms)**\n`;
        output += `\`\`\`\n${resolvedPath.join(' → ')}\`\`\`\n\n`;
      });
    }

    // CPU Distribution
    if (flamegraph.visualSummary?.topCPUConsumers) {
      output += `### ⚡ CPU Time Distribution\n\n`;
      output += `| Function | CPU % | Visual Weight |\n`;
      output += `|----------|-------|---------------|\n`;

      flamegraph.visualSummary.topCPUConsumers.forEach((consumer: any) => {
        const resolvedName = resolveFunctionName(consumer.name);
        const bars = '█'.repeat(Math.max(1, Math.floor(consumer.visualWeight / 5)));
        output += `| ${resolvedName} | ${consumer.percentage}% | ${bars} |\n`;
      });
      output += `\n`;
    }

    // Function Hierarchy
    if (flamegraph.functionHierarchy?.rootFunctions) {
      output += `### 🌳 Function Call Hierarchy\n\n`;
      output += `**Root Functions** (Entry points):\n`;
      flamegraph.functionHierarchy.rootFunctions.forEach((root: any) => {
        const resolvedName = resolveFunctionName(root.name);
        output += `- **${resolvedName}** (${root.selfTime}ms self time)\n`;
      });
      output += `\n`;

      if (flamegraph.functionHierarchy.leafFunctions?.length > 0) {
        output += `**Leaf Functions** (Terminal functions):\n`;
        flamegraph.functionHierarchy.leafFunctions.slice(0, 5).forEach((leaf: any) => {
          const resolvedName = resolveFunctionName(leaf.functionName);
          output += `- **${resolvedName}** (${leaf.selfTime}ms, ${leaf.percentage}% CPU)\n`;
        });
        output += `\n`;
      }
    }

    // LLM Analysis Prompt
    output += `### 🤖 LLM Analysis Context\n\n`;
    output += `Look at all the data provided above to identify optimization opportunities that contains web performance metrics, CPU profile analysis, and script execution analysis.\n`;
    output += `Suggest performance optimization techniques and provide alternate code to handle the hot functions.\n\n`;
    return output;
  }
}