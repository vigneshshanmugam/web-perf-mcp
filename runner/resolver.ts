import { SourceMapConsumer } from 'source-map';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export interface Location {
  url: string,
  line: number,
  column: number,
  originalFunctionName?: string
}

export interface ResolvedLocation {
  originalFile: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
  isResolved: boolean;
  minifiedUrl: string;
  fullOriginalPath?: string;
  sourceMapUrl?: string;
}

export class SourceMapResolver {
  private sourceMapCache = new Map<string, { url: string | null, map: SourceMapConsumer | null }>();
  private fileContentsCache = new Map<string, string>();
  private locationsMap = new Map<string, ResolvedLocation>();

  async resolveLocation(url: string, line: number = 1, column: number = 1, originalFunctionName?: string): Promise<ResolvedLocation> {
    const defaultResult: ResolvedLocation = {
      originalFile: url,
      originalLine: line,
      originalColumn: column,
      originalName: null,
      isResolved: false,
      minifiedUrl: url
    };

    try {
      if (!this.isMinifiedJavaScript(url)) {
        return defaultResult;
      }

      const sourceMapData = await this.retrieveSourceMap(url);
      if (!sourceMapData) {
        return defaultResult;
      }

      const sourceMap = await new SourceMapConsumer(sourceMapData.map);
      const originalPosition = sourceMap.originalPositionFor({ line, column });

      if (originalPosition.source) {
        let functionName = originalPosition.name || originalFunctionName;
        return {
          originalFile: this.cleanSourcePath(originalPosition.source),
          originalLine: originalPosition.line || line,
          originalColumn: originalPosition.column || column,
          originalName: functionName,
          isResolved: true,
          minifiedUrl: url,
          fullOriginalPath: originalPosition.source,
          sourceMapUrl: sourceMapData.url
        };
      }

      return defaultResult;
    } catch (error) {
      console.warn(`Failed to resolve source map for ${url}:`, error);
      return defaultResult;
    }
  }

  async resolveLocations(locations: Location[]): Promise<ResolvedLocation[]> {
    return Promise.all(
      locations.map(async loc => {
        try {
          if ((!loc.line || !loc.column) && this.locationsMap.has(loc.url)) {
            return this.locationsMap.get(loc.url);
          }
          const resolvedLocation = await this.resolveLocation(loc.url, loc.line, loc.column, loc.originalFunctionName);
          this.locationsMap.set(loc.url, resolvedLocation);
          return resolvedLocation;
        } catch (e) {
          console.error(`Failed to resolve location for ${loc.url}:`, e);
          return {
            originalFile: loc.url,
            originalLine: loc.line,
            originalColumn: loc.column,
            originalName: null,
            isResolved: false,
            minifiedUrl: loc.url
          };
        }
      })
    );
  }

  private async retrieveSourceMap(source: string): Promise<{ url: string, map: any } | null> {
    // Check cache first
    if (this.sourceMapCache.has(source)) {
      const cached = this.sourceMapCache.get(source)!;
      if (cached.map) {
        return { url: cached.url!, map: cached.map };
      }
    }

    const sourceMappingURL = await this.retrieveSourceMapURL(source);
    if (!sourceMappingURL) {
      this.sourceMapCache.set(source, { url: null, map: null });
      return null;
    }

    let sourceMapData: string;
    let sourceMapUrl = sourceMappingURL;

    if (sourceMappingURL.startsWith('data:application/json')) {
      const base64Match = sourceMappingURL.match(/base64,(.+)$/);
      if (base64Match) {
        sourceMapData = Buffer.from(base64Match[1], 'base64').toString();
        sourceMapUrl = source;
      } else {
        const jsonMatch = sourceMappingURL.match(/,(.+)$/);
        sourceMapData = jsonMatch ? decodeURIComponent(jsonMatch[1]) : '';
        sourceMapUrl = source;
      }
    } else {
      sourceMapUrl = this.resolveUrl(source, sourceMappingURL);
      const content = await this.retrieveFile(sourceMapUrl);
      if (!content) {
        this.sourceMapCache.set(source, { url: null, map: null });
        return null;
      }
      sourceMapData = content;
    }

    if (!sourceMapData) {
      this.sourceMapCache.set(source, { url: null, map: null });
      return null;
    }

    try {
      const parsedMap = JSON.parse(sourceMapData);
      const consumer = await new SourceMapConsumer(parsedMap);
      this.sourceMapCache.set(source, { url: sourceMapUrl, map: consumer });
      return {
        url: sourceMapUrl,
        map: parsedMap
      };
    } catch (error) {
      console.warn(`Failed to parse source map for ${source}:`, error.message);
      this.sourceMapCache.set(source, { url: null, map: null });
      return null;
    }
  }

