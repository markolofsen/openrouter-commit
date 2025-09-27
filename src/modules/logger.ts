import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export interface LoggerOptions {
  verbose?: boolean;
  silent?: boolean;
  prefix?: string;
}

export class Logger {
  private readonly options: Required<LoggerOptions>;

  constructor(options: LoggerOptions = {}) {
    this.options = {
      verbose: options.verbose ?? false,
      silent: options.silent ?? false,
      prefix: options.prefix ?? 'orc',
    };
  }

  /**
   * Log debug information (only in verbose mode)
   */
  debug(message: string, data?: unknown): void {
    if (!this.options.verbose || this.options.silent) return;
    
    const formattedMessage = this.formatMessage('debug', message);
    console.log(formattedMessage);
    
    if (data !== undefined) {
      console.log(chalk.gray(JSON.stringify(data, null, 2)));
    }
  }

  /**
   * Log general information
   */
  info(message: string): void {
    if (this.options.silent) return;
    
    const formattedMessage = this.formatMessage('info', message);
    console.log(formattedMessage);
  }

  /**
   * Log warning messages
   */
  warn(message: string): void {
    if (this.options.silent) return;
    
    const formattedMessage = this.formatMessage('warn', message);
    console.warn(formattedMessage);
  }

  /**
   * Log error messages
   */
  error(message: string, error?: Error): void {
    const formattedMessage = this.formatMessage('error', message);
    console.error(formattedMessage);
    
    if (error) {
      // Special handling for common errors
      if (error.message.includes('maxBuffer length exceeded')) {
        console.error(chalk.yellow('💡 Tip: Your repository has very large changes. This has been automatically handled.'));
        console.error(chalk.yellow('   If the issue persists, try staging fewer files at once.'));
      } else if (error.message.includes('ENOENT')) {
        console.error(chalk.yellow('💡 Tip: Make sure you are in a git repository and git is installed.'));
      } else if (error.message.includes('not a git repository')) {
        console.error(chalk.yellow('💡 Tip: Initialize a git repository with: git init'));
      }
      
      if (this.options.verbose) {
        console.error(chalk.red('Error details:'));
        console.error(chalk.red(error.stack || error.message));
      } else {
        // Show just the error message in non-verbose mode
        console.error(chalk.gray(`Error: ${error.message}`));
      }
    }
  }

  /**
   * Log success messages
   */
  success(message: string): void {
    if (this.options.silent) return;
    
    const formattedMessage = this.formatMessage('success', message);
    console.log(formattedMessage);
  }

  /**
   * Start a progress indicator
   */
  startProgress(message: string): ProgressIndicator {
    if (this.options.silent) {
      return new ProgressIndicator(message, true);
    }
    
    return new ProgressIndicator(message, false);
  }

