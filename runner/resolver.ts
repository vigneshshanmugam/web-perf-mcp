import { SourceMapConsumer } from 'source-map';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export interface ResolvedLocation {
  originalFile: string;
  originalLine: number;
  originalColumn: number;
  originalName: string | null;
  isResolved: boolean;
  minifiedUrl: string;
}

export class SourceMapResolver {
  private sourceMapCache = new Map<string, SourceMapConsumer>();
  private fetchCache = new Map<string, string>();

  async resolveLocation(url: string, line: number, column: number): Promise<ResolvedLocation> {
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

      const sourceMapUrl = await this.findSourceMapUrl(url);
      if (!sourceMapUrl) {
        return defaultResult;
      }

      const sourceMap = await this.getSourceMap(sourceMapUrl);
      if (!sourceMap) {
        return defaultResult;
      }

      const originalPosition = sourceMap.originalPositionFor({
        line: line,
        column: column
      });

      if (originalPosition.source) {
        const cleanedPath = this.cleanSourcePath(originalPosition.source);
        return {
          originalFile: cleanedPath,
          originalLine: originalPosition.line || line,
          originalColumn: originalPosition.column || column,
          originalName: originalPosition.name,
          isResolved: true,
          minifiedUrl: url
        };
      }

      return defaultResult;
    } catch (error) {
      console.warn(`Failed to resolve source map for ${url}:`, error.message);
      return defaultResult;
    }
  }

  async resolveLocations(locations: Array<{ url: string, line: number, column: number }>): Promise<ResolvedLocation[]> {
    const promises = locations.map(loc => this.resolveLocation(loc.url, loc.line, loc.column));
    return Promise.all(promises);
  }

  private async findSourceMapUrl(jsUrl: string): Promise<string | null> {
    try {
      // For bundled files, try common bundle source map patterns first
      const fileName = jsUrl.split('/').pop() || '';
      const baseName = fileName.replace(/\.js$/, '');
      const baseUrl = jsUrl.substring(0, jsUrl.lastIndexOf('/') + 1);

      // Try common source map patterns (prioritize bundle patterns)
      const possibleSourceMaps = [
        `${jsUrl}.map`,
        jsUrl.replace(/\.js$/, '.js.map'),
        jsUrl.replace(/\.js$/, '.map'),
        // Bundle-specific patterns
        `${baseUrl}${baseName}.bundle.js.map`,
        `${baseUrl}${baseName}.min.js.map`,
        `${baseUrl}sourcemaps/${fileName}.map`,
        `${baseUrl}maps/${fileName}.map`
      ];

      // Check if source map exists by trying to fetch it
      for (const mapUrl of possibleSourceMaps) {
        if (await this.urlExists(mapUrl)) {

          return mapUrl;
        }
      }

      // Try to read sourceMappingURL from the JS file
      const jsContent = await this.fetchContent(jsUrl);
      if (jsContent) {
        // Find ALL sourceMappingURL comments (bundled files often have multiple)
        const sourceMapMatches = jsContent.match(/\/\/# sourceMappingURL=(.+?)(?:\s|$)/g);
        if (sourceMapMatches && sourceMapMatches.length > 0) {
          // Use the last sourceMappingURL comment (most likely the bundle's main source map)
          const lastMatch = sourceMapMatches[sourceMapMatches.length - 1];
          const mapPathMatch = lastMatch.match(/\/\/# sourceMappingURL=(.+?)(?:\s|$)/);

          if (mapPathMatch) {
            const mapPath = mapPathMatch[1].trim();
            // Handle relative paths
            if (mapPath.startsWith('http')) {
              return mapPath;
            } else {
              const baseUrl = jsUrl.substring(0, jsUrl.lastIndexOf('/') + 1);
              return baseUrl + mapPath;
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.warn(`Error finding source map for ${jsUrl}:`, error.message);
      return null;
    }
  }

  private async getSourceMap(sourceMapUrl: string): Promise<SourceMapConsumer | null> {
    try {
      if (this.sourceMapCache.has(sourceMapUrl)) {
        return this.sourceMapCache.get(sourceMapUrl)!;
      }

      const sourceMapContent = await this.fetchContent(sourceMapUrl);
      if (!sourceMapContent) {
        return null;
      }

      // Validate that this is actually a source map
      const sourceMapData = JSON.parse(sourceMapContent);
      if (!sourceMapData.version || !sourceMapData.sources || !sourceMapData.mappings) {
        console.warn(`Invalid source map format at ${sourceMapUrl}`);
        return null;
      }

      const consumer = await new SourceMapConsumer(sourceMapData);
      this.sourceMapCache.set(sourceMapUrl, consumer);
      return consumer;
    } catch (error) {
      console.warn(`Failed to load source map from ${sourceMapUrl}:`, error.message);
      return null;
    }
  }

  private async fetchContent(url: string): Promise<string | null> {
    try {
      if (this.fetchCache.has(url)) {
        return this.fetchCache.get(url)!;
      }

      let content: string;

      if (url.startsWith('http')) {
        // Fetch from URL
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PerformanceAuditor/1.0)'
          }
        });

        if (!response.ok) {
          return null;
        }

        content = await response.text();
      } else {
        // Read from local file
        if (!existsSync(url)) {
          return null;
        }
        content = await readFile(url, 'utf-8');
      }

      this.fetchCache.set(url, content);
      return content;
    } catch (error) {
      console.warn(`Failed to fetch content from ${url}:`, error.message);
      return null;
    }
  }

  private async urlExists(url: string): Promise<boolean> {
    try {
      if (url.startsWith('http')) {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
      } else {
        return existsSync(url);
      }
    } catch {
      return false;
    }
  }

  private isMinifiedJavaScript(url: string): boolean {
    if (!url || !url.includes('.js')) {
      return false;
    }

    // Skip if already looks like original source
    if (url.includes('/src/') || url.includes('/source/') || url.includes('webpack://')) {
      return false;
    }

    // Common patterns for minified/bundled files
    const minifiedPatterns = [
      /\.min\.js$/,
      /\.[a-f0-9]{8,}\.js$/,  // Hash-based filenames
      /\.[a-f0-9]{20,}\.js$/, // Long hash filenames
      /chunk\.[a-f0-9]+\.js$/,
      /vendors?\.[a-f0-9]+\.js$/,
      /runtime\.[a-f0-9]+\.js$/,
      // Bundle-specific patterns
      /\.bundle\.js$/,
      /\.dll\.js$/,           // DLL bundles (like Kibana)
      /\.entry\.js$/,         // Entry point bundles
      /\.plugin\.js$/,        // Plugin bundles
      // Common bundler output patterns
      /bundles?\/.*\.js$/,    // Files in bundles directories
      /dist\/.*\.js$/,        // Files in dist directories
      /build\/.*\.js$/,       // Files in build directories
      // Framework-specific patterns
      /kbn-.*\.js$/,          // Kibana bundles
      /app\.[a-f0-9]+\.js$/,  // App bundles with hashes
      /main\.[a-f0-9]+\.js$/, // Main bundles with hashes
      /polyfills?\.[a-f0-9]+\.js$/ // Polyfill bundles
    ];

    return minifiedPatterns.some(pattern => pattern.test(url));
  }

  private cleanSourcePath(sourcePath: string): string {
    // Remove webpack:// prefix
    sourcePath = sourcePath.replace(/^webpack:\/\//, '');

    // Remove leading ./
    sourcePath = sourcePath.replace(/^\.\//, '');

    // Handle node_modules paths more intelligently
    if (sourcePath.includes('node_modules')) {
      // Extract package name and meaningful file path
      const nodeModulesMatch = sourcePath.match(/node_modules\/([^\/]+)(?:\/(.+))?/);
      if (nodeModulesMatch) {
        const packageName = nodeModulesMatch[1];
        const filePath = nodeModulesMatch[2];

        if (filePath) {
          // For files within packages, show package/file structure
          const filePathParts = filePath.split('/');
          if (filePathParts.length > 2) {
            // Show package/.../ last few parts for deep paths
            return `node_modules/${packageName}/.../${filePathParts.slice(-2).join('/')}`;
          } else {
            // Show full path for shallow paths
            return `node_modules/${packageName}/${filePath}`;
          }
        } else {
          // Just the package name
          return `node_modules/${packageName}`;
        }
      }
    }

    // Handle webpack internal paths
    if (sourcePath.startsWith('webpack/')) {
      return `webpack/${sourcePath.split('/').slice(1, 3).join('/')}`;
    }

    // Shorten very long paths for non-node_modules
    const pathParts = sourcePath.split('/');
    if (pathParts.length > 4) {
      return `.../${pathParts.slice(-3).join('/')}`;
    }

    return sourcePath;
  }

  dispose(): void {
    for (const consumer of this.sourceMapCache.values()) {
      consumer.destroy();
    }
    this.sourceMapCache.clear();
    this.fetchCache.clear();
  }
}
