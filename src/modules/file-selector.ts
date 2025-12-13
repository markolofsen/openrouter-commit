import { GitFile, GitDiff, Config } from '../types/index.js';
import { logger } from './logger.js';
import { apiManager } from './api.js';

export interface FilePreview {
  path: string;
  status: string;
  size: number; // lines changed
  language: string;
  priority: 'high' | 'medium' | 'low';
  preview: string; // first N lines of changes
}

export interface AIFileSelectionResult {
  selectedFiles: string[]; // file paths
  reasoning?: string; // optional: why these files were selected
  confidence: number; // 0-1: AI's confidence in selection
}

export class AIFileSelector {
  constructor(private config: Config) {}

  /**
   * Main entry point for file selection
   * Decides strategy based on file count
   */
  async selectRelevantFiles(
    files: GitFile[],
    maxFiles: number = 30
  ): Promise<GitFile[]> {
    logger.debug('AI File Selector: starting selection', {
      totalFiles: files.length,
      maxFiles,
    });

    // For very small commits, use all files
    if (files.length <= 20) {
      logger.debug('Small commit detected, using all files');
      return files;
    }

    // For huge commits, use heuristic (AI would be too slow/expensive)
    if (files.length > 150) {
      logger.debug('Large commit detected, using heuristic selection');
      return this.heuristicSelection(files, maxFiles);
    }

    // For medium commits (20-150), use AI selection
    logger.debug('Medium commit detected, using AI selection');

    try {
      const previews = this.createPreviews(files);
      const result = await this.askAI(previews, maxFiles);

      logger.debug('AI file selection completed', {
        selectedCount: result.selectedFiles.length,
        confidence: result.confidence,
        reasoning: result.reasoning,
      });

      return files.filter(f => result.selectedFiles.includes(f.path));
    } catch (error) {
      logger.warn(`AI selection failed, falling back to heuristic: ${(error as Error).message}`);
      return this.heuristicSelection(files, maxFiles);
    }
  }

  /**
   * Create file previews with smart sizing
   */
  private createPreviews(files: GitFile[]): FilePreview[] {
    return files.map(file => {
      const priority = this.calculatePriority(file);
      const changedLines = this.getChangedLines(file);

      // Adaptive preview size based on priority
      const previewSize = priority === 'high' ? 50 : priority === 'medium' ? 30 : 20;

      return {
        path: file.path,
        status: file.status,
        size: changedLines.length,
        language: this.detectLanguage(file.path),
        priority,
        preview: changedLines.slice(0, previewSize).join('\n'),
      };
    });
  }

  /**
   * Calculate file priority based on type and location
   */
  private calculatePriority(file: GitFile): 'high' | 'medium' | 'low' {
    const path = file.path.toLowerCase();

    // High priority: source code
    if (/\.(ts|tsx|js|jsx|py|rb|php|java|go|rs|cpp|c|h|cs|kt|swift|scala)$/.test(path)) {
      return 'high';
    }

    // Medium priority: configs, schemas, SQL
    if (/\.(json|yaml|yml|toml|sql|graphql|prisma|proto)$/.test(path)) {
      return 'medium';
    }

    // Medium priority: important config files
    if (/^(package\.json|tsconfig\.json|Dockerfile|Makefile|\.env)/.test(path)) {
      return 'medium';
    }

    // Low priority: docs, styles, markup
    if (/\.(md|txt|css|scss|sass|less|html|htm|xml)$/.test(path)) {
      return 'low';
    }

    return 'medium'; // default
  }

  /**
   * Get all changed lines from file
   */
  private getChangedLines(file: GitFile): string[] {
    const lines: string[] = [];

    for (const chunk of file.chunks) {
      for (const line of chunk.lines) {
        if (line.type === 'added' || line.type === 'removed') {
          const prefix = line.type === 'added' ? '+' : '-';
          lines.push(`${prefix} ${line.content}`);
        }
      }
    }

    return lines;
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();

    const langMap: Record<string, string> = {
      ts: 'TypeScript',
      tsx: 'TypeScript React',
      js: 'JavaScript',
      jsx: 'JavaScript React',
      py: 'Python',
      rb: 'Ruby',
      php: 'PHP',
      java: 'Java',
      go: 'Go',
      rs: 'Rust',
      cpp: 'C++',
      c: 'C',
      cs: 'C#',
      kt: 'Kotlin',
      swift: 'Swift',
      scala: 'Scala',
      sql: 'SQL',
      graphql: 'GraphQL',
      prisma: 'Prisma',
      proto: 'Protocol Buffers',
      yaml: 'YAML',
      yml: 'YAML',
      json: 'JSON',
      toml: 'TOML',
      md: 'Markdown',
    };

    return ext ? langMap[ext] || ext.toUpperCase() : 'Unknown';
  }

  /**
   * Ask AI to select most relevant files
   */
  private async askAI(
    previews: FilePreview[],
    maxFiles: number
  ): Promise<AIFileSelectionResult> {
    const prompt = this.buildSelectionPrompt(previews, maxFiles);

    logger.debug('Sending file selection request to AI', {
      previewCount: previews.length,
      maxFiles,
      promptLength: prompt.length,
    });

    const provider = this.config.preferences.defaultProvider;
    const model = this.getSelectionModel();

    const response = await apiManager.generateCommitMessage({
      provider,
      model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.3, // Low temperature for consistent selection
    }, provider);

    if (!response.success || !response.data) {
      throw new Error('AI selection request failed');
    }

    return this.parseAIResponse(response.data);
  }

