import {
  CliOptions,
  GitDiff,
  GitFile,
  ApiRequest,
  ProcessingResult,
  Config,
  CommitType,
  CHUNK_LIMITS,
  ConfigError,
  GitError,
  ApiError,
  FileSafetyAnalysis
} from '../types/index.js';
import { configManager } from './config.js';
import { gitManager } from './git.js';
import { apiManager } from './api.js';
import { logger, ProgressIndicator } from './logger.js';
import { tokenManager } from './tokenizer.js';
import { cacheManager } from './cache.js';
import { diffFilter } from './diff-filter.js';
import { AIFileSelector } from './file-selector.js';
import { maybeShowPromo } from './promo.js';
import { confirm, isCancel, text } from '@clack/prompts';
import chalk from 'chalk';
import {
  wrapInstructions,
  wrapRules,
  wrapContext,
  wrapUserFeedback,
  wrapDiffContent,
  wrapInBlock,
  cleanText,
  parseAIResponse
} from '../utils/formatting.js';
import { createAIThinkingSpinner, createProcessingSpinner } from './spinner.js';

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

      // Phase 1: Get staged changes (with safety check)
      const analyzeProgress = contextualLogger.startProgress('Analyzing changes');
      
      // Quick safety check first
      const safetyAnalysis = await gitManager.analyzeStagedFilesSafety();
      analyzeProgress.update('Checking file safety');
      
      await this.handleSafetyCheck(safetyAnalysis, options, contextualLogger, analyzeProgress);
      
      analyzeProgress.update('Reading staged changes');
      
      const rawDiff = await gitManager.getStagedDiff({
        maxChunkSize: CHUNK_LIMITS.MAX_CHUNK_SIZE,
        preserveContext: true,
        maxConcurrency: CHUNK_LIMITS.MAX_CONCURRENT_REQUESTS,
      });

      if (rawDiff.files.length === 0) {
        analyzeProgress.fail('No staged changes found');
        contextualLogger.warn('Use `git add` to stage files first.');
        return;
      }

      analyzeProgress.succeed(`Found ${rawDiff.files.length} staged files`);
      
      // Show repository statistics
      const totalSize = (rawDiff.totalSize / 1024).toFixed(1);
      contextualLogger.repoStats({
        files: rawDiff.files.length,
        lines: rawDiff.totalLines,
        size: `${totalSize} KB`
      });

      // Phase 2: Filter and process
      const filterProgress = contextualLogger.startProgress('Processing and filtering changes');

      // Step 1: Quick filter to remove obvious junk
      let diff = diffFilter.quickFilter(rawDiff);
      filterProgress.update(`Quick filter: ${diff.files.length} files remaining`);

      // Step 2: AI file selection for medium-sized commits (20-150 files)
      if (this.shouldUseAISelection(diff.files.length)) {
        filterProgress.update('AI analyzing file relevance...');

        const fileSelector = new AIFileSelector(this.config!);
        const maxFiles = options.maxFiles || 30;

        try {
          const selectedFiles = await fileSelector.selectRelevantFiles(diff.files, maxFiles);
          diff = {
            ...diff,
            files: selectedFiles,
            totalLines: selectedFiles.reduce((sum, file) =>
              sum + file.chunks.reduce((chunkSum, chunk) => chunkSum + chunk.lines.length, 0), 0
            ),
            totalSize: selectedFiles.reduce((sum, file) =>
              sum + JSON.stringify(file).length, 0
            ),
          };
          filterProgress.update(`AI selected ${diff.files.length} most relevant files`);
        } catch (error) {
          contextualLogger.warn('AI file selection failed, using standard filtering');
          // Fall through to standard filtering
        }
      }

      // Step 3: Apply traditional filtering (for small commits or if AI selection was skipped)
      if (!this.shouldUseAISelection(rawDiff.files.length)) {
        diff = diffFilter.filterDiff(diff, {
          ignoreGenerated: options.ignoreGenerated,
          ignoreWhitespace: options.ignoreWhitespace,
          maxFileSize: 1024 * 1024, // 1MB
          relevancyThreshold: 0.05, // Lowered from 0.1 to reduce false filtering
        });
      }

      // Limit files if requested
      if (options.maxFiles && diff.files.length > options.maxFiles) {
        diff = {
          ...diff,
          files: diff.files.slice(0, options.maxFiles)
        };
        contextualLogger.info(`Limited analysis to ${options.maxFiles} most relevant files`);
      }

      if (diff.files.length === 0) {
        filterProgress.fail('No relevant changes found');
        contextualLogger.warn('All changes were filtered out. Try adjusting filter settings.');
        return;
      }

      const filterSummary = diffFilter.getFilteringSummary(rawDiff, diff);
      filterProgress.succeed(`Ready to analyze ${diff.files.length} files`);

      if (filterSummary.filesRemoved > 0) {
        contextualLogger.debug(`Filtered out ${filterSummary.filesRemoved} irrelevant files`);
      }

      // Phase 3: Generate commit message
      const provider = options.provider || this.config.preferences.defaultProvider;

      // Initialize API client
      apiManager.initializeProvider(provider, this.config);

      // Generate commit message with regeneration loop
      let commitMessage: string;
      let codeAssessment: string | null = null;
      let userFeedback: string | undefined;
      let regenerationAttempt = 0;
      const maxRegenerations = 5; // Prevent infinite loops

      // eslint-disable-next-line no-constant-condition
      while (true) {
        // Generate commit message (with optional user feedback)
        const result = await this.generateCommitMessage(diff, options, provider, userFeedback);
        commitMessage = result.commitMessage;
        codeAssessment = result.assessment;

        if (options.dryRun) {
          console.log(chalk.blue('\n📝 Generated commit message (dry run):'));
          console.log(chalk.gray('——————————————————'));
          console.log(commitMessage);
          console.log(chalk.gray('——————————————————\n'));

          if (userFeedback) {
            console.log(chalk.yellow(`Regenerated with feedback: ${userFeedback}\n`));
          }

          return;
        }

        // Confirm or regenerate
        const confirmation = await this.confirmCommit(commitMessage, codeAssessment, options);

        if (confirmation.action === 'confirm') {
          break; // Exit loop and proceed to commit
        } else if (confirmation.action === 'cancel') {
          console.log(chalk.yellow('\n✖ Commit cancelled by user'));
          return;
        } else if (confirmation.action === 'regenerate') {
          regenerationAttempt++;

          if (regenerationAttempt >= maxRegenerations) {
            console.log(chalk.yellow(`\n⚠ Maximum regeneration attempts (${maxRegenerations}) reached`));
            const forceCommit = await confirm({
              message: 'Use the last generated message anyway?',
            });

            if (isCancel(forceCommit) || !forceCommit) {
              console.log(chalk.yellow('\n✖ Commit cancelled'));
              return;
            }
            break;
          }

          userFeedback = confirmation.feedback;
          // Regenerate with user feedback
          continue;
        }
      }

      // Create the commit
      if (commitMessage) {
        const commitSpinner = createProcessingSpinner('Creating commit');
        commitSpinner.start();

        await gitManager.createCommit(commitMessage);
        commitSpinner.succeed('Commit created');

        console.log(chalk.gray('\n💬 Message: ') + chalk.white(commitMessage));

        // Maybe show promotional message (1% chance)
        maybeShowPromo();

        // Phase 4: Handle push
        if (options.autoPush || options.push) {
          await this.performPush(contextualLogger);
        } else if (!options.yes && await gitManager.hasUnpushedCommits()) {
          // Ask user if they want to push (only if not in auto mode)
          try {
            const shouldPush = await confirm({
              message: 'Push to remote?'
            });

            if (!isCancel(shouldPush) && shouldPush) {
              await this.performPush(contextualLogger);
            }
          } catch (error) {
            // If interactive prompts fail (e.g., in CI), skip push silently
          }
        }
      } else {
        contextualLogger.info('Commit cancelled by user');
      }

    } catch (error) {
      if (error instanceof ConfigError || error instanceof GitError || error instanceof ApiError) {
        contextualLogger.error(error.message, error);
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
   * Generate commit message from diff with optional user feedback
   */
  private async generateCommitMessage(
    diff: GitDiff,
    options: CliOptions,
    provider: 'openrouter' | 'openai',
    userFeedback?: string
  ): Promise<{ commitMessage: string; assessment: string | null }> {
    const spinner = createAIThinkingSpinner(
      userFeedback ? 'Regenerating commit' : 'Generating commit'
    );
    spinner.start();

    try {
      // Create system prompt (with optional user feedback for regeneration)
      const systemPrompt = this.createSystemPrompt(options, userFeedback);

      if (userFeedback) {
        logger.debug('Regenerating with user feedback', { feedbackLength: userFeedback.length });
      }
      
      // Prepare diff content for processing
      const rawDiffContent = this.prepareDiffContent(diff);
      let diffContent = wrapDiffContent(rawDiffContent); // Wrap in DIFF_CONTENT block

      // Add git context for better understanding (history + branch)
      const gitContext = await gitManager.getGitContextForAI(5);
      if (gitContext) {
        diffContent = gitContext + '\n\n' + diffContent;
        logger.debug('Added git context to prompt', { contextLength: gitContext.length });
      }

      const model = this.getModel(provider);

      // Check cache first (unless disabled or regenerating with feedback)
      if (!options.noCache && !userFeedback) {
        const cachedMessage = await cacheManager.get(
          rawDiffContent, // Use raw content for cache key
          model,
          provider,
          this.config!.preferences.temperature
        );

        if (cachedMessage) {
          spinner.succeed('Retrieved from cache');
          return {
            commitMessage: cachedMessage,
            assessment: null // Cached messages don't have assessment
          };
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

        const rawMessage = result.data;

        // Parse JSON response (with fallback to plain text)
        logger.debug('Raw AI response:', { length: rawMessage.length, preview: rawMessage.substring(0, 200) });
        const parsed = parseAIResponse(rawMessage);
        logger.debug('Parsed response:', { hasAssessment: !!parsed.assessment, messageLength: parsed.commitMessage.length });

        spinner.update('Polishing the message');

        // Stage 2: Finalize and clean the commit message part (with user context)
        const finalMessage = await this.finalizeCommitMessage(parsed.commitMessage, provider, options, userFeedback);

        // Cache the finalized result (skip if regenerating with feedback)
        if (!options.noCache && !userFeedback) {
          await cacheManager.set(
            rawDiffContent, // Use raw content for cache key
            model,
            provider,
            this.config!.preferences.temperature,
            finalMessage
          );
        }

        spinner.succeed('Commit message generated');
        return {
          commitMessage: finalMessage,
          assessment: parsed.assessment
        };

      } else {
        // Multiple chunks processing with token-based splitting
        spinner.update('Processing large diff in chunks');

        const chunks = tokenManager.splitIntoTokenChunks(diffContent, {
          model,
          maxTokens: optimalChunkSize,
          reservedTokens: systemTokens,
        });

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
        const rawMessage = this.combineChunkResults(result.data, options);

        // Parse JSON response (with fallback to plain text)
        logger.debug('Raw AI response (chunks):', { length: rawMessage.length, preview: rawMessage.substring(0, 200) });
        const parsed = parseAIResponse(rawMessage);
        logger.debug('Parsed response (chunks):', { hasAssessment: !!parsed.assessment, messageLength: parsed.commitMessage.length });

        spinner.update('Polishing the message');

        // Stage 2: Finalize and clean the commit message part (with user context)
        const finalMessage = await this.finalizeCommitMessage(parsed.commitMessage, provider, options, userFeedback);

        spinner.succeed('Commit message generated');
        return {
          commitMessage: finalMessage,
          assessment: parsed.assessment
        };
      }

    } catch (error) {
      spinner.fail('Failed to generate commit message');
      throw error;
    }
  }

  /**
   * Create system prompt based on options and preferences
   */
  private createSystemPrompt(options: CliOptions, userFeedback?: string): string {
    // Use custom prompt from CLI option first, then from config, then default
    if (options.prompt) {
      return options.prompt;
    }

    if (this.config!.preferences.customPrompt) {
      return this.config!.preferences.customPrompt;
    }

    // Build default prompt with structured blocks
    const format = this.config!.preferences.commitFormat;
    const language = this.config!.preferences.language;

    const sections: string[] = [];

    // Main instructions
    const mainInstructions = `You are a senior software engineer and Git commit message expert with deep understanding of software architecture and code quality.

YOUR MISSION: Analyze the git diff carefully and generate a professional, comprehensive commit message that accurately captures ALL significant changes.

ANALYSIS REQUIREMENTS:
1. THINK DEEPLY about what the code changes actually do
2. Identify the PRIMARY purpose of the changes (feature, fix, refactor, etc.)
3. Notice ALL important modifications - don't miss secondary changes
4. Understand the INTENT behind the changes, not just the syntax
5. Consider the IMPACT on the codebase (breaking changes, new features, bug fixes)
6. Recognize patterns: new files, deletions, refactoring, configuration changes`;

    sections.push(wrapInstructions(mainInstructions));

    // Quality standards and rules
    let rules = `- Be SPECIFIC about what changed (mention key functions, components, files when relevant)
- Be ACCURATE - every word should reflect the actual changes
- Be COMPLETE - include all important changes, don't omit significant details
- Be CONCISE but INFORMATIVE - no fluff, but don't skip important info
- Use technical terminology appropriately
- Write in ${language === 'en' ? 'English' : language}
- Follow ${format === 'conventional' ? 'Conventional Commits format strictly' : 'simple descriptive format'}

THINK STEP BY STEP:
1. What is the main change? (new feature, bug fix, refactor, etc.)
2. What files/components are affected?
3. Are there any breaking changes?
4. Are there secondary important changes?
5. What's the overall impact?`;

    // Add formatting constraints to rules
    if (options.oneLine) {
      rules += `\n- Generate a single-line commit message only`;
    } else {
      rules += `\n- Keep subject line under 72 characters\n- Add body if needed for complex changes`;
    }

    if (options.descriptionLength) {
      rules += `\n- Limit description to ${options.descriptionLength} characters`;
    }

    if (options.emoji) {
      rules += `\n- Include appropriate emoji at the start of the commit message`;
    }

    if (format === 'conventional') {
      rules += `\n\nConventional Commits format:\n<type>[optional scope]: <description>\n\nTypes: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert`;

      if (options.emoji) {
        rules += `\n\nEmoji mapping:\n- feat: ✨\n- fix: 🐛\n- docs: 📝\n- style: 💄\n- refactor: ♻️\n- test: ✅\n- chore: 🔧\n- perf: ⚡\n- ci: 👷\n- build: 📦\n- revert: ⏪`;
      }
    }

    if (options.type) {
      rules += `\n\nRequired type: ${options.type}`;
    }

    if (options.scope) {
      rules += `\nRequired scope: ${options.scope}`;
    }

    if (options.breaking) {
      rules += `\n\n⚠️ CRITICAL: This is a BREAKING CHANGE - MUST include "BREAKING CHANGE:" in the commit message footer with explanation.`;
    }

    sections.push(wrapRules(rules));

    // Add context if provided
    if (options.context) {
      sections.push(wrapContext(options.context));
    }

    // Add user feedback if provided (from regeneration request)
    if (userFeedback) {
      sections.push(wrapUserFeedback(userFeedback));
    }

    // JSON schema for response
    const jsonSchema = `{
  "codeAssessment": "Brief (1-2 sentences) sarcastic, darkly humorous assessment of the code changes. Be witty and technically insightful. Channel maximum developer cynicism. ${userFeedback ? 'IMPORTANT: Follow user feedback requirements for language and style!' : `Write in ${language}.`}",
  "commitMessage": "Professional ${format === 'conventional' ? 'conventional commits format' : 'descriptive'} commit message. ${userFeedback ? 'CRITICAL: Follow ALL user feedback instructions!' : `Write in ${language}.`}"
}`;

    sections.push(wrapInBlock('RESPONSE_SCHEMA', jsonSchema, false));

    // Final generation instructions
    const finalInstructions = `GENERATE YOUR RESPONSE AS A VALID JSON OBJECT:

${userFeedback ? '⚠️ CRITICAL: The [IMPORTANT_USER_FEEDBACK] block above contains explicit user requirements. Follow ALL instructions from the user feedback - they override ALL other rules (including language, format, style, etc.).\n' : ''}
1. CODE ASSESSMENT - Provide a brief (1-2 sentences), brutally honest, darkly humorous take on the code changes
   Examples: "Someone discovered copy-paste today", "WIP commits everywhere, as expected", "Finally fixing that TODO from 2019"

2. COMMIT MESSAGE - Generate a professional commit message:
   - ${format === 'conventional' ? 'Use conventional commits format: type(scope): description' : 'Use clear descriptive format'}
   - Subject line under 72 characters
   - Add detailed body if changes are complex
   - Include BREAKING CHANGE footer if applicable

CRITICAL: Return ONLY a valid JSON object matching the RESPONSE_SCHEMA above.
⚠️ DO NOT wrap in markdown code blocks (no \`\`\`json)
⚠️ DO NOT add explanations before or after
⚠️ START your response with { and END with }
⚠️ This is REQUIRED - the response MUST be parseable JSON

CORRECT Example:
{"codeAssessment": "Ah yes, another 'quick fix' that touches 47 files", "commitMessage": "refactor: restructure authentication flow\\n\\nMigrate from session-based to JWT authentication"}

WRONG Examples:
- \`\`\`json {"codeAssessment": "..."} \`\`\` ❌
- Here is the JSON: {...} ❌
- Just plain text without JSON ❌`;

    sections.push(wrapInstructions(finalInstructions));

    return sections.join('\n\n');
  }

  /**
   * Finalize and clean up the commit message (Stage 2)
   * Takes the raw AI-generated message and ensures it's perfectly formatted
   */
  private async finalizeCommitMessage(
    rawMessage: string,
    provider: 'openrouter' | 'openai',
    options: CliOptions,
    userFeedback?: string
  ): Promise<string> {
    const format = this.config!.preferences.commitFormat;

    // Create finalization prompt with structured blocks
    const instructions = `You are a commit message quality control expert.

YOUR TASK: Clean and perfect the commit message below. Remove ANY explanatory text, prefixes, or formatting artifacts.
${userFeedback ? '\n⚠️ CRITICAL: User provided feedback. You MUST preserve the language and style they requested!' : ''}`;

    const rules = `1. Output ONLY the final commit message - nothing else
2. Remove prefixes like "commit message:", "here is", "this is", etc.
3. Remove surrounding quotes, backticks, or markdown
4. Remove any explanations or comments
5. Keep the message structure intact (subject + body + footer if present)
6. Start directly with the commit type or message
7. Preserve ${format === 'conventional' ? 'conventional commits format (type(scope): description)' : 'simple format'}
8. Preserve line breaks for multi-line messages
9. Ensure subject line is under 72 characters
10. NO additional text, NO commentary, NO explanations
${userFeedback ? `11. CRITICAL: Preserve the EXACT language used in the message below (user requested specific changes)` : ''}`;

    const finalizationPrompt = `${wrapInstructions(instructions)}

${wrapRules(rules)}

[RAW_MESSAGE_TO_CLEAN]
${cleanText(rawMessage)}
[/RAW_MESSAGE_TO_CLEAN]

OUTPUT ONLY THE CLEANED COMMIT MESSAGE:`;

    try {
      const model = this.getModel(provider);

      const result = await apiManager.generateCommitMessage(
        {
          provider,
          model,
          maxTokens: this.config!.preferences.maxTokens,
          temperature: 0.3, // Lower temperature for more consistent cleaning
          messages: [
            { role: 'system', content: finalizationPrompt },
            { role: 'user', content: 'Clean this message now.' }
          ],
        },
        provider
      );

      if (!result.success || !result.data) {
        // If finalization fails, return original message
        logger.warn('Finalization failed, using original message');
        return rawMessage;
      }

      return result.data.trim();
    } catch (error) {
      // If finalization fails, return original message
      logger.warn('Finalization error, using original message');
      return rawMessage;
    }
  }

  /**
   * Prepare diff content for API consumption
   */
  private prepareDiffContent(diff: GitDiff): string {
    const sections: string[] = [];

    // Add summary
    sections.push(`Summary: ${diff.files.length} files changed, ${diff.totalLines} lines modified\n`);

    // Get adaptive line limit based on commit size
    const lineLimit = this.getAdaptiveLineLimit(diff.files[0] || {} as GitFile, diff.files.length);

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
          .slice(0, lineLimit) // Use adaptive limit instead of hardcoded 20
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
   * Returns: 'confirm' | 'regenerate' | 'cancel'
   */
  private async confirmCommit(
    message: string,
    assessment: string | null,
    options: CliOptions
  ): Promise<{ action: 'confirm' | 'regenerate' | 'cancel'; feedback?: string }> {
    if (options.yes || this.config!.preferences.autoConfirm) {
      return { action: 'confirm' };
    }

    // Show sarcastic code assessment if available
    if (assessment) {
      console.log(chalk.dim('\n💭 AI thinks: ') + chalk.yellow.italic(assessment));
    }

    console.log(chalk.cyan('\n📝 Generated commit message:'));
    console.log(chalk.gray('——————————————————'));
    console.log(chalk.white(message));
    console.log(chalk.gray('——————————————————\n'));

    try {
      const action = await confirm({
        message: 'Accept this commit message?',
        initialValue: true,
      });

      if (isCancel(action)) {
        return { action: 'cancel' };
      }

      if (action) {
        return { action: 'confirm' };
      }

      // User rejected - ask if they want to regenerate with feedback
      console.log('');
      const shouldRegenerate = await confirm({
        message: 'Would you like to regenerate with additional instructions?',
        initialValue: true,
      });

      if (isCancel(shouldRegenerate) || !shouldRegenerate) {
        return { action: 'cancel' };
      }

      // Get user feedback for regeneration
      const feedback = await text({
        message: 'What should be changed or improved?',
        placeholder: 'e.g., "Be more specific about the bug fix" or "Mention the new API endpoint"',
        validate: (value) => {
          if (!value || value.trim().length < 3) {
            return 'Please provide at least 3 characters of feedback';
          }
          return undefined; // Valid input
        },
      });

      if (isCancel(feedback)) {
        return { action: 'cancel' };
      }

      return { action: 'regenerate', feedback: feedback as string };

    } catch (error) {
      // Fallback to simple confirmation if prompts fail
      console.log(chalk.yellow('⚠ Interactive prompts unavailable, using simple mode'));
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      return new Promise((resolve) => {
        rl.question('Accept this commit? (y/N): ', (answer) => {
          rl.close();
          resolve({ action: answer.toLowerCase().startsWith('y') ? 'confirm' : 'cancel' });
        });
      });
    }
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

  /**
   * Perform push operation with proper messaging
   */
  private async performPush(contextualLogger: typeof logger): Promise<void> {
    const hasUpstream = await gitManager.hasUpstream();
    const currentBranch = await gitManager.getCurrentBranch();

    const pushMessage = hasUpstream
      ? `Pushing to ${currentBranch}`
      : `Setting upstream and pushing to ${currentBranch}`;

    const pushSpinner = createProcessingSpinner(pushMessage);
    pushSpinner.start();

    try {
      await gitManager.pushToRemote(true); // Set upstream if needed
      const successMessage = hasUpstream
        ? `Pushed to ${currentBranch}`
        : `Upstream set and pushed to ${currentBranch}`;
      pushSpinner.succeed(successMessage);
    } catch (error) {
      pushSpinner.fail(`Push failed: ${(error as Error).message}`);
    }
  }

  /**
   * Handle safety check for staged files
   */
  private async handleSafetyCheck(
    analysis: FileSafetyAnalysis, 
    options: CliOptions, 
    contextualLogger: typeof logger,
    progress?: ProgressIndicator
  ): Promise<void> {
    const { riskLevel, totalFiles, recommendations } = analysis;
    
    // Only show messages for non-safe commits
    if (riskLevel === 'safe') {
      return; // Silent for safe commits
    }
    
    // Handle dangerous commits - block immediately
    if (riskLevel === 'dangerous') {
      if (options.yes) {
        return; // Silent proceed with --yes
      }
      
      // Stop progress before showing error
      if (progress) {
        progress.fail(`Dangerous commit detected (${totalFiles} files)`);
      }
      
      // Show only the most important recommendations
      const criticalRecs = recommendations.filter(rec => 
        rec.includes('node_modules') || rec.includes('vendor') || rec.includes('STOP')
      );
      if (criticalRecs.length > 0) {
        criticalRecs.slice(0, 2).forEach(rec => {
          console.log(chalk.yellow(`   ${rec}`));
        });
      }
      
      console.log(chalk.gray('Use --yes to override or fix staging area first.\n'));
      throw new GitError('Dangerous commit blocked for safety');
    }
    
    // Handle critical commits - ask for confirmation
    if (riskLevel === 'critical') {
      if (options.yes) {
        return; // Silent proceed with --yes
      }
      
      // Stop progress before showing dialog
      if (progress) {
        progress.stop();
      }
      
      try {
        const { confirm, isCancel } = await import('@clack/prompts');
        
        const shouldProceed = await confirm({
          message: `Large commit detected (${totalFiles} files). Continue?`,
          initialValue: false,
        });
        
        if (isCancel(shouldProceed) || !shouldProceed) {
          throw new GitError('Large commit cancelled by user');
        }
        
      } catch (error) {
        if (error instanceof GitError) {
          throw error;
        }
        // If interactive prompts fail, proceed silently
      }
    }
    
    // For warnings, proceed silently
  }

  /**
   * Determine if we should push changes
   */
  private async shouldPush(options: CliOptions): Promise<boolean> {
    // If auto-push is enabled, always push
    if (options.autoPush) {
      return true;
    }

    // If push flag is set but not yes flag, we might want to ask
    if (options.push && !options.yes) {
      // For now, just return true. In future, could add interactive confirmation
      return true;
    }

    return options.push || false;
  }

  /**
   * Determine if AI file selection should be used
   * Uses AI for medium-sized commits (20-150 files)
   */
  private shouldUseAISelection(fileCount: number): boolean {
    // For very small commits, analyze all files directly
    if (fileCount <= 20) {
      return false;
    }

    // For huge commits, AI selection would be too slow/expensive
    // Use heuristic instead (handled inside AIFileSelector)
    if (fileCount > 150) {
      return false;
    }

    // For medium commits (20-150), use AI selection
    return true;
  }

  /**
   * Get adaptive line limit based on commit size
   * Larger commits get smaller preview per file to stay within token limits
   */
  private getAdaptiveLineLimit(file: GitFile, totalFiles: number): number {
    // For very small commits, show almost everything
    if (totalFiles <= 5) {
      return 200;
    }

    // For small-medium commits, show a lot
    if (totalFiles <= 20) {
      return 100;
    }

    // For medium-large commits, show moderate amount
    if (totalFiles <= 50) {
      return 50;
    }

    // For large commits, show minimum meaningful context
    return 30;
  }
}

// Singleton instance
export const coreOrchestrator = new CoreOrchestrator();
