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
import { secretScanner } from './secret-scanner.js';
import { confirm, isCancel, text } from '@clack/prompts';
import chalk from 'chalk';
import {
  wrapInstructions,
  wrapRules,
  wrapContext,
  wrapUserFeedback,
  wrapDiffContent,
  wrapInBlock,
  parseAIResponse,
  COMMIT_RESPONSE_FORMAT
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

      // Phase 2.5: Secret scanning (skip if --no-secret-scan flag is set)
      if (options.secretScan !== false) {
        filterProgress.update('Scanning for secrets with Gitleaks');

        try {
          const scanResult = await secretScanner.scanStagedChanges();

        if (scanResult.criticalSecrets.length > 0) {
          filterProgress.fail(`Secrets detected (${scanResult.criticalSecrets.length} critical)`);

          console.log(chalk.red('\n🚨 BLOCKED: Secrets detected in staged files!\n'));
          console.log(chalk.yellow('Critical secrets found:\n'));

          // Group by file
          const secretsByFile = new Map<string, typeof scanResult.criticalSecrets>();
          scanResult.criticalSecrets.forEach(secret => {
            if (!secretsByFile.has(secret.file)) {
              secretsByFile.set(secret.file, []);
            }
            secretsByFile.get(secret.file)!.push(secret);
          });

          // Display grouped by file
          secretsByFile.forEach((secrets, file) => {
            console.log(chalk.yellow(`  ${file}:`));
            secrets.forEach(secret => {
              console.log(chalk.gray(`    Line ${secret.line}:${secret.column}`));
              console.log(chalk.gray(`    ${secret.message}`));
              if (secret.data) {
                console.log(chalk.gray(`    Found: ${secret.data}`));
              }
              console.log(chalk.gray(`    Rule: ${secret.ruleId}\n`));
            });
          });

          console.log(chalk.gray('To fix this issue:'));
          console.log(chalk.gray('  1. Remove secrets from code'));
          console.log(chalk.gray('  2. Use environment variables instead'));
          console.log(chalk.gray('  3. Add affected files to .gitignore'));
          console.log(chalk.gray('  4. Create .gitleaksignore file to suppress false positives'));
          console.log(chalk.gray('  5. Or skip secret scan: orc commit --no-secret-scan (not recommended!)\n'));

          throw new GitError('Commit blocked: Critical secrets detected');
        }

        // Show warnings if any
        if (scanResult.warnings.length > 0) {
          contextualLogger.warn(`Found ${scanResult.warnings.length} potential secrets (warnings)`);

          if (!options.yes) {
            console.log(chalk.yellow('\n⚠️  Warning: Potential secrets detected\n'));

            scanResult.warnings.slice(0, 3).forEach(secret => {
              console.log(chalk.yellow(`  ${secret.file}:${secret.line}`));
              console.log(chalk.gray(`  ${secret.message}\n`));
            });

            if (scanResult.warnings.length > 3) {
              console.log(chalk.gray(`  ... and ${scanResult.warnings.length - 3} more\n`));
            }

            const proceed = await confirm({
              message: 'Continue with commit?',
              initialValue: false
            });

            if (isCancel(proceed) || !proceed) {
              throw new GitError('Commit cancelled: User declined due to secret warnings');
            }
          }
        } else {
          filterProgress.succeed(`Ready to analyze ${diff.files.length} files (no secrets detected)`);
        }
      } catch (error) {
        if (error instanceof GitError) {
          throw error; // Re-throw blocking errors
        }
        // If secret scanning fails, log but don't block commit
        contextualLogger.warn(`Secret scanning failed: ${(error as Error).message}`);
        filterProgress.succeed(`Ready to analyze ${diff.files.length} files (scan skipped)`);
      }
    } else {
      // Secret scanning disabled by --no-secret-scan flag
      contextualLogger.warn('Secret scanning disabled by --no-secret-scan flag');
      filterProgress.succeed(`Ready to analyze ${diff.files.length} files (secret scan disabled)`);
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

      // Repository-scoped cache key prevents cross-project collisions
      const cacheScope = await gitManager.getCacheScope();

      // Check cache first (unless disabled or regenerating with feedback)
      if (!options.noCache && !userFeedback) {
        const cachedMessage = await cacheManager.get(
          rawDiffContent, // Use raw content for cache key
          model,
          provider,
          this.config!.preferences.temperature,
          cacheScope
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
          responseFormat: COMMIT_RESPONSE_FORMAT,
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

        // Clean the commit message locally — no second LLM round-trip needed.
        // The model already returns the message inside structured JSON; we just
        // strip artifacts (prefixes, quotes, code fences) deterministically.
        const finalMessage = this.cleanCommitMessage(parsed.commitMessage);

        // Cache the finalized result (skip if regenerating with feedback)
        if (!options.noCache && !userFeedback) {
          await cacheManager.set(
            rawDiffContent, // Use raw content for cache key
            model,
            provider,
            this.config!.preferences.temperature,
            finalMessage,
            cacheScope
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
          responseFormat: COMMIT_RESPONSE_FORMAT,
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

        // Clean locally (see single-request path above) — no extra LLM call.
        const finalMessage = this.cleanCommitMessage(parsed.commitMessage);

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

YOUR MISSION: Describe ONLY the changes present in the [DIFF_CONTENT] block below. The commit message must be derived EXCLUSIVELY from the actual diff — the literal added/removed lines and the files they touch.

ABSOLUTE RULES (these override stylistic preferences):
- Ground EVERY claim in a concrete line or file from the diff. If it is not in the diff, it does not go in the message.
- NEVER invent, assume, or pattern-match a change that is not literally shown (e.g. do not say "migrate to JWT", "refactor auth", "add tests" unless those exact changes appear in the diff).
- If the diff is small or trivial, write a small, literal message. Do NOT inflate it into something grander than the actual change.
- Use the real file paths, function names, and symbols from the diff. Generic boilerplate is a failure.

ANALYSIS STEPS:
1. Read the actual added/removed lines per file.
2. Identify the PRIMARY change and its concrete effect.
3. Capture meaningful secondary changes that are actually present.
4. Choose the conventional-commit type that matches what the lines literally do.`;

    sections.push(wrapInstructions(mainInstructions));

    // Quality standards and rules
    let rules = `- Be SPECIFIC about what changed (mention key functions, components, files when relevant)
- Be ACCURATE - every word should reflect the actual changes
- Be COMPLETE - include all important changes, don't omit significant details
- Be CONCISE but INFORMATIVE - no fluff, but don't skip important info
- Use technical terminology appropriately
- Write in ${language === 'en' ? 'English' : language}
- Follow ${format === 'conventional' ? 'Conventional Commits format strictly' : 'simple descriptive format'}
- Describe ONLY what the diff shows — no speculation, no generic filler

THINK STEP BY STEP (about THIS diff, not commits in general):
1. Which specific files and symbols changed, per the diff?
2. What do the added/removed lines literally do?
3. Are there breaking changes visible in the diff?
4. Which secondary changes are actually present?
5. What is the smallest accurate description of all of the above?`;

    // Add formatting constraints to rules
    if (options.oneLine) {
      rules += `\n- Generate a single-line commit message only`;
    } else {
      rules += `\n- Keep subject line under 72 characters\n- Add body if needed for complex changes`;
    }

    if (options.descriptionLength) {
      rules += `\n- Limit description to ${options.descriptionLength} characters`;
    }

    // Add max commit length constraint from config
    const maxLength = this.config!.preferences.maxCommitLength;
    if (maxLength && maxLength > 0) {
      rules += `\n- ⚠️ CRITICAL LENGTH LIMIT: Total message (subject + body + footer) MUST be ${maxLength} characters or less. This is MANDATORY.`;
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

Return a JSON object matching the RESPONSE_SCHEMA above (two fields: codeAssessment, commitMessage).

⚠️ MOST IMPORTANT RULE: the commitMessage must describe ONLY what the [DIFF_CONTENT] literally shows.
Never emit a generic, memorized message (e.g. "restructure X", "migrate from A to B", "implement authentication") unless those exact changes appear in the diff. If the diff is tiny, write a tiny literal message. Grounding every word in the actual diff is more important than sounding impressive.`;

    sections.push(wrapInstructions(finalInstructions));

    return sections.join('\n\n');
  }

  /**
   * Clean up a commit message locally (no LLM round-trip).
   *
   * The message arrives already extracted from structured JSON, so cleaning is
   * purely deterministic: strip leftover prefixes/quotes/code-fences, normalize
   * whitespace and line endings, and enforce the configured max length. This
   * replaces the old "Stage 2" finalization LLM call, removing ~half the token
   * cost and latency plus a failure point, with identical end results.
   */
  private cleanCommitMessage(rawMessage: string): string {
    let message = (rawMessage || '').replace(/\r\n/g, '\n').trim();

    // Strip surrounding markdown code fences (```...``` or ```lang ... ```)
    const fenceMatch = message.match(/^```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```$/);
    if (fenceMatch && fenceMatch[1]) {
      message = fenceMatch[1].trim();
    }

    // Remove common AI-generated lead-ins
    const prefixPatterns = [
      /^commit message:\s*/i,
      /^here is the commit message:\s*/i,
      /^here's the commit message:\s*/i,
      /^the commit message is:\s*/i,
      /^this is the commit message:\s*/i,
      /^suggested commit:\s*/i,
      /^commit:\s*/i,
    ];
    for (const pattern of prefixPatterns) {
      message = message.replace(pattern, '');
    }

    // Remove wrapping quotes around the whole message
    message = message.replace(/^"([\s\S]+)"$/, '$1').replace(/^'([\s\S]+)'$/, '$1');

    // Collapse excessive blank lines, trim trailing spaces per line
    message = message
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Enforce configured max length as a final safety net
    const maxLength = this.config!.preferences.maxCommitLength;
    if (maxLength && maxLength > 0 && message.length > maxLength) {
      const lines = message.split('\n');
      const subject = lines[0] || '';
      if (subject.length > maxLength) {
        message = subject.substring(0, maxLength - 3) + '...';
      } else {
        message = message.substring(0, maxLength - 3) + '...';
      }
      logger.debug(`Commit message trimmed to ${maxLength} chars`);
    }

    return message;
  }

  /**
   * Prepare diff content for API consumption
   */
  private prepareDiffContent(diff: GitDiff): string {
    const sections: string[] = [];

    // Add summary
    sections.push(`Summary: ${diff.files.length} files changed, ${diff.totalLines} lines modified\n`);

    // Adaptive per-file line budget: keep small commits fully intact, only
    // trim genuinely huge diffs so the prompt stays within token limits.
    // Token-based chunking downstream is the real overflow guard; this is a
    // soft cap to avoid pathologically large single files dominating context.
    const lineLimit = this.getAdaptiveLineLimit(diff.files[0] || {} as GitFile, diff.files.length);

    // Add file changes as a real unified-diff-style block per file, preserving
    // surrounding context lines and hunk headers. The model needs to SEE what
    // the code does, not a stripped list of +/- lines — that's what made it
    // fall back to memorized clichés on thin input.
    for (const file of diff.files) {
      if (file.isBinary) {
        sections.push(`--- ${file.path} (${file.status}) — binary file`);
        continue;
      }

      sections.push(`--- ${file.path} (${file.status})`);

      for (const chunk of file.chunks) {
        // Hunk header gives the model location/structure context
        if (chunk.header) {
          sections.push(chunk.header);
        }

        const renderedLines: string[] = [];
        let truncated = false;

        for (const line of chunk.lines) {
          if (renderedLines.length >= lineLimit) {
            truncated = true;
            break;
          }
          const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
          renderedLines.push(`${prefix}${line.content}`);
        }

        if (renderedLines.length > 0) {
          sections.push(renderedLines.join('\n'));
        }
        if (truncated) {
          sections.push(`… (hunk truncated at ${lineLimit} lines)`);
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

    // Default models. Gemini Flash Lite is cheap, fast, and supports strict
    // json_schema structured output — a good default for commit generation.
    return provider === 'openrouter'
      ? 'google/gemini-2.5-flash-lite'
      : 'gpt-4o-mini';
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
    const { riskLevel, totalFiles, recommendations, suspiciousPatterns } = analysis;

    // Only show messages for non-safe commits
    if (riskLevel === 'safe') {
      return; // Silent for safe commits
    }

    // Handle dangerous commits - block immediately
    if (riskLevel === 'dangerous') {
      // Check if it's specifically node_modules issue (vendor allowed for Go projects)
      const hasPackageManagerFiles = suspiciousPatterns.some(pattern =>
        pattern.includes('node_modules') ||
        pattern.includes('bower_components')
      );

      // ALWAYS block node_modules commits, even with --yes
      if (hasPackageManagerFiles) {
        // Stop progress before showing error
        if (progress) {
          progress.fail(`Dangerous commit detected: package manager directories staged`);
        }

        console.log(chalk.red('\n🚨 BLOCKED: Cannot commit dependency directories\n'));
        console.log(chalk.yellow('The following were detected in staging area:'));

        // Show specific patterns detected
        const packagePatterns = suspiciousPatterns.filter(p =>
          p.includes('node_modules') || p.includes('bower_components')
        );
        packagePatterns.forEach(pattern => {
          console.log(chalk.yellow(`  • ${pattern}`));
        });

        console.log(chalk.gray('\nTo fix this issue:'));
        console.log(chalk.gray('  1. Unstage unwanted files: git reset HEAD node_modules/'));
        console.log(chalk.gray('  2. Update your .gitignore file'));
        console.log(chalk.gray('  3. Stage only the files you want to commit\n'));

        throw new GitError('Commit blocked: dependency directories should not be committed');
      }

      // For other dangerous commits, respect --yes flag
      if (options.yes) {
        return; // Silent proceed with --yes
      }

      // Stop progress before showing error
      if (progress) {
        progress.fail(`Dangerous commit detected (${totalFiles} files)`);
      }

      // Show only the most important recommendations
      const criticalRecs = recommendations.filter(rec => rec.includes('STOP'));
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
    // Per-hunk soft cap. Generous on purpose: token-based chunking is the real
    // overflow guard, so here we only protect against a single pathological hunk
    // swallowing the whole prompt. Small/medium commits are sent essentially in full.
    if (totalFiles <= 5) {
      return 1000;
    }
    if (totalFiles <= 20) {
      return 500;
    }
    if (totalFiles <= 50) {
      return 200;
    }
    return 100;
  }
}

// Singleton instance
export const coreOrchestrator = new CoreOrchestrator();
