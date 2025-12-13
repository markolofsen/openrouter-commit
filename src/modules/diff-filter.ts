import { GitDiff, GitFile, GitChunk, GitLine } from '../types/index.js';
import { logger } from './logger.js';

export interface FilterOptions {
  ignoreWhitespace?: boolean;
  ignoreGenerated?: boolean;
  ignoreFormatterNoise?: boolean;
  ignoreLockFiles?: boolean;
  maxFileSize?: number; // in bytes
  relevancyThreshold?: number; // 0-1, how relevant changes should be
}

export interface RelevancyScore {
  file: string;
  score: number;
  reasons: string[];
}

export class DiffFilter {
  private readonly defaultOptions: Required<FilterOptions> = {
    ignoreWhitespace: true,
    ignoreGenerated: true,
    ignoreFormatterNoise: true,
    ignoreLockFiles: true,
    maxFileSize: 1024 * 1024, // 1MB
    relevancyThreshold: 0.05, // Lowered from 0.1 to catch more relevant files
  };

  // Patterns for generated files - comprehensive coverage for all ecosystems
  private readonly generatedFilePatterns = [
    // Lock files (dependency managers)
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /Gemfile\.lock$/,
    /Pipfile\.lock$/,
    /poetry\.lock$/,
    /composer\.lock$/,
    /go\.sum$/,
    /cargo\.lock$/i,
    /Podfile\.lock$/,
    /pubspec\.lock$/,
    /flake\.lock$/,

    // Generated/build directories
    /^\.generated\./,
    /dist\/.*$/,
    /build\/.*$/,
    /out\/.*$/,
    /target\/.*$/,  // Rust, Java
    /bin\/.*$/,
    /obj\/.*$/,  // .NET
    /\.next\/.*$/,  // Next.js
    /\.nuxt\/.*$/,  // Nuxt.js
    /\.astro\/.*$/,
    /\.svelte-kit\/.*$/,
    /\.cache\/.*$/,
    /\.output\/.*$/,
    /public\/build\/.*$/,

    // Test coverage
    /coverage\/.*$/,
    /\.nyc_output\/.*$/,
    /htmlcov\/.*$/,
    /test-results\/.*$/,
    /\.pytest_cache\/.*$/,

    // Dependencies
    /node_modules\/.*$/,
    /vendor\/.*$/,
    /bower_components\/.*$/,
    /\.pnp\/.*$/,
    /venv\/.*$/,
    /\.venv\/.*$/,
    /env\/.*$/,

    // Version control & IDE
    /\.git\/.*$/,
    /\.svn\/.*$/,
    /\.vscode\/.*$/,
    /\.idea\/.*$/,
    /\.fleet\/.*$/,
    /\.vs\/.*$/,

    // OS files
    /\.DS_Store$/,
    /thumbs\.db$/i,
    /desktop\.ini$/i,
    /\._.*$/,  // macOS resource forks

    // Code generation
    /.*\.g\.ts$/,  // TypeScript
    /.*\.g\.dart$/,  // Dart
    /.*\.g\.cs$/,  // C#
    /.*\.g\.go$/,  // Go
    /.*_pb2\.py$/,  // Protocol buffers
    /.*\.pb\.go$/,
    /.*_grpc\.py$/,  // gRPC
    /.*\.(min|bundle|chunk)\.(js|css|mjs)$/,  // Minified
    /.*\.map$/,  // Source maps
    /.*\.d\.ts$/,  // TypeScript declarations (often generated)

    // Framework artifacts
    /\.tsbuildinfo$/,
    /\.docusaurus\/.*$/,
    /\.vercel\/.*$/,
    /\.netlify\/.*$/,

    // Database migrations (often auto-generated)
    /migrations\/\d+_.*\.(py|sql|js|ts)$/,

    // Binary/archive
    /.*\.(zip|rar|7z|tar|gz|bz2|xz|tgz)$/i,
    /.*\.(exe|dll|so|dylib|lib|a|app|dmg|pkg)$/i,

    // Images
    /.*\.(jpg|jpeg|png|gif|bmp|ico|svg|webp|tiff|psd|ai|sketch)$/i,

    // Media
    /.*\.(mp3|mp4|avi|mov|wmv|flv|webm|ogg|wav|m4a)$/i,

    // Documents/fonts
    /.*\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
    /.*\.woff2?$/i,
    /.*\.(ttf|otf|eot)$/i,

    // Database files
    /.*\.(bin|dat|db|sqlite|sqlite3)$/i,

    // Compiled/cached
    /.*\.__pycache__\/.*$/,
    /.*\.pyc$/,
    /.*\.pyo$/,
    /.*\.class$/,
    /.*\.o$/,
    /.*\.obj$/,

    // Mobile/Native
    /ios\/Pods\/.*$/,
    /android\/\.gradle\/.*$/,
    /android\/build\/.*$/,
    /\.xcworkspace\/.*$/,
    /DerivedData\/.*$/,

    // Logs & temp
    /.*\.log$/i,
    /logs\/.*$/,
    /tmp\/.*$/,
    /.*\.tmp$/,
    /.*\.swp$/,  // Vim swap
    /.*~$/,  // Backups
  ];

