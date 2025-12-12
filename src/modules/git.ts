import { exec } from 'child_process';
import { promisify } from 'util';
import { GitDiff, GitFile, GitChunk, GitLine, GitError, GitFileStatus, ChunkProcessingOptions, CHUNK_LIMITS, FileSafetyAnalysis, FILE_SAFETY_LIMITS } from '../types/index.js';
import { logger } from './logger.js';

// Increase buffer size for large repositories (200MB)
const execAsync = promisify(exec);
const EXEC_OPTIONS = {
  maxBuffer: 200 * 1024 * 1024, // 200MB buffer
  timeout: 120000, // 120 seconds timeout
};

export class GitManager {
  /**
   * Check if current directory is a git repository
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --git-dir', EXEC_OPTIONS);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if current directory is inside a git submodule
   */
  async isSubmodule(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git rev-parse --show-superproject-working-tree', EXEC_OPTIONS);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get submodule name if in submodule
   */
  async getSubmoduleName(): Promise<string | null> {
    try {
      const isSubmod = await this.isSubmodule();
      if (!isSubmod) return null;

      const { stdout } = await execAsync('git rev-parse --show-prefix', EXEC_OPTIONS);
      const prefix = stdout.trim();

      // Get submodule name from .git file
      const { stdout: gitFileContent } = await execAsync('cat .git', EXEC_OPTIONS);
      const match = gitFileContent.match(/gitdir: \.\.\/\.git\/modules\/(.+)/);
      return match?.[1] || prefix || null;
    } catch {
      return null;
    }
  }

  /**
   * Get staged changes as a structured diff
   */
  async getStagedDiff(options?: Partial<ChunkProcessingOptions>): Promise<GitDiff> {
    const mergedOptions = this.mergeChunkOptions(options);
    
    try {
      // Check if there are staged changes
      const { stdout: statusOutput } = await execAsync('git diff --cached --name-status', EXEC_OPTIONS);
      if (!statusOutput.trim()) {
        return { files: [], totalLines: 0, totalSize: 0 };
      }

      // Get the raw diff with optimized flags
      const { stdout: diffOutput } = await execAsync(
        'git diff --cached --ignore-space-change --ignore-blank-lines --no-color --no-prefix',
        EXEC_OPTIONS
      );

      return this.parseDiff(diffOutput, mergedOptions);
    } catch (error) {
      throw new GitError(
        `Failed to get staged diff: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get list of staged files with their status
   */
  async getStagedFiles(): Promise<Array<{ path: string; status: GitFileStatus }>> {
    try {
      const { stdout } = await execAsync('git diff --cached --name-status', EXEC_OPTIONS);
      
      return stdout
        .trim()
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => {
          const parts = line.split('\t');
          const status = this.parseFileStatus(parts[0] || '');
          const path = parts[1] || '';
          return { path, status };
        });
    } catch (error) {
      throw new GitError(
        `Failed to get staged files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create a commit with the given message
   */
  async createCommit(message: string): Promise<string> {
    try {
      // Properly escape the message for shell execution
      const escapedMessage = message
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')    // Escape double quotes
        .replace(/`/g, '\\`')    // Escape backticks
        .replace(/\$/g, '\\$');  // Escape dollar signs
      
      const { stdout } = await execAsync(`git commit -m "${escapedMessage}"`, EXEC_OPTIONS);
      logger.debug('Commit created successfully', { output: stdout });
      return stdout;
    } catch (error) {
      throw new GitError(
        `Failed to create commit: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Check if there are any uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', EXEC_OPTIONS);
      return stdout.trim().length > 0;
    } catch (error) {
      throw new GitError(
        `Failed to check git status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await execAsync('git branch --show-current', EXEC_OPTIONS);
      return stdout.trim();
    } catch (error) {
      throw new GitError(
        `Failed to get current branch: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get repository root directory
   */
  async getRepositoryRoot(): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', EXEC_OPTIONS);
      return stdout.trim();
    } catch (error) {
      throw new GitError(
        `Failed to get repository root: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  // Private methods

  private parseDiff(diffOutput: string, options: ChunkProcessingOptions): GitDiff {
    const files: GitFile[] = [];
    let totalLines = 0;
    let totalSize = 0;

    // Split diff into file sections
    const fileSections = this.splitDiffIntoFiles(diffOutput);

    for (const section of fileSections) {
      const file = this.parseFileSection(section, options);
      if (file) {
        files.push(file);
        totalLines += file.chunks.reduce((sum, chunk) => sum + chunk.lines.length, 0);
        totalSize += section.length;
      }
    }

    return { files, totalLines, totalSize };
  }

  private splitDiffIntoFiles(diffOutput: string): string[] {
    const sections: string[] = [];
    const lines = diffOutput.split('\n');
    let currentSection: string[] = [];

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        if (currentSection.length > 0) {
          sections.push(currentSection.join('\n'));
          currentSection = [];
        }
      }
      currentSection.push(line);
    }

    if (currentSection.length > 0) {
      sections.push(currentSection.join('\n'));
    }

    return sections;
  }

  private parseFileSection(section: string, options: ChunkProcessingOptions): GitFile | null {
    const lines = section.split('\n');
    
    // Extract file path and status
    const diffLine = lines.find(line => line.startsWith('diff --git'));
    if (!diffLine) return null;

    const path = this.extractFilePath(diffLine);
    const status = this.determineFileStatus(lines);
    const isBinary = lines.some(line => line.includes('Binary files'));

    if (isBinary) {
      return {
        path,
        status,
        chunks: [],
        isBinary: true,
      };
    }

    const chunks = this.parseChunks(lines, options);

    return {
      path,
      status,
      chunks,
      isBinary: false,
    };
  }

  private extractFilePath(diffLine: string): string {
    // Extract path from "diff --git a/path b/path" format
    const match = diffLine.match(/diff --git (?:a\/)?(.+) (?:b\/)?(.+)/);
    return match ? (match[2] || match[1] || '') : '';
  }

  private determineFileStatus(lines: string[]): GitFileStatus {
    const newFileMode = lines.some(line => line.startsWith('new file mode'));
    const deletedFileMode = lines.some(line => line.startsWith('deleted file mode'));
    const renamedFrom = lines.some(line => line.startsWith('rename from'));
    const copiedFrom = lines.some(line => line.startsWith('copy from'));

    if (newFileMode) return 'added';
    if (deletedFileMode) return 'deleted';
    if (renamedFrom) return 'renamed';
    if (copiedFrom) return 'copied';
    return 'modified';
  }

  private parseChunks(lines: string[], options: ChunkProcessingOptions): GitChunk[] {
    const chunks: GitChunk[] = [];
    let currentChunk: Partial<GitChunk> | null = null;
    let chunkLines: GitLine[] = [];

    for (const line of lines) {
      if (line.startsWith('@@')) {
        // Save previous chunk if exists
        if (currentChunk && chunkLines.length > 0) {
          chunks.push({
            ...currentChunk,
            lines: chunkLines,
            context: this.generateChunkContext(chunkLines),
          } as GitChunk);
        }

        // Start new chunk
        const chunkHeader = this.parseChunkHeader(line);
        if (chunkHeader) {
          currentChunk = chunkHeader;
          chunkLines = [];
        }
      } else if (currentChunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-'))) {
        chunkLines.push(this.parseGitLine(line));
      }
    }

    // Add final chunk
    if (currentChunk && chunkLines.length > 0) {
      chunks.push({
        ...currentChunk,
        lines: chunkLines,
        context: this.generateChunkContext(chunkLines),
      } as GitChunk);
    }

    // Split large chunks if necessary
    return this.splitLargeChunks(chunks, options);
  }

  private parseChunkHeader(headerLine: string): Partial<GitChunk> | null {
    // Parse "@@ -start,count +start,count @@" format
    const match = headerLine.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) return null;

    return {
      header: headerLine,
      oldStart: parseInt(match[1] || '0', 10),
      oldLines: parseInt(match[2] || '1', 10),
      newStart: parseInt(match[3] || '0', 10),
      newLines: parseInt(match[4] || '1', 10),
    };
  }

  private parseGitLine(line: string): GitLine {
    const type = line.startsWith('+') ? 'added' : 
                 line.startsWith('-') ? 'removed' : 'context';
    const content = line.slice(1); // Remove the prefix character

    return { type, content };
  }

  private generateChunkContext(lines: GitLine[]): string {
    // Get context from surrounding lines and function/class definitions
    const contextLines = lines
      .filter(line => line.type === 'context' || line.type === 'added')
      .slice(0, 3)
      .map(line => line.content.trim())
      .filter(content => content.length > 0);

    return contextLines.join(' | ');
  }

  private splitLargeChunks(chunks: GitChunk[], options: ChunkProcessingOptions): GitChunk[] {
    const result: GitChunk[] = [];

    for (const chunk of chunks) {
      const chunkSize = chunk.lines.reduce((sum, line) => sum + line.content.length, 0);
      
      if (chunkSize <= options.maxChunkSize) {
        result.push(chunk);
      } else {
        result.push(...this.splitSingleChunk(chunk, options));
      }
    }

    return result;
  }

  private splitSingleChunk(chunk: GitChunk, options: ChunkProcessingOptions): GitChunk[] {
    const subChunks: GitChunk[] = [];
    const lines = chunk.lines;
    let currentLines: GitLine[] = [];
    let currentSize = 0;

    for (const line of lines) {
      const lineSize = line.content.length;
      
      if (currentSize + lineSize > options.maxChunkSize && currentLines.length > 0) {
        // Create sub-chunk
        subChunks.push({
          ...chunk,
          lines: [...currentLines],
          context: this.generateChunkContext(currentLines),
        });
        
        currentLines = [];
        currentSize = 0;
      }
      
      currentLines.push(line);
      currentSize += lineSize;
    }

    // Add remaining lines
    if (currentLines.length > 0) {
      subChunks.push({
        ...chunk,
        lines: currentLines,
        context: this.generateChunkContext(currentLines),
      });
    }

    return subChunks.length > 0 ? subChunks : [chunk];
  }

  private parseFileStatus(statusChar: string): GitFileStatus {
    switch (statusChar.charAt(0)) {
      case 'A': return 'added';
      case 'M': return 'modified';
      case 'D': return 'deleted';
      case 'R': return 'renamed';
      case 'C': return 'copied';
      default: return 'modified';
    }
  }

  private mergeChunkOptions(options?: Partial<ChunkProcessingOptions>): ChunkProcessingOptions {
    return {
      maxChunkSize: options?.maxChunkSize ?? CHUNK_LIMITS.MAX_CHUNK_SIZE,
      preserveContext: options?.preserveContext ?? true,
      maxConcurrency: options?.maxConcurrency ?? CHUNK_LIMITS.MAX_CONCURRENT_REQUESTS,
    };
  }

  /**
   * Check if there is an upstream branch configured
   */
  async hasUpstream(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', EXEC_OPTIONS);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Push commits to remote repository
   * Handles both regular repos and submodules
   */
  async pushToRemote(setUpstream = false): Promise<void> {
    try {
      const hasUpstreamBranch = await this.hasUpstream();
      const isSubmod = await this.isSubmodule();

      // Push the current repository/submodule
      if (!hasUpstreamBranch && setUpstream) {
        const currentBranch = await this.getCurrentBranch();
        await execAsync(`git push --set-upstream origin ${currentBranch}`, EXEC_OPTIONS);
      } else {
        await execAsync('git push', EXEC_OPTIONS);
      }

      // If this is a submodule, warn about parent repo
      if (isSubmod) {
        const submoduleName = await this.getSubmoduleName();
        logger.info(`Pushed submodule ${submoduleName || 'changes'}`);
        logger.warn('Note: Parent repository may need to be committed and pushed to reflect submodule update');
      }
    } catch (error) {
      throw new GitError(
        'Failed to push to remote repository',
        error as Error
      );
    }
  }

  /**
   * Check if there are unpushed commits
   */
  async hasUnpushedCommits(): Promise<boolean> {
    try {
      const hasUpstreamBranch = await this.hasUpstream();
      if (!hasUpstreamBranch) {
        // If no upstream, consider commits as unpushed
        return true;
      }
      
      const { stdout } = await execAsync('git rev-list --count @{u}..HEAD', EXEC_OPTIONS);
      return parseInt(stdout.trim()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Analyze staged files for potential safety issues
   */
  async analyzeStagedFilesSafety(): Promise<FileSafetyAnalysis> {
    try {
      const stagedFiles = await this.getStagedFiles();
      const totalFiles = stagedFiles.length;
      
      // Get file sizes and analyze patterns
      const { stdout: filesWithSizes } = await execAsync(
        'git diff --cached --numstat', 
        EXEC_OPTIONS
      );
      
      const suspiciousPatterns: string[] = [];
      let largeFiles = 0;
      
      // Analyze file patterns and sizes
      const lines = filesWithSizes.trim().split('\n').filter(line => line.trim());
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const added = parseInt(parts[0] || '0');
          const removed = parseInt(parts[1] || '0');
          const filePath = parts[2] || '';
          
          // Check for large files (many lines added)
          if (added > 1000 || removed > 1000) {
            largeFiles++;
          }
          
          // Check for suspicious patterns
          this.checkSuspiciousPatterns(filePath, suspiciousPatterns);
        }
      }
      
      // Determine risk level
      const riskLevel = this.determineRiskLevel(totalFiles, largeFiles, suspiciousPatterns);
      
      // Generate recommendations
      const recommendations = this.generateSafetyRecommendations(
        totalFiles, 
        largeFiles, 
        suspiciousPatterns, 
        riskLevel
      );
      
      return {
        totalFiles,
        largeFiles,
        suspiciousPatterns,
        riskLevel,
        recommendations,
      };
      
    } catch (error) {
      logger.debug('Failed to analyze file safety', error);
      // Return safe analysis if we can't determine
      return {
        totalFiles: 0,
        largeFiles: 0,
        suspiciousPatterns: [],
        riskLevel: 'safe',
        recommendations: [],
      };
    }
  }

  private checkSuspiciousPatterns(filePath: string, patterns: string[]): void {
    const suspiciousIndicators = [
      // Package managers
      { pattern: /node_modules\//, message: 'node_modules directory detected' },
      { pattern: /\.pnpm-store\//, message: 'pnpm store directory detected' },
      { pattern: /bower_components\//, message: 'bower_components directory detected' },
      { pattern: /vendor\//, message: 'vendor directory detected' },
      
      // Build artifacts
      { pattern: /dist\/.*\.(js|css|map)$/, message: 'build artifacts detected' },
      { pattern: /build\/.*\.(js|css|map)$/, message: 'build output detected' },
      { pattern: /\.next\//, message: 'Next.js build directory detected' },
      { pattern: /\.nuxt\//, message: 'Nuxt.js build directory detected' },
      
      // Cache directories
      { pattern: /\.cache\//, message: 'cache directory detected' },
      { pattern: /tmp\//, message: 'temporary directory detected' },
      { pattern: /temp\//, message: 'temporary directory detected' },
      
      // IDE and system files
      { pattern: /\.vscode\//, message: 'VS Code settings detected' },
      { pattern: /\.idea\//, message: 'IntelliJ IDEA settings detected' },
      { pattern: /\.DS_Store$/, message: 'macOS system files detected' },
      { pattern: /Thumbs\.db$/, message: 'Windows system files detected' },
      
      // Logs and databases
      { pattern: /\.log$/, message: 'log files detected' },
      { pattern: /\.sqlite$/, message: 'SQLite database files detected' },
      { pattern: /\.db$/, message: 'database files detected' },
      
      // Large binary files
      { pattern: /\.(zip|tar|gz|rar|7z)$/, message: 'archive files detected' },
      { pattern: /\.(mp4|avi|mov|mkv)$/, message: 'video files detected' },
      { pattern: /\.(jpg|jpeg|png|gif|bmp)$/, message: 'large image files detected' },
      
      // Environment and secrets
      { pattern: /\.env\.local$/, message: 'local environment files detected' },
      { pattern: /\.env\.production$/, message: 'production environment files detected' },
      { pattern: /secrets?\//, message: 'secrets directory detected' },
    ];
    
    for (const indicator of suspiciousIndicators) {
      if (indicator.pattern.test(filePath) && !patterns.includes(indicator.message)) {
        patterns.push(indicator.message);
      }
    }
  }

  private determineRiskLevel(
    totalFiles: number, 
    largeFiles: number, 
    suspiciousPatterns: string[]
  ): 'safe' | 'warning' | 'critical' | 'dangerous' {
    // Dangerous: Too many files or clear signs of package directories
    if (totalFiles > FILE_SAFETY_LIMITS.MAX_FILE_COUNT) {
      return 'dangerous';
    }
    
    const hasPackageManagerFiles = suspiciousPatterns.some(pattern => 
      pattern.includes('node_modules') || 
      pattern.includes('vendor') || 
      pattern.includes('bower_components')
    );
    
    if (hasPackageManagerFiles) {
      return 'dangerous';
    }
    
    // Critical: Many files or multiple suspicious patterns
    if (totalFiles > FILE_SAFETY_LIMITS.CRITICAL_FILE_COUNT || 
        suspiciousPatterns.length > 3 || 
        largeFiles > 10) {
      return 'critical';
    }
    
    // Warning: Moderate number of files or some suspicious patterns
    if (totalFiles > FILE_SAFETY_LIMITS.WARNING_FILE_COUNT || 
        suspiciousPatterns.length > 0 || 
        largeFiles > 3) {
      return 'warning';
    }
    
    return 'safe';
  }

  private generateSafetyRecommendations(
    totalFiles: number,
    largeFiles: number,
    suspiciousPatterns: string[],
    riskLevel: 'safe' | 'warning' | 'critical' | 'dangerous'
  ): string[] {
    const recommendations: string[] = [];
    
    if (riskLevel === 'dangerous') {
      recommendations.push('🚨 STOP: This looks like a dangerous commit!');
      
      if (totalFiles > FILE_SAFETY_LIMITS.MAX_FILE_COUNT) {
        recommendations.push(`Too many files (${totalFiles}). Consider staging files in smaller batches.`);
      }
      
      if (suspiciousPatterns.some(p => p.includes('node_modules'))) {
        recommendations.push('Remove node_modules from staging: git reset HEAD node_modules/');
      }
      
      if (suspiciousPatterns.some(p => p.includes('vendor'))) {
        recommendations.push('Remove vendor directory from staging: git reset HEAD vendor/');
      }
    }
    
    if (riskLevel === 'critical') {
      recommendations.push('⚠️  Large commit detected - please review carefully');
      
      if (totalFiles > FILE_SAFETY_LIMITS.CRITICAL_FILE_COUNT) {
        recommendations.push(`Consider splitting ${totalFiles} files into multiple commits`);
      }
      
      if (largeFiles > 5) {
        recommendations.push(`${largeFiles} large files detected - verify they should be committed`);
      }
    }
    
    if (suspiciousPatterns.length > 0) {
      recommendations.push('Check your .gitignore file to exclude:');
      suspiciousPatterns.slice(0, 5).forEach(pattern => {
        recommendations.push(`  • ${pattern}`);
      });
    }
    
    if (riskLevel !== 'safe') {
      recommendations.push('Use "git status" to review what will be committed');
      recommendations.push('Use "git reset HEAD <file>" to unstage unwanted files');
    }
    
    return recommendations;
  }
}

// Singleton instance
export const gitManager = new GitManager();