  /**
   * Build prompt for AI file selection
   */
  private buildSelectionPrompt(previews: FilePreview[], maxFiles: number): string {
    const filesList = previews
      .map(
        (p, i) => `
[${i + 1}] ${p.path}
   Status: ${p.status} | Size: ${p.size} lines | Language: ${p.language} | Priority: ${p.priority}
   Preview:
${p.preview
  .split('\n')
  .map(l => '   ' + l)
  .join('\n')}
---`
      )
      .join('\n');

    return `You are analyzing a git commit with ${previews.length} changed files.

YOUR TASK: Select the TOP ${maxFiles} most important files needed to write an accurate, comprehensive commit message.

SELECTION CRITERIA:
1. **Core changes**: Files that represent the main purpose of this commit
2. **Source code priority**: Prefer actual code over configs/docs (unless config IS the main change)
3. **Avoid redundancy**: If 10 test files test the same feature, pick 2-3 representative ones
4. **Context matters**: Include files that provide context for understanding the changes
5. **Watch for patterns**:
   - New files (added) are often important
   - Deleted files may indicate major refactoring
   - Modified core modules are usually critical

FILES TO ANALYZE:
${filesList}

RESPONSE FORMAT (JSON only):
{
  "selectedFiles": ["path/to/file1.ts", "path/to/file2.ts", ...],
  "reasoning": "Brief explanation of selection strategy (1-2 sentences)",
  "confidence": 0.85
}

Return ONLY valid JSON, no markdown, no explanations outside JSON.`;
  }

  /**
   * Parse AI response into structured result
   */
  private parseAIResponse(response: string): AIFileSelectionResult {
    try {
      // Remove markdown code blocks if present
      let cleaned = response.trim();
      const match = cleaned.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (match && match[1]) {
        cleaned = match[1];
      }

      // Try to extract JSON from text
      const jsonMatch = cleaned.match(/\{[\s\S]*"selectedFiles"[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      const parsed = JSON.parse(cleaned);

      if (!parsed.selectedFiles || !Array.isArray(parsed.selectedFiles)) {
        throw new Error('Invalid response: selectedFiles must be an array');
      }

      return {
        selectedFiles: parsed.selectedFiles,
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      logger.error('Failed to parse AI selection response', error as Error);
      logger.debug('Raw response was:', { response });
      throw new Error('Invalid AI response format');
    }
  }

  /**
   * Fallback heuristic selection for large commits
   * Uses scoring algorithm without AI
   */
  private heuristicSelection(files: GitFile[], maxFiles: number): GitFile[] {
    logger.debug('Using heuristic file selection', {
      totalFiles: files.length,
      maxFiles,
    });

    // Score each file
    const scored = files.map(file => ({
      file,
      score: this.calculateFileScore(file),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take top N files
    const selected = scored.slice(0, maxFiles).map(s => s.file);

    logger.debug('Heuristic selection completed', {
      selectedCount: selected.length,
      topScores: scored.slice(0, 5).map(s => ({ path: s.file.path, score: s.score })),
    });

    return selected;
  }

  /**
   * Calculate numeric score for heuristic sorting
   */
  private calculateFileScore(file: GitFile): number {
    let score = 0;
    const path = file.path.toLowerCase();

    // Priority by file type
    if (/\.(ts|tsx|js|jsx|py|rb|java|go|rs|cpp|c)$/.test(path)) {
      score += 100; // Source code
    } else if (/\.(json|yaml|yml|toml|sql)$/.test(path)) {
      score += 50; // Config/data
    } else if (/\.(md|txt)$/.test(path)) {
      score += 20; // Docs
    } else if (/\.(css|scss|html)$/.test(path)) {
      score += 30; // Styles/markup
    }

    // Boost for file status
    if (file.status === 'added') score += 30; // New files are important
    if (file.status === 'deleted') score += 20; // Deletions indicate refactoring
    if (file.status === 'modified') score += 10; // Standard changes

    // Boost for core directories
    if (/^src\//.test(path)) score += 20;
    if (/^lib\//.test(path)) score += 15;
    if (/^app\//.test(path)) score += 15;
    if (/^core\//.test(path)) score += 25;

    // Boost for important files
    if (/package\.json$/.test(path)) score += 40;
    if (/tsconfig\.json$/.test(path)) score += 25;
    if (/Dockerfile$/.test(path)) score += 30;
    if (/Makefile$/.test(path)) score += 25;
    if (/\.env/.test(path)) score += 35;

    // Penalize test files (unless that's the main change)
    if (/\.(test|spec)\.(ts|js|py|rb)$/.test(path)) score -= 10;

    // Penalize deep nested files (might be less important)
    const depth = path.split('/').length;
    if (depth > 5) score -= 5 * (depth - 5);

    // Boost for changes size (more changes = more important)
    const linesChanged = file.chunks.reduce(
      (sum, chunk) =>
        sum + chunk.lines.filter(l => l.type === 'added' || l.type === 'removed').length,
      0
    );
    score += Math.min(linesChanged / 10, 50); // Cap at +50

    return score;
  }

  /**
   * Get model for file selection (use cheaper, faster model)
   */
  private getSelectionModel(): string {
    const provider = this.config.preferences.defaultProvider;

    // Use cheaper models for file selection
    if (provider === 'openrouter') {
      return 'anthropic/claude-3-haiku:beta';
    } else {
      return 'gpt-3.5-turbo';
    }
  }
}