  // Patterns for formatter/linter changes (low semantic value)
  private readonly formatterPatterns = [
    // Whitespace only changes
    /^\s*$/,
    /^[\s\t]+$/,
    // Trailing commas, semicolons ONLY (not lines that happen to end with them)
    /^,\s*$/,
    /^;\s*$/,
    // Quote-only lines
    /^["']\s*$/,
    // Bracket-only lines
    /^[{[(]\s*$/,
    /^[}\])]\s*$/,
  ];

  // High-value code patterns
  private readonly highValuePatterns = [
    // Function/method definitions
    /^[\s]*(?:function|def|class|interface|type|const|let|var)\s+/,
    // Control flow
    /^[\s]*(?:if|else|for|while|switch|case|try|catch|throw|return)\s+/,
    // API endpoints
    /^[\s]*(?:@(?:Get|Post|Put|Delete|Patch)|app\.|router\.)/,
    // Database operations
    /^[\s]*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s+/i,
    // Error handling
    /^[\s]*(?:error|throw|catch|except|raise)\s+/i,
    // Configuration changes
    /^[\s]*(?:config|settings|env|environment)/i,
  ];

  /**
   * Quick filter to remove obvious non-code files
   * This is a lightweight pre-filter before full relevancy analysis
   */
  quickFilter(diff: GitDiff): GitDiff {
    logger.debug('Quick filtering diff', { originalFiles: diff.files.length });

    const filteredFiles = diff.files.filter(file => {
      // Always skip binary files
      if (file.isBinary || this.isBinaryFile(file.path)) {
        logger.debug('Quick filter: skipping binary file', { path: file.path });
        return false;
      }

      // Always skip lock files
      if (this.isLockFile(file.path)) {
        logger.debug('Quick filter: skipping lock file', { path: file.path });
        return false;
      }

      // Skip package manager directories
      if (/node_modules|vendor|bower_components/.test(file.path)) {
        logger.debug('Quick filter: skipping package manager directory', { path: file.path });
        return false;
      }

      // Skip build outputs
      if (/^(dist|build|out|\.next|\.nuxt)\//.test(file.path)) {
        logger.debug('Quick filter: skipping build output', { path: file.path });
        return false;
      }

      // Skip cache and temp directories
      if (/\.(cache|tmp|temp)\//.test(file.path)) {
        logger.debug('Quick filter: skipping cache/temp', { path: file.path });
        return false;
      }

      // Keep everything else for detailed analysis
      return true;
    });

    const filteredDiff: GitDiff = {
      files: filteredFiles,
      totalLines: filteredFiles.reduce((sum, file) =>
        sum + file.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.lines.length, 0), 0
      ),
      totalSize: filteredFiles.reduce((sum, file) =>
        sum + JSON.stringify(file).length, 0
      ),
    };

    logger.debug('Quick filter complete', {
      originalFiles: diff.files.length,
      filteredFiles: filteredDiff.files.length,
      removed: diff.files.length - filteredDiff.files.length,
    });

    return filteredDiff;
  }

