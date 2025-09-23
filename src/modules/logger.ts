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
    
    if (error && this.options.verbose) {
      console.error(chalk.red('Error details:'));
      console.error(chalk.red(error.stack || error.message));
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
  private frame = 0;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(
    private readonly message: string,
    private readonly silent: boolean
  ) {
    if (!this.silent) {
      this.start();
    }
  }

  private start(): void {
    process.stdout.write(`${this.frames[0]} ${this.message}`);
    
    this.interval = setInterval(() => {
      process.stdout.write('\r\x1b[K'); // Clear current line
      this.frame = (this.frame + 1) % this.frames.length;
      process.stdout.write(`${chalk.cyan(this.frames[this.frame])} ${this.message}`);
    }, 100);
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    
    if (!this.silent) {
      process.stdout.write('\r\x1b[K'); // Clear current line
      if (finalMessage) {
        console.log(finalMessage);
      }
    }
  }

  succeed(message?: string): void {
    this.stop(message ? `${chalk.green('✓')} ${message}` : `${chalk.green('✓')} ${this.message}`);
  }

  fail(message?: string): void {
    this.stop(message ? `${chalk.red('✗')} ${message}` : `${chalk.red('✗')} ${this.message}`);
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
