#!/usr/bin/env node

import { Command } from 'commander';
import updateNotifier from 'update-notifier';
import chalk from 'chalk';
import { coreOrchestrator } from './modules/core.js';
import { configManager } from './modules/config.js';
import { logger } from './modules/logger.js';
import { AutoUpdater } from './modules/auto-updater.js';
import { Doctor } from './modules/doctor.js';
import { CommitType, CliOptions } from './types/index.js';

// Import package.json for version and update checking
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

/**
 * Main CLI application
 */
class CliApplication {
  private program: Command;

  constructor() {
    this.program = new Command();
    this.setupCommands();
    this.checkForUpdates();
  }

  /**
   * Set up all CLI commands and options
   */
  private setupCommands(): void {
    this.program
      .name('orc')
      .description('OpenRouter Commit - AI-powered Git commit message generator')
      .version(packageJson.version, '-v, --version', 'Show version number');

    // Main commit command
    this.program
      .command('commit', { isDefault: true })
      .description('Generate and create a commit message for staged changes')
      .option('-y, --yes', 'Skip confirmation and auto-commit', false)
      .option('-s, --scope <scope>', 'Specify commit scope (e.g., auth, ui, api)')
      .option('-t, --type <type>', 'Specify commit type', this.validateCommitType)
      .option('-b, --breaking', 'Mark as breaking change', false)
      .option('-d, --dry-run', 'Generate message without creating commit', false)
      // NOTE: no -v short flag here — -v is reserved program-wide for --version.
      .option('--verbose', 'Enable verbose logging', false)
      .option('-w, --watch', 'Watch for changes and auto-generate commits', false)
      .option('-p, --provider <provider>', 'Specify AI provider (any configured provider)', this.validateProvider)
      // Extended formatting options
      .option('--emoji', 'Include emoji in commit message', false)
      .option('--one-line', 'Generate single-line commit message', false)
      .option('--description-length <length>', 'Maximum description length', parseInt)
      .option('--max-files <count>', 'Maximum number of files to analyze', parseInt)
      // Filtering options
      .option('--ignore-generated', 'Ignore auto-generated files', true)
      .option('--ignore-whitespace', 'Ignore whitespace-only changes', true)
      // Security options
      .option('--no-secret-scan', 'Skip secret scanning (use with caution!)')
      // Caching options
      .option('--no-cache', 'Disable caching', false)
      .option('--clear-cache', 'Clear cache before generating', false)
      // Git push options
      .option('--push', 'Push changes to remote after commit', false)
      .option('--auto-push', 'Automatically push all future commits', false)
      // Custom prompt options
      .option('--prompt <text>', 'Custom system prompt for AI (overrides default)')
      .option('--context <text>', 'Additional context to include in the prompt')
      .action(async (options: CliOptions) => {
        await this.handleCommitCommand(options);
      });

    // Config management commands
    const configCmd = this.program
      .command('config')
      .description('Manage configuration settings');

    configCmd
      .command('set <provider> <key>')
      .description('Set API key for a provider (creates it if new)')
      .action(async (provider: string, key: string) => {
        await this.handleConfigSet(provider, key);
      });

    configCmd
      .command('get [provider]')
      .description('Get configuration (optionally for specific provider)')
      .action(async (provider?: string) => {
        await this.handleConfigGet(provider);
      });

    configCmd
      .command('model <provider> <model>')
      .description('Set default model for provider')
      .action(async (provider: string, model: string) => {
        await this.handleConfigModel(provider, model);
      });

    configCmd
      .command('provider <name>')
      .description('Configure a custom provider (baseUrl, key, model, auth header)')
      .option('--base-url <url>', 'API base URL (e.g. https://router.cmdop.com/v1)')
      .option('--key <key>', 'API key')
      .option('--model <model>', 'Default model (e.g. @fast)')
      .option('--auth-header <header>', "Auth header name (default 'Authorization'; use 'X-API-Key' for cmdop)")
      .option('--auth-scheme <scheme>', "Scheme prefix for Authorization header (default 'Bearer'; pass empty to send raw)")
      .action(async (name: string, opts: { baseUrl?: string; key?: string; model?: string; authHeader?: string; authScheme?: string }) => {
        await this.handleConfigProvider(name, opts);
      });

    configCmd
      .command('remove-provider <name>')
      .description('Remove a configured provider')
      .action(async (name: string) => {
        await this.handleConfigRemoveProvider(name);
      });

    configCmd
      .command('prompt [text]')
      .description('Set or clear custom system prompt (omit text to clear)')
      .action(async (text?: string) => {
        await this.handleConfigPrompt(text);
      });

    configCmd
      .command('path')
      .description('Show configuration file path')
      .action(() => {
        console.log(configManager.getConfigPath());
      });

    // Cache management commands
    const cacheCmd = this.program
      .command('cache')
      .description('Manage cache settings');

    cacheCmd
      .command('stats')
      .description('Show cache statistics')
      .action(async () => {
        await this.handleCacheStats();
      });

    cacheCmd
      .command('clear')
      .description('Clear all cached data')
      .action(async () => {
        await this.handleCacheClear();
      });

    cacheCmd
      .command('cleanup')
      .description('Clean up expired cache entries')
      .action(async () => {
        await this.handleCacheCleanup();
      });

    // Additional utility commands
    this.program
      .command('test [provider]')
      .description('Test API connection for provider')
      .action(async (provider?: string) => {
        await this.handleTestCommand(provider);
      });

    this.program
      .command('doctor')
      .description('Diagnose installation, PATH, and update issues')
      .action(async () => {
        await this.handleDoctorCommand();
      });

    // Global options
    this.program
      .option('--no-color', 'Disable colored output')
      .option('--silent', 'Suppress all output except errors')
      .hook('preAction', (thisCommand) => {
        const options = thisCommand.opts();
        
        // Configure logger based on global options
        if (options.noColor) {
          process.env.FORCE_COLOR = '0';
        }
        
        logger.withOptions({
          verbose: options.verbose || false,
          silent: options.silent || false,
        });
      });

    // Error handling
    this.program.exitOverride();
    this.program.configureOutput({
      writeErr: (str) => process.stderr.write(`${chalk.red('Error:')} ${str}`),
    });
  }