  /**
   * Log a table of data
   */
  table(data: Record<string, string | number | boolean>): void {
    if (this.options.silent) return;
    
    const maxKeyLength = Math.max(...Object.keys(data).map(key => key.length));
    
    Object.entries(data).forEach(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      const coloredKey = chalk.cyan(paddedKey);
      const coloredValue = typeof value === 'boolean' 
        ? (value ? chalk.green('✓') : chalk.red('✗'))
        : chalk.white(String(value));
      
      console.log(`${coloredKey}: ${coloredValue}`);
    });
  }

  /**
   * Log a warning with helpful tips
   */
  tip(message: string, tip: string): void {
    if (this.options.silent) return;
    
    this.warn(message);
    console.log(chalk.yellow(`💡 Tip: ${tip}`));
  }

  /**
   * Log repository statistics
   */
  repoStats(stats: { files: number; lines: number; size: string }): void {
    if (this.options.silent) return;
    
    console.log(chalk.blue('📊 Repository Analysis:'));
    console.log(`   Files changed: ${chalk.cyan(stats.files)}`);
    console.log(`   Lines changed: ${chalk.cyan(stats.lines)}`);
    console.log(`   Total size: ${chalk.cyan(stats.size)}`);
  }

  /**
   * Create a new logger with modified options
   */
  withOptions(options: Partial<LoggerOptions>): Logger {
    return new Logger({
      ...this.options,
      ...options,
    });
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = this.formatPrefix();
    const levelIcon = this.getLevelIcon(level);
    const coloredMessage = this.colorizeMessage(level, message);
    
    if (this.options.verbose) {
      return `${chalk.gray(timestamp)} ${prefix} ${levelIcon} ${coloredMessage}`;
    }
    
    return `${prefix} ${levelIcon} ${coloredMessage}`;
  }

  private formatPrefix(): string {
    return chalk.blue(`[${this.options.prefix}]`);
  }

  private getLevelIcon(level: LogLevel): string {
    const icons = {
      debug: chalk.gray('⚡'),
      info: chalk.blue('ℹ'),
      warn: chalk.yellow('⚠'),
      error: chalk.red('✗'),
      success: chalk.green('✓'),
    };
    
    return icons[level];
  }

  private colorizeMessage(level: LogLevel, message: string): string {
    const colors = {
      debug: chalk.gray,
      info: chalk.white,
      warn: chalk.yellow,
      error: chalk.red,
      success: chalk.green,
    };
    
    return colors[level](message);
  }
}

export class ProgressIndicator {
  private interval?: NodeJS.Timeout | undefined;
  private timeoutId?: NodeJS.Timeout | undefined;
  private frame = 0;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private startTime: number;
  private readonly minDuration = 500; // Wait before showing spinner
  private readonly maxDuration = 30000; // 30 second timeout
  private isActive = false;

  constructor(
    private readonly message: string,
    private readonly silent: boolean
  ) {
    this.startTime = Date.now();
    if (!this.silent) {
      // Show immediate status without spinner for fast operations
      process.stdout.write(`⏳ ${this.message}`);
      
      // Show spinner only if operation takes longer than minDuration
      this.timeoutId = setTimeout(() => {
        if (!this.isActive) {
          this.start();
        }
      }, this.minDuration);

      // Auto-timeout after maxDuration
      setTimeout(() => {
        if (this.interval) {
          this.fail('Operation timed out');
        }
      }, this.maxDuration);
    }
  }

  private start(): void {
    if (this.interval || this.isActive) return;
    
    this.isActive = true;
    process.stdout.write('\r\x1b[K'); // Clear current line
    process.stdout.write(`${chalk.cyan(this.frames[0])} ${this.message}`);
    
    this.interval = setInterval(() => {
      process.stdout.write('\r\x1b[K');
      this.frame = (this.frame + 1) % this.frames.length;
      process.stdout.write(`${chalk.cyan(this.frames[this.frame])} ${this.message}`);
    }, 200); // Even slower for elegance
  }

  stop(finalMessage?: string): void {
    this.cleanup();
    
    if (!this.silent) {
      process.stdout.write('\r\x1b[K'); // Clear current line
      if (finalMessage) {
        console.log(finalMessage);
      }
    }
  }

  succeed(message?: string): void {
    const duration = Date.now() - this.startTime;
    const durationText = duration > 1000 ? ` (${(duration / 1000).toFixed(1)}s)` : '';
    const finalMessage = message || this.message;
    this.stop(`${chalk.green('✓')} ${finalMessage}${chalk.gray(durationText)}`);
  }

  fail(message?: string): void {
    const finalMessage = message || `${this.message} failed`;
    this.stop(`${chalk.red('✗')} ${finalMessage}`);
  }

  private cleanup(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    this.isActive = false;
  }

  update(message: string): void {
    if (!this.silent && this.interval) {
      process.stdout.write('\r\x1b[K'); // Clear current line
      process.stdout.write(`${chalk.cyan(this.frames[this.frame])} ${message}`);
    }
  }
}

// Default logger instance
export const logger = new Logger();