  /**
   * Filter diff based on relevancy and noise reduction
   */
  filterDiff(diff: GitDiff, options: Partial<FilterOptions> = {}): GitDiff {
    const opts = { ...this.defaultOptions, ...options };

    logger.debug('Filtering diff', {
      originalFiles: diff.files.length,
      options: opts
    });

    const filteredFiles = diff.files
      .map(file => this.filterFile(file, opts))
      .filter((file): file is GitFile => file !== null);

    // Calculate relevancy scores and sort by importance
    const scoredFiles = this.scoreFiles(filteredFiles);
    const relevantFiles = scoredFiles
      .filter(scored => scored.score >= opts.relevancyThreshold)
      .sort((a, b) => b.score - a.score)
      .map(scored => filteredFiles.find(f => f.path === scored.file)!)
      .filter(Boolean);

    const filteredDiff: GitDiff = {
      files: relevantFiles,
      totalLines: relevantFiles.reduce((sum, file) =>
        sum + file.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.lines.length, 0), 0
      ),
      totalSize: relevantFiles.reduce((sum, file) =>
        sum + JSON.stringify(file).length, 0
      ),
    };

    logger.debug('Diff filtered', {
      originalFiles: diff.files.length,
      filteredFiles: filteredDiff.files.length,
      originalLines: diff.totalLines,
      filteredLines: filteredDiff.totalLines,
    });

