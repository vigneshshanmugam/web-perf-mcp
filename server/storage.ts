import fs from 'node:fs/promises';
import path from 'node:path';
import { PerformanceMetrics } from '../common/types';

export class PerformanceStorage {
  private dataDir: string;

  constructor(dataDir: string = path.join(process.cwd(), 'data')) {
    this.dataDir = dataDir;
  }

  async storeResults(results: PerformanceMetrics): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });

    const filename = this.urlToFilename(results.url);
    const filepath = path.join(this.dataDir, `${filename}.json`);

    let history: PerformanceMetrics[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      history = JSON.parse(existing);
    } catch {
      // File doesn't exist, start fresh
    }

    history.push(results);

    // Keep only last 100 results
    if (history.length > 100) {
      history = history.slice(-100);
    }

    await fs.writeFile(filepath, JSON.stringify(history, null, 2));
  }

  async getHistory(url: string, days: number = 30): Promise<PerformanceMetrics[]> {
    const filename = this.urlToFilename(url);
    const filepath = path.join(this.dataDir, `${filename}.json`);

    try {
      const data = await fs.readFile(filepath, 'utf-8');
      const history: PerformanceMetrics[] = JSON.parse(data);

      // Filter by date if needed
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      return history.filter(result => new Date(result.timestamp) >= cutoffDate);
    } catch {
      return [];
    }
  }

  private urlToFilename(url: string): string {
    return url.replace(/[^a-zA-Z0-9]/g, '_');
  }
}
