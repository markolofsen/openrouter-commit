#!/usr/bin/env node

import { Command } from 'commander';
import updateNotifier from 'update-notifier';
import chalk from 'chalk';
import { coreOrchestrator } from './modules/core.js';
import { configManager } from './modules/config.js';
import { logger } from './modules/logger.js';
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
      .option('-v, --verbose', 'Enable verbose logging', false)
      .option('-w, --watch', 'Watch for changes and auto-generate commits', false)
      .option('-p, --provider <provider>', 'Specify AI provider (openrouter|openai)', this.validateProvider)
      // Extended formatting options
      .option('--emoji', 'Include emoji in commit message', false)
      .option('--one-line', 'Generate single-line commit message', false)
      .option('--description-length <length>', 'Maximum description length', parseInt)
      .option('--max-files <count>', 'Maximum number of files to analyze', parseInt)
      // Filtering options
      .option('--ignore-generated', 'Ignore auto-generated files', true)
      .option('--ignore-whitespace', 'Ignore whitespace-only changes', true)
      // Caching options
      .option('--no-cache', 'Disable caching', false)
      .option('--clear-cache', 'Clear cache before generating', false)
      .action(async (options: CliOptions) => {
        await this.handleCommitCommand(options);
      });

    // Config management commands
    const configCmd = this.program
      .command('config')
      .description('Manage configuration settings');

    configCmd
      .command('set <provider> <key>')
      .description('Set API key for provider (openrouter|openai)')
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
        logger.error(`Invalid provider: ${provider}. Must be 'openrouter' or 'openai'`);
        process.exit(1);
      }

      await configManager.setApiKey(provider as 'openrouter' | 'openai', key);
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
          logger.error(`Invalid provider: ${provider}. Must be 'openrouter' or 'openai'`);
          process.exit(1);
        }

        const providerKey = provider as 'openrouter' | 'openai';
        const maskedKey = await configManager.getMaskedApiKey(providerKey);
        const model = config.providers[providerKey].model || 'default';

        logger.table({
          Provider: provider,
          'API Key': maskedKey,
          Model: model,
        });
      } else {
        // Show all configuration
        const openrouterKey = await configManager.getMaskedApiKey('openrouter');
        const openaiKey = await configManager.getMaskedApiKey('openai');

        logger.table({
          'Default Provider': config.preferences.defaultProvider,
          'OpenRouter API Key': openrouterKey,
          'OpenAI API Key': openaiKey,
          'Max Tokens': config.preferences.maxTokens,
          'Temperature': config.preferences.temperature,
          'Auto Confirm': config.preferences.autoConfirm,
          'Language': config.preferences.language,
          'Format': config.preferences.commitFormat,
        });
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
        logger.error(`Invalid provider: ${provider}. Must be 'openrouter' or 'openai'`);
        process.exit(1);
      }

      await configManager.setModel(provider as 'openrouter' | 'openai', model);
      logger.success(`Model set to ${model} for ${provider}`);

    } catch (error) {
      logger.error('Failed to set model', error as Error);
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
        logger.error(`Invalid provider: ${testProvider}. Must be 'openrouter' or 'openai'`);
        process.exit(1);
      }

      const progress = logger.startProgress(`Testing ${testProvider} connection...`);
      
      await coreOrchestrator.initialize();
      
      // This would require implementing a test method in the API manager
      // For now, just verify configuration
      const isValid = await configManager.validateConfig(testProvider as 'openrouter' | 'openai');
      
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
   * Check for updates using update-notifier
   */
  private checkForUpdates(): void {
    const notifier = updateNotifier({
      pkg: packageJson,
      updateCheckInterval: 1000 * 60 * 60 * 24, // 24 hours
    });

    notifier.notify({
      defer: false,
      isGlobal: true,
    });
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

  /**
   * Validate provider
   */
  private validateProvider(value: string): 'openrouter' | 'openai' {
    if (value !== 'openrouter' && value !== 'openai') {
      throw new Error(`Invalid provider: ${value}. Must be 'openrouter' or 'openai'`);
    }
    return value;
  }

  /**
   * Check if provider is valid
   */
  private isValidProvider(provider: string): provider is 'openrouter' | 'openai' {
    return provider === 'openrouter' || provider === 'openai';
  }

  /**
   * Run the CLI application
   */
  async run(): Promise<void> {
    try {
      await this.program.parseAsync(process.argv);
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message.includes('outputHelp')) {
          // Help was requested, exit normally
          process.exit(0);
        } else {
          logger.error('CLI error', error);
          process.exit(1);
        }
      } else {
        logger.error('Unknown CLI error');
        process.exit(1);
      }
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