    return filteredDiff;
  }

  /**
   * Filter individual file
   */
  private filterFile(file: GitFile, options: Required<FilterOptions>): GitFile | null {
    // Skip generated files
    if (options.ignoreGenerated && this.isGeneratedFile(file.path)) {
      logger.debug('Skipping generated file', { path: file.path });
      return null;
    }

    // Skip lock files
    if (options.ignoreLockFiles && this.isLockFile(file.path)) {
      logger.debug('Skipping lock file', { path: file.path });
      return null;
    }

    // Skip binary files (both git-detected and pattern-based)
    if (file.isBinary || this.isBinaryFile(file.path)) {
      logger.debug('Skipping binary file', { path: file.path });
      return null;
    }

    // Filter chunks
    const filteredChunks = file.chunks
      .map(chunk => this.filterChunk(chunk, options))
      .filter((chunk): chunk is GitChunk => chunk !== null);

    // Skip files with no relevant chunks
    if (filteredChunks.length === 0) {
      return null;
    }

    return {
      ...file,
      chunks: filteredChunks,
    };
  }

  /**
   * Filter individual chunk
   */
  private filterChunk(chunk: GitChunk, options: Required<FilterOptions>): GitChunk | null {
    let filteredLines = chunk.lines;

    // Filter whitespace-only changes (pairs of removed/added with same trimmed content)
    if (options.ignoreWhitespace) {
      filteredLines = this.filterWhitespaceChanges(filteredLines);
    }

    // Filter formatter noise
    if (options.ignoreFormatterNoise) {
      filteredLines = filteredLines.filter(line =>
        !this.isFormatterNoise(line)
      );
    }

    // Skip chunk if no meaningful lines remain
    if (filteredLines.length === 0) {
      return null;
    }

    // Skip chunk if only context lines remain
    const meaningfulLines = filteredLines.filter(line => line.type !== 'context');
    if (meaningfulLines.length === 0) {
      return null;
    }

    return {
      ...chunk,
      lines: filteredLines,
      context: this.generateChunkContext(filteredLines),
    };
  }

  /**
   * Filter whitespace-only changes by detecting removed/added pairs with identical trimmed content
   */
  private filterWhitespaceChanges(lines: GitLine[]): GitLine[] {
    const result: GitLine[] = [];
    const toSkip = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      if (toSkip.has(i)) continue;

      const line = lines[i]!;

      // Always keep context lines
      if (line.type === 'context') {
        result.push(line);
        continue;
      }

      // Check if this is a whitespace-only line (empty or only whitespace)
      if (this.isWhitespaceOnlyLine(line)) {
        continue; // Skip it
      }

      // If this is a removed line, look ahead for matching added line
      if (line.type === 'removed') {
        const trimmedContent = line.content.trim();
        let foundMatch = false;

        // Look for a corresponding added line with same trimmed content
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j]!;

          // Stop looking if we hit a context line
          if (nextLine.type === 'context') break;

          if (nextLine.type === 'added' && nextLine.content.trim() === trimmedContent) {
            // Found a whitespace-only change pair - skip both
            toSkip.add(j);
            foundMatch = true;
            break;
          }
        }

        if (!foundMatch) {
          result.push(line);
        }
      } else {
        // Added line - only include if not part of a pair we already skipped
        result.push(line);
      }
    }

    return result;
  }

  /**
   * Check if file is generated
   */
  private isGeneratedFile(path: string): boolean {
    return this.generatedFilePatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check if file is a lock file
   */
  private isLockFile(path: string): boolean {
    const lockPatterns = [
      /\.lock$/,
      /package-lock\.json$/,
      /yarn\.lock$/,
      /pnpm-lock\.yaml$/,
      /Gemfile\.lock$/,
      /composer\.lock$/,
      /go\.sum$/,
    ];
    return lockPatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check if file is binary based on extension patterns
   */
  private isBinaryFile(path: string): boolean {
    const binaryPatterns = [
      // Archive files
      /\.(zip|rar|7z|tar|gz|bz2|xz)$/i,
      // Executable files
      /\.(exe|dll|so|dylib|app)$/i,
      // Image files
      /\.(jpg|jpeg|png|gif|bmp|ico|webp|tiff)$/i,
      // Media files
      /\.(mp3|mp4|avi|mov|wmv|flv|webm|ogg|wav)$/i,
      // Document files
      /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
      // Database files
      /\.(bin|dat|db|sqlite|sqlite3)$/i,
      // Font files
      /\.(woff2?|ttf|eot)$/i,
      // Compiled files
      /\.(pyc|pyo|class|o|obj)$/i,
    ];
    return binaryPatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check if line is whitespace-only change
   */
  private isWhitespaceOnlyLine(line: GitLine): boolean {
    if (line.type === 'context') {
      return false;
    }

    // Check if line contains only whitespace changes
    const content = line.content.trim();
    return content === '' || /^[\s\t]+$/.test(line.content);
  }

  /**
   * Check if line is formatter noise
   */
  private isFormatterNoise(line: GitLine): boolean {
    if (line.type === 'context') {
      return false;
    }

    const content = line.content.trim();
    return this.formatterPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Score files by relevancy
   */
  private scoreFiles(files: GitFile[]): RelevancyScore[] {
    return files.map(file => {
      let score = 0;
      const reasons: string[] = [];

      // Base score for any changes
      score += 0.1;

      // Score based on file type
      const fileTypeScore = this.getFileTypeScore(file.path);
      score += fileTypeScore.score;
      if (fileTypeScore.reason) {
        reasons.push(fileTypeScore.reason);
      }

      // Score based on change patterns
      for (const chunk of file.chunks) {
        for (const line of chunk.lines) {
          if (line.type === 'context') continue;

          // High-value patterns
          if (this.highValuePatterns.some(pattern => pattern.test(line.content))) {
            score += 0.3;
            reasons.push('High-value code pattern');
            break; // Only count once per chunk
          }

          // Error handling
          if (/error|exception|catch|throw/i.test(line.content)) {
            score += 0.2;
            reasons.push('Error handling');
          }

          // Security-related
          if (/password|token|key|auth|security/i.test(line.content)) {
            score += 0.2;
            reasons.push('Security-related');
          }

          // Performance-related
          if (/performance|optimize|cache|memory|cpu/i.test(line.content)) {
            score += 0.15;
            reasons.push('Performance-related');
          }

          // Bug fixes
          if (/fix|bug|issue|problem|resolve/i.test(line.content)) {
            score += 0.2;
            reasons.push('Bug fix');
          }
        }
      }

      // Penalize very large files (might be auto-generated)
      const lineCount = file.chunks.reduce((sum, chunk) => sum + chunk.lines.length, 0);
      if (lineCount > 500) {
        score *= 0.7;
        reasons.push('Large file penalty');
      }

      return {
        file: file.path,
        score: Math.min(score, 1.0), // Cap at 1.0
        reasons,
      };
    });
  }

  /**
   * Get relevancy score based on file type
   */
  private getFileTypeScore(path: string): { score: number; reason?: string } {
    const fileTypeScores: Array<{ pattern: RegExp; score: number; reason: string }> = [
      { pattern: /\.(ts|tsx|js|jsx)$/, score: 0.4, reason: 'TypeScript/JavaScript source' },
      { pattern: /\.(py|rb|php|java|cs|cpp|cc|c|h)$/, score: 0.4, reason: 'Source code' },
      { pattern: /\.(go|rs|kt|swift|scala)$/, score: 0.4, reason: 'Source code' },
      { pattern: /\.(vue|svelte|react)$/, score: 0.35, reason: 'Component file' },
      { pattern: /\.(sql|prisma|graphql)$/, score: 0.3, reason: 'Database/API schema' },
      { pattern: /\.(yaml|yml|json|toml|ini)$/, score: 0.25, reason: 'Configuration' },
      { pattern: /\.(md|rst|txt)$/, score: 0.15, reason: 'Documentation' },
      { pattern: /\.(css|scss|less|sass)$/, score: 0.2, reason: 'Styling' },
      { pattern: /\.(html|htm|xml)$/, score: 0.2, reason: 'Markup' },
      { pattern: /Dockerfile|\.dockerignore/, score: 0.25, reason: 'Docker configuration' },
      { pattern: /package\.json|requirements\.txt|Cargo\.toml/, score: 0.3, reason: 'Dependencies' },
      { pattern: /\.env|\.env\./, score: 0.35, reason: 'Environment configuration' },
    ];

    for (const { pattern, score, reason } of fileTypeScores) {
      if (pattern.test(path)) {
        return { score, reason };
      }
    }

    return { score: 0.1 }; // Default for unknown file types
  }

  /**
   * Generate context for filtered chunk
   */
  private generateChunkContext(lines: GitLine[]): string {
    // Get context from meaningful changes
    const meaningfulLines = lines
      .filter(line => line.type !== 'context')
      .slice(0, 3)
      .map(line => line.content.trim())
      .filter(content => content.length > 0);

    return meaningfulLines.join(' | ');
  }

  /**
   * Get summary of filtering actions
   */
  getFilteringSummary(original: GitDiff, filtered: GitDiff): {
    filesRemoved: number;
    linesRemoved: number;
    sizeReduction: string;
    topRemovedReasons: string[];
  } {
    const filesRemoved = original.files.length - filtered.files.length;
    const linesRemoved = original.totalLines - filtered.totalLines;
    const sizeReduction = `${Math.round((1 - filtered.totalSize / original.totalSize) * 100)}%`;

    // This is a simplified version - in practice, you'd track reasons during filtering
    const topRemovedReasons = [
      'Generated files',
      'Lock files',
      'Whitespace changes',
      'Formatter noise',
      'Low relevancy score',
    ];

    return {
      filesRemoved,
      linesRemoved,
      sizeReduction,
      topRemovedReasons,
    };
  }
}

// Singleton instance
export const diffFilter = new DiffFilter();