  private async retrieveSourceMapURL(source: string): Promise<string | null> {
    const result = await this.retrieveFileWithHeaders(source);
    if (!result.content) return null;

    // Check for HTTP headers first (SourceMap or X-SourceMap)
    if (result.sourceMapUrl) {
      return result.sourceMapUrl;
    }

    // Fallback to sourceMappingURL comment (find the last one)
    const re = /(?:\/\/[@#]\s*sourceMappingURL=([^\s'"]+)\s*$)|(?:\/\*[@#]\s*sourceMappingURL=([^\s*'"]+)\s*(?:\*\/)\s*$)/gm;
    let lastMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;

    while ((match = re.exec(result.content))) {
      lastMatch = match;
    }

    return lastMatch ? (lastMatch[1] || lastMatch[2]) : null;
  }

  private async retrieveFileWithHeaders(filePath: string): Promise<{ content: string | null, sourceMapUrl: string | null }> {
    filePath = filePath.trim();

    if (filePath.startsWith('file://')) {
      filePath = filePath.replace(/^file:\/\/\/(\w:)?/, (_, drive) => drive ? '' : '/');
    }

    if (this.fileContentsCache.has(filePath)) {
      return { content: this.fileContentsCache.get(filePath)!, sourceMapUrl: null };
    }

    let content: string | null = null;
    let sourceMapUrl: string | null = null;
    try {
      if (filePath.startsWith('http')) {
        const response = await fetch(filePath);
        if (response.ok) {
          content = await response.text();
          // Support providing a sourceMappingURL via the SourceMap header
          sourceMapUrl = response.headers.get('SourceMap') ||
            response.headers.get('X-SourceMap') ||
            null;
        }
      } else if (existsSync(filePath)) {
        content = await readFile(filePath, 'utf-8');
      }
    } catch (error) { }

    this.fileContentsCache.set(filePath, content);
    return { content, sourceMapUrl };
  }

  private async retrieveFile(filePath: string): Promise<string | null> {
    const result = await this.retrieveFileWithHeaders(filePath);
    return result.content;
  }

  private resolveUrl(base: string, relative: string): string {
    if (!base || relative.startsWith('http') || relative.startsWith('file:')) {
      return relative;
    }

    try {
      if (base.startsWith('http')) {
        return new URL(relative, base).href;
      } else {
        return path.resolve(path.dirname(base), relative);
      }
    } catch {
      return relative;
    }
  }

  private isMinifiedJavaScript(url: string): boolean {
    if (!url || !url.endsWith('.js')) {
      return false;
    }

    if (url.includes('/src/') || url.includes('/source/') || url.includes('webpack://')) {
      return false;
    }
    const patterns = [
      /\.min\.js$/,
      /\.[a-f0-9]{8,}\.js$/,
      /\.(chunk|bundle|dll|entry|plugin)\.js$/,
      /\/(bundles?|dist|build)\/.*\.js$/,
      /^(app|main|runtime|vendor|polyfill)\.[a-f0-9]+\.js$/,
      /^kbn-.*\.js$/
    ];

    return patterns.some(pattern => pattern.test(url));
  }

  private cleanSourcePath(sourcePath: string): string {
    sourcePath = sourcePath.replace(/^webpack:\/\//, '').replace(/^\.\//, '');
    if (sourcePath.includes('node_modules')) {
      const match = sourcePath.match(/node_modules\/([^\/]+)(?:\/(.+))?/);
      if (match) {
        const [, packageName, filePath] = match;
        if (filePath) {
          const parts = filePath.split('/');
          return parts.length > 2
            ? `node_modules/${packageName}/.../${parts.slice(-2).join('/')}`
            : `node_modules/${packageName}/${filePath}`;
        }
        return `node_modules/${packageName}`;
      }
    }

    const parts = sourcePath.split('/');
    if (parts.length > 6) {
      return `${parts[0]}/.../${parts.slice(-3).join('/')}`;
    }
    return sourcePath;
  }
}