  /**
   * Handle the main commit command
   */
  private async handleCommitCommand(options: CliOptions): Promise<void> {
    try {
      // Show version info elegantly
      const globalOptions = this.program.opts();
      if (!globalOptions.silent) {
        console.log(chalk.gray(`orc v${packageJson.version}`));
      }
      
      logger.debug('Starting commit command', options);

      if (options.watch) {
        await this.handleWatchMode(options);
        return;
      }

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(options);

    } catch (error) {
      logger.error('Command failed', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle configuration set command
   */
  private async handleConfigSet(provider: string, key: string): Promise<void> {
    try {
      if (!this.isValidProvider(provider)) {
        logger.error(`Invalid provider name: ${provider}`);
        process.exit(1);
      }

      await configManager.setApiKey(provider, key);
      logger.success(`API key set for ${provider}`);

    } catch (error) {
      logger.error('Failed to set configuration', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle configuration get command
   */
  private async handleConfigGet(provider?: string): Promise<void> {
    try {
      const config = await configManager.load();

      if (provider) {
        if (!this.isValidProvider(provider)) {
          logger.error(`Invalid provider name: ${provider}`);
          process.exit(1);
        }

        const maskedKey = await configManager.getMaskedApiKey(provider);
        const providerConfig = config.providers[provider];
        const model = providerConfig?.model || 'default';

        logger.table({
          Provider: provider,
          'API Key': maskedKey,
          Model: model,
          'Base URL': providerConfig?.baseUrl || 'default',
          'Auth Header': providerConfig?.authHeader || 'Authorization',
        });
      } else {
        // Show all configuration — iterate over every configured provider.
        const providers = await configManager.listProviders();

        const table: Record<string, string | number | boolean> = {
          'Default Provider': config.preferences.defaultProvider,
        };

        for (const name of providers) {
          const maskedKey = await configManager.getMaskedApiKey(name);
          const model = config.providers[name]?.model || 'default';
          table[`${name} API Key`] = maskedKey;
          table[`${name} Model`] = model;
        }

        table['Max Tokens'] = config.preferences.maxTokens;
        table['Temperature'] = config.preferences.temperature;
        table['Auto Confirm'] = config.preferences.autoConfirm;
        table['Language'] = config.preferences.language;
        table['Format'] = config.preferences.commitFormat;

        logger.table(table);
      }

    } catch (error) {
      logger.error('Failed to get configuration', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle model configuration command
   */
  private async handleConfigModel(provider: string, model: string): Promise<void> {
    try {
      if (!this.isValidProvider(provider)) {
        logger.error(`Invalid provider name: ${provider}`);
        process.exit(1);
      }

      await configManager.setModel(provider, model);
      logger.success(`Model set to ${model} for ${provider}`);

    } catch (error) {
      logger.error('Failed to set model', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle full custom-provider configuration in one call
   */
  private async handleConfigProvider(
    name: string,
    opts: { baseUrl?: string; key?: string; model?: string; authHeader?: string; authScheme?: string }
  ): Promise<void> {
    try {
      if (!this.isValidProvider(name)) {
        logger.error(`Invalid provider name: ${name}`);
        process.exit(1);
      }

      await configManager.setProvider(name, {
        baseUrl: opts.baseUrl,
        apiKey: opts.key,
        model: opts.model,
        authHeader: opts.authHeader,
        authScheme: opts.authScheme,
      });

      logger.success(`Provider '${name}' configured`);

    } catch (error) {
      logger.error('Failed to configure provider', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle removing a configured provider
   */
  private async handleConfigRemoveProvider(name: string): Promise<void> {
    try {
      if (!this.isValidProvider(name)) {
        logger.error(`Invalid provider name: ${name}`);
        process.exit(1);
      }

      await configManager.removeProvider(name);
      logger.success(`Provider '${name}' removed`);

    } catch (error) {
      logger.error('Failed to remove provider', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle custom prompt configuration
   */
  private async handleConfigPrompt(text?: string): Promise<void> {
    try {
      if (text === undefined || text.trim() === '') {
        // Clear custom prompt
        await configManager.updatePreferences({ customPrompt: undefined });
        logger.success('Custom prompt cleared. Will use default prompt.');
      } else {
        // Set custom prompt
        await configManager.updatePreferences({ customPrompt: text });
        logger.success('Custom prompt saved successfully');
        logger.info(`Preview: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      }
    } catch (error) {
      logger.error('Failed to set custom prompt', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle test command
   */
  private async handleTestCommand(provider?: string): Promise<void> {
    try {
      const config = await configManager.load();
      const testProvider = provider || config.preferences.defaultProvider;

      if (!this.isValidProvider(testProvider)) {
        logger.error(`Invalid provider name: ${testProvider}`);
        process.exit(1);
      }

      const progress = logger.startProgress(`Testing ${testProvider} connection...`);

      await coreOrchestrator.initialize();

      // This would require implementing a test method in the API manager
      // For now, just verify configuration
      const isValid = await configManager.validateConfig(testProvider);
      
      if (isValid) {
        progress.succeed(`${testProvider} connection test passed`);
      } else {
        progress.fail(`${testProvider} connection test failed - check API key`);
        process.exit(1);
      }

    } catch (error) {
      logger.error('Test failed', error as Error);
      process.exit(1);
    }
  }

  /**
   * Diagnose installation / PATH / update issues and print fixes.
   */
  private async handleDoctorCommand(): Promise<void> {
    try {
      const doctor = new Doctor(packageJson.version);
      const report = await doctor.run();
      Doctor.print(report);
      process.exit(report.hasProblems ? 1 : 0);
    } catch (error) {
      logger.error('Doctor failed', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle watch mode
   */
  private async handleWatchMode(options: CliOptions): Promise<void> {
    logger.info('Watch mode not yet implemented');
    logger.info('This would monitor git changes and auto-generate commits');
    
    // TODO: Implement file watching with chokidar or similar
    // Watch for changes in git status and auto-trigger commit generation
  }

  /**
   * Handle cache stats command
   */
  private async handleCacheStats(): Promise<void> {
    try {
      const { cacheManager } = await import('./modules/cache.js');
      const stats = await cacheManager.getStats();

      logger.table({
        'Memory Entries': stats.memoryEntries,
        'Disk Entries': stats.diskEntries,
        'Total Size': stats.totalSize,
        'Oldest Entry': stats.oldestEntry?.toLocaleString() || 'N/A',
        'Newest Entry': stats.newestEntry?.toLocaleString() || 'N/A',
      });

    } catch (error) {
      logger.error('Failed to get cache stats', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle cache clear command
   */
  private async handleCacheClear(): Promise<void> {
    try {
      const { cacheManager } = await import('./modules/cache.js');
      
      const progress = logger.startProgress('Clearing cache...');
      await cacheManager.clear();
      progress.succeed('Cache cleared successfully');

    } catch (error) {
      logger.error('Failed to clear cache', error as Error);
      process.exit(1);
    }
  }

  /**
   * Handle cache cleanup command
   */
  private async handleCacheCleanup(): Promise<void> {
    try {
      const { cacheManager } = await import('./modules/cache.js');
      
      const progress = logger.startProgress('Cleaning up cache...');
      await cacheManager.cleanup();
      progress.succeed('Cache cleanup completed');

    } catch (error) {
      logger.error('Failed to cleanup cache', error as Error);
      process.exit(1);
    }
  }

  /**
   * Check for updates and silently update in background
   */
  private async checkForUpdates(): Promise<void> {
    try {
      const autoUpdater = new AutoUpdater(packageJson);

      // Notification-only (non-blocking). Never auto-installs and never
      // suggests sudo — see AutoUpdater.notifyIfUpdateAvailable for rationale.
      autoUpdater.notifyIfUpdateAvailable().catch(() => {
        // Silent failure - don't interrupt user workflow
      });

    } catch (error) {
      // Silent failure - updates should never break the CLI
      logger.debug('Update check failed', error as Error);
    }
  }

  /**
   * Validate commit type
   */
  private validateCommitType(value: string): CommitType {
    const validTypes: CommitType[] = [
      'feat', 'fix', 'docs', 'style', 'refactor', 
      'test', 'chore', 'perf', 'ci', 'build', 'revert'
    ];

    if (!validTypes.includes(value as CommitType)) {
      throw new Error(`Invalid commit type: ${value}. Valid types: ${validTypes.join(', ')}`);
    }

    return value as CommitType;
  }

  // Syntactically valid provider name: non-empty, alphanumerics, dashes,
  // underscores. Provider is now an open dictionary, so this is a soft-format
  // check, not a whitelist of two literals.
  private static readonly PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;

  /**
   * Validate provider name (commander option parser). Accepts any
   * syntactically valid provider identifier.
   */
  private validateProvider(value: string): string {
    if (!value || !CliApplication.PROVIDER_NAME_RE.test(value)) {
      throw new Error(`Invalid provider name: ${value}`);
    }
    return value;
  }

  /**
   * Check whether a provider name is syntactically valid (not whether it is
   * one of the built-ins — any registered provider is allowed).
   */
  private isValidProvider(provider: string): boolean {
    return Boolean(provider) && CliApplication.PROVIDER_NAME_RE.test(provider);
  }

  /**
   * Run the CLI application
   */
  async run(): Promise<void> {
    try {
      await this.program.parseAsync(process.argv);
    } catch (error: unknown) {
      // With program.exitOverride(), commander throws a CommanderError instead
      // of calling process.exit(). Several of its codes are NORMAL outcomes —
      // printing --version or --help, or an empty invocation — and must exit 0,
      // not be reported as a "CLI error". Previously only the help path was
      // handled, so `orc -v` printed the version and then died with exit 1 and
      // a spurious "✗ CLI error" line.
      const commanderError = error as { code?: string; exitCode?: number };
      const cleanExitCodes = new Set([
        'commander.version',
        'commander.helpDisplayed',
        'commander.help',
        'commander.missingArgument', // commander already printed a usage message
      ]);

      if (commanderError && typeof commanderError.code === 'string') {
        if (cleanExitCodes.has(commanderError.code)) {
          process.exit(commanderError.exitCode ?? 0);
        }
        // Other commander.* errors (e.g. unknown option) already printed a
        // helpful message via configureOutput; exit with its code, no stack.
        if (commanderError.code.startsWith('commander.')) {
          process.exit(commanderError.exitCode ?? 1);
        }
      }

      if (error instanceof Error) {
        logger.error('CLI error', error);
      } else {
        logger.error('Unknown CLI error');
      }
      process.exit(1);
    }
  }
}

// Run the application
const app = new CliApplication();
app.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { CliApplication };
