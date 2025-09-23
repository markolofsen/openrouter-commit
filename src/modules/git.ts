import { exec } from 'child_process';
import { promisify } from 'util';
import { GitDiff, GitFile, GitChunk, GitLine, GitError, GitFileStatus, ChunkProcessingOptions, CHUNK_LIMITS } from '../types/index.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);

export class GitManager {
  /**
   * Check if current directory is a git repository
   */
  async isGitRepository(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --git-dir');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get staged changes as a structured diff
   */
  async getStagedDiff(options?: Partial<ChunkProcessingOptions>): Promise<GitDiff> {
    const mergedOptions = this.mergeChunkOptions(options);
    
    try {
      // Check if there are staged changes
      const { stdout: statusOutput } = await execAsync('git diff --cached --name-status');
      if (!statusOutput.trim()) {
        return { files: [], totalLines: 0, totalSize: 0 };
      }

      // Get the raw diff with optimized flags
      const { stdout: diffOutput } = await execAsync(
        'git diff --cached --ignore-space-change --ignore-blank-lines --no-color --no-prefix'
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
      const { stdout } = await execAsync('git diff --cached --name-status');
      
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
      const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`);
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
      const { stdout } = await execAsync('git status --porcelain');
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
      const { stdout } = await execAsync('git branch --show-current');
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
      const { stdout } = await execAsync('git rev-parse --show-toplevel');
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
      const { stdout } = await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Push commits to remote repository
   */
  async pushToRemote(setUpstream = false): Promise<void> {
    try {
      const hasUpstreamBranch = await this.hasUpstream();
      
      if (!hasUpstreamBranch && setUpstream) {
        const currentBranch = await this.getCurrentBranch();
        await execAsync(`git push --set-upstream origin ${currentBranch}`);
      } else {
        await execAsync('git push');
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
      
      const { stdout } = await execAsync('git rev-list --count @{u}..HEAD');
      return parseInt(stdout.trim()) > 0;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const gitManager = new GitManager();
