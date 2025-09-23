import { 
  CliOptions, 
  GitDiff, 
  ApiRequest, 
  ProcessingResult,
  Config,
  CommitType,
  CHUNK_LIMITS,
  ConfigError,
  GitError,
  ApiError
} from '../types/index.js';
import { configManager } from './config.js';
import { gitManager } from './git.js';
import { apiManager } from './api.js';
import { logger, ProgressIndicator } from './logger.js';
import { tokenManager } from './tokenizer.js';
import { cacheManager } from './cache.js';
import { diffFilter } from './diff-filter.js';

export class CoreOrchestrator {
  private config?: Config;

  /**
   * Initialize the core orchestrator
   */
  async initialize(): Promise<void> {
    try {
      this.config = await configManager.load();
      logger.debug('Configuration loaded successfully');
    } catch (error) {
      throw new ConfigError(
        `Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Main entry point for generating and creating commits
   */
  async generateCommit(options: CliOptions): Promise<void> {
    if (!this.config) {
      throw new ConfigError('Core orchestrator not initialized');
    }

    // Set up logger based on options
    const contextualLogger = logger.withOptions({ 
      verbose: options.verbose || false,
      silent: false 
    });

    try {
      // Validate environment
      await this.validateEnvironment(options);

      // Handle cache clearing if requested
      if (options.clearCache) {
        const cacheProgress = contextualLogger.startProgress('Clearing cache...');
        await cacheManager.clear();
        cacheProgress.succeed('Cache cleared');
      }

      // Get staged changes
      const progress = contextualLogger.startProgress('Analyzing staged changes...');
      const rawDiff = await gitManager.getStagedDiff({
        maxChunkSize: CHUNK_LIMITS.MAX_CHUNK_SIZE,
        preserveContext: true,
        maxConcurrency: CHUNK_LIMITS.MAX_CONCURRENT_REQUESTS,
      });

      if (rawDiff.files.length === 0) {
        progress.stop();
        contextualLogger.warn('No staged changes found. Use `git add` to stage files first.');
        return;
      }

      // Filter diff based on options
      progress.update('Filtering and analyzing changes...');
      let diff = diffFilter.filterDiff(rawDiff, {
        ignoreGenerated: options.ignoreGenerated,
        ignoreWhitespace: options.ignoreWhitespace,
        maxFileSize: 1024 * 1024, // 1MB
        relevancyThreshold: 0.1,
      });

      // Limit files if requested
      if (options.maxFiles && diff.files.length > options.maxFiles) {
        diff = {
          ...diff,
          files: diff.files.slice(0, options.maxFiles)
        };
        contextualLogger.info(`Limited analysis to ${options.maxFiles} most relevant files`);
      }

      if (diff.files.length === 0) {
        progress.stop();
        contextualLogger.warn('No relevant changes found after filtering.');
        return;
      }

      const filterSummary = diffFilter.getFilteringSummary(rawDiff, diff);
      progress.update(`Found ${diff.files.length} files (${filterSummary.filesRemoved} filtered out)`);
      progress.succeed(`Analyzed ${diff.files.length} relevant files`);

      // Determine provider
      const provider = options.provider || this.config.preferences.defaultProvider;
      contextualLogger.info(`Using ${provider} for commit generation`);

      // Initialize API client
      apiManager.initializeProvider(provider, this.config);

      // Generate commit message
      const commitMessage = await this.generateCommitMessage(diff, options, provider);

      if (options.dryRun) {
        contextualLogger.info('Generated commit message (dry run):');
        console.log('\n' + commitMessage + '\n');
        return;
      }

      // Confirm or auto-commit
      const shouldCommit = await this.confirmCommit(commitMessage, options);
      
      if (shouldCommit) {
        const commitProgress = contextualLogger.startProgress('Creating commit...');
        await gitManager.createCommit(commitMessage);
        commitProgress.succeed('Commit created successfully!');
        
        contextualLogger.success(`Commit: ${commitMessage}`);
      } else {
        contextualLogger.info('Commit cancelled by user');
      }

    } catch (error) {
      if (error instanceof ConfigError || error instanceof GitError || error instanceof ApiError) {
        contextualLogger.error(error.message, options.verbose ? error : undefined);
      } else {
        contextualLogger.error(
          `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          error instanceof Error ? error : undefined
        );
      }
      throw error;
    }
  }

  /**
   * Generate commit message from diff
   */
  private async generateCommitMessage(
    diff: GitDiff,
    options: CliOptions,
    provider: 'openrouter' | 'openai'
  ): Promise<string> {
    const progress = logger.startProgress('Generating commit message...');

    try {
      // Create system prompt
      const systemPrompt = this.createSystemPrompt(options);
      
      // Prepare diff content for processing
      const diffContent = this.prepareDiffContent(diff);
      const model = this.getModel(provider);
      
      // Check cache first (unless disabled)
      if (!options.noCache) {
        const cachedMessage = await cacheManager.get(
          diffContent,
          model,
          provider,
          this.config!.preferences.temperature
        );
        
        if (cachedMessage) {
          progress.succeed('Commit message retrieved from cache');
          return cachedMessage;
        }
      }
      
      // Get optimal chunk size for the model
      const optimalChunkSize = tokenManager.getOptimalChunkSize(model);
      const systemTokens = tokenManager.estimateSystemTokens(systemPrompt, model);
      const availableTokens = optimalChunkSize - systemTokens;
      
      // Check if we need to chunk the content based on tokens
      const contentTokens = tokenManager.countTokens(diffContent, model);
      
      if (contentTokens <= availableTokens) {
        // Single request
        const request: ApiRequest = {
          provider,
          model: this.getModel(provider),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: diffContent },
          ],
          maxTokens: this.config!.preferences.maxTokens,
          temperature: this.config!.preferences.temperature,
        };

        const result = await apiManager.generateCommitMessage(request, provider);
        
        if (!result.success || !result.data) {
          throw new ApiError(result.error?.message || 'Failed to generate commit message');
        }

        // Cache the result
        if (!options.noCache) {
          await cacheManager.set(
            diffContent,
            model,
            provider,
            this.config!.preferences.temperature,
            result.data
          );
        }

        progress.succeed('Commit message generated');
        return result.data;

      } else {
        // Multiple chunks processing with token-based splitting
        progress.update('Processing large diff in chunks...');
        
        const chunks = tokenManager.splitIntoTokenChunks(diffContent, {
          model,
          maxTokens: optimalChunkSize,
          reservedTokens: systemTokens,
        });
        
        logger.debug(`Split into ${chunks.length} token-based chunks`);
        
        const baseRequest = {
          provider,
          model,
          maxTokens: this.config!.preferences.maxTokens,
          temperature: this.config!.preferences.temperature,
          systemPrompt,
        };

        const result = await apiManager.processChunks(chunks, baseRequest, provider);
        
        if (!result.success || !result.data) {
          throw new ApiError(result.error?.message || 'Failed to process chunks');
        }

        // Combine chunk results into a single commit message
        const finalMessage = this.combineChunkResults(result.data, options);
        
        progress.succeed('Commit message generated from chunks');
        return finalMessage;
      }

    } catch (error) {
      progress.fail('Failed to generate commit message');
      throw error;
    }
  }

  /**
   * Create system prompt based on options and preferences
   */
  private createSystemPrompt(options: CliOptions): string {
    const format = this.config!.preferences.commitFormat;
    const language = this.config!.preferences.language;

    let prompt = `You are an expert Git commit message generator. Generate a concise, meaningful commit message based on the provided git diff.

Requirements:
- Write in ${language === 'en' ? 'English' : language}
- Use ${format === 'conventional' ? 'Conventional Commits format' : 'simple descriptive format'}
- Focus on the most significant changes
- Be specific and actionable

`;

    // Formatting constraints
    if (options.oneLine) {
      prompt += `- Generate a single-line commit message only\n`;
    } else {
      prompt += `- Keep subject line under 72 characters\n- Add body if needed for complex changes\n`;
    }

    if (options.descriptionLength) {
      prompt += `- Limit description to ${options.descriptionLength} characters\n`;
    }

    if (options.emoji) {
      prompt += `- Include appropriate emoji at the start of the commit message\n`;
    }

    if (format === 'conventional') {
      prompt += `\nConventional Commits format:
<type>[optional scope]: <description>

Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert
`;
      
      if (options.emoji) {
        prompt += `Emoji mapping:
- feat: ✨
- fix: 🐛
- docs: 📝
- style: 💄
- refactor: ♻️
- test: ✅
- chore: 🔧
- perf: ⚡
- ci: 👷
- build: 📦
- revert: ⏪
`;
      }
    }

    if (options.type) {
      prompt += `\nRequired type: ${options.type}`;
    }

    if (options.scope) {
      prompt += `\nRequired scope: ${options.scope}`;
    }

    if (options.breaking) {
      prompt += `\nThis is a BREAKING CHANGE - include "BREAKING CHANGE:" in the commit message.`;
    }

    prompt += `\nGenerate only the commit message, no additional text or explanation.`;

    return prompt;
  }

  /**
   * Prepare diff content for API consumption
   */
  private prepareDiffContent(diff: GitDiff): string {
    const sections: string[] = [];

    // Add summary
    sections.push(`Summary: ${diff.files.length} files changed, ${diff.totalLines} lines modified\n`);

    // Add file changes
    for (const file of diff.files) {
      if (file.isBinary) {
        sections.push(`File: ${file.path} (${file.status}) - Binary file`);
        continue;
      }

      sections.push(`File: ${file.path} (${file.status})`);
      
      for (const chunk of file.chunks) {
        if (chunk.context) {
          sections.push(`Context: ${chunk.context}`);
        }
        
        const relevantLines = chunk.lines
          .filter(line => line.type === 'added' || line.type === 'removed')
          .slice(0, 20) // Limit lines per chunk
          .map(line => `${line.type === 'added' ? '+' : '-'}${line.content}`)
          .join('\n');
        
        if (relevantLines) {
          sections.push(relevantLines);
        }
      }
      
      sections.push(''); // Empty line between files
    }

    return sections.join('\n');
  }

  /**
   * Split large diff content into manageable chunks
   */
  private splitDiffIntoChunks(content: string): string[] {
    const chunks: string[] = [];
    const lines = content.split('\n');
    let currentChunk: string[] = [];
    let currentSize = 0;

    for (const line of lines) {
      const lineSize = line.length + 1; // +1 for newline
      
      if (currentSize + lineSize > CHUNK_LIMITS.MAX_CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentSize = 0;
      }
      
      currentChunk.push(line);
      currentSize += lineSize;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    return chunks;
  }

  /**
   * Combine results from multiple chunks into a single commit message
   */
  private combineChunkResults(results: string[], options: CliOptions): string {
    if (results.length === 1) {
      return results[0]!;
    }

    // Find the most comprehensive result or combine them intelligently
    const longestResult = results.reduce((longest, current) => 
      current.length > longest.length ? current : longest
    );

    // If we have a type preference, ensure it's reflected
    if (options.type && !longestResult.toLowerCase().includes(options.type)) {
      const typePrefix = options.scope ? `${options.type}(${options.scope}):` : `${options.type}:`;
      return `${typePrefix} ${longestResult.replace(/^[a-z]+(\([^)]+\))?\s*:\s*/i, '')}`;
    }

    return longestResult;
  }

  /**
   * Get the appropriate model for the provider
   */
  private getModel(provider: 'openrouter' | 'openai'): string {
    const configuredModel = this.config!.providers[provider].model;
    
    if (configuredModel) {
      return configuredModel;
    }

    // Default models
    return provider === 'openrouter' 
      ? 'anthropic/claude-3-haiku:beta'
      : 'gpt-3.5-turbo';
  }

  /**
   * Confirm commit with user (unless auto-confirm is enabled)
   */
  private async confirmCommit(message: string, options: CliOptions): Promise<boolean> {
    if (options.yes || this.config!.preferences.autoConfirm) {
      return true;
    }

    // For now, we'll implement a simple console confirmation
    // In a full implementation, you might want to use a library like inquirer
    console.log(`\nProposed commit message:\n${message}\n`);
    
    // Simple readline implementation for confirmation
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question('Create this commit? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase().startsWith('y'));
      });
    });
  }

  /**
   * Validate environment before processing
   */
  private async validateEnvironment(options: CliOptions): Promise<void> {
    // Check if in git repository
    const isGitRepo = await gitManager.isGitRepository();
    if (!isGitRepo) {
      throw new GitError('Not in a git repository');
    }

    // Check if there are staged changes
    const stagedFiles = await gitManager.getStagedFiles();
    if (stagedFiles.length === 0) {
      throw new GitError('No staged changes found. Use `git add` to stage files first.');
    }

    // Validate API configuration
    const provider = options.provider || this.config!.preferences.defaultProvider;
    const isConfigValid = await configManager.validateConfig(provider);
    if (!isConfigValid) {
      throw new ConfigError(
        `API key not configured for ${provider}. Use 'orc config set ${provider} <api-key>' to set it.`
      );
    }

    logger.debug('Environment validation passed', { 
      provider, 
      stagedFiles: stagedFiles.length 
    });
  }
}

// Singleton instance
export const coreOrchestrator = new CoreOrchestrator();
