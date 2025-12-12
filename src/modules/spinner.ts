/**
 * Beautiful animated spinner with rotating phrases
 */

import chalk from 'chalk';
import { getRandomThinkingPhrase } from '../data/thinking-phrases.js';

// Spinner frames with different styles
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BRAIN_FRAMES = ['🧠', '💭', '💡', '✨', '⚡', '🔮', '🎯', '🚀'];
const DOT_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

// Color schemes for different moods
const COLOR_SCHEMES = {
  cyan: chalk.cyan,
  magenta: chalk.magenta,
  yellow: chalk.yellow,
  blue: chalk.blue,
  green: chalk.green,
  red: chalk.red,
};

type ColorScheme = keyof typeof COLOR_SCHEMES;

interface SpinnerOptions {
  text?: string;
  color?: ColorScheme;
  showPhrase?: boolean;
  phraseInterval?: number; // ms between phrase changes
  style?: 'dots' | 'line' | 'brain';
}

export class AnimatedSpinner {
  private intervalId?: NodeJS.Timeout;
  private frameIndex = 0;
  private currentPhrase: string;
  private phraseChangeCounter = 0;
  private text: string;
  private color: ColorScheme;
  private showPhrase: boolean;
  private phraseInterval: number;
  private frames: string[];
  private startTime: number;

  constructor(options: SpinnerOptions = {}) {
    this.text = options.text || 'Processing';
    this.color = options.color || 'cyan';
    this.showPhrase = options.showPhrase ?? true;
    this.phraseInterval = options.phraseInterval || 3000; // Change phrase every 3 seconds
    this.currentPhrase = getRandomThinkingPhrase();
    this.startTime = Date.now();

    // Select frames based on style
    switch (options.style) {
      case 'brain':
        this.frames = BRAIN_FRAMES;
        break;
      case 'dots':
        this.frames = DOT_FRAMES;
        break;
      case 'line':
      default:
        this.frames = SPINNER_FRAMES;
        break;
    }
  }

  /**
   * Start the spinner animation
   */
  start(): void {
    if (this.intervalId) {
      return; // Already running
    }

    // Hide cursor
    process.stdout.write('\x1B[?25l');

    this.render();

    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.phraseChangeCounter++;

      // Change phrase periodically
      if (this.phraseChangeCounter * 80 >= this.phraseInterval) {
        this.currentPhrase = getRandomThinkingPhrase();
        this.phraseChangeCounter = 0;
      }

      this.render();
    }, 80); // ~12.5 FPS
  }

  /**
   * Update spinner text
   */
  update(text: string): void {
    this.text = text;
    this.render();
  }

  /**
   * Stop the spinner with success
   */
  succeed(text?: string): void {
    this.stop('✓', text, 'green');
  }

  /**
   * Stop the spinner with error
   */
  fail(text?: string): void {
    this.stop('✖', text, 'red');
  }

  /**
   * Stop the spinner with warning
   */
  warn(text?: string): void {
    this.stop('⚠', text, 'yellow');
  }

  /**
   * Stop the spinner with info
   */
  info(text?: string): void {
    this.stop('ℹ', text, 'blue');
  }

  /**
   * Stop the spinner
   */
  private stop(symbol: string, text?: string, color?: ColorScheme): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Clear line and show final message
    this.clearLine();

    const finalText = text || this.text;
    const finalColor = color || this.color;
    const colorFn = COLOR_SCHEMES[finalColor];

    const elapsed = this.formatElapsed();

    if (this.showPhrase) {
      console.log(colorFn(`${symbol} ${finalText}`) + chalk.gray(` ${elapsed}`));
    } else {
      console.log(colorFn(`${symbol} ${finalText}`));
    }

    // Show cursor
    process.stdout.write('\x1B[?25h');
  }

  /**
   * Render current frame
   */
  private render(): void {
    const frame = this.frames[this.frameIndex] || '';
    const colorFn = COLOR_SCHEMES[this.color];

    this.clearLine();

    if (this.showPhrase) {
      // Show main text + colorful phrase
      const phraseColor = this.getRandomColor();
      process.stdout.write(
        colorFn(`${frame} ${this.text}`) +
          chalk.gray(' · ') +
          phraseColor(this.currentPhrase)
      );
    } else {
      process.stdout.write(colorFn(`${frame} ${this.text}`));
    }
  }

  /**
   * Clear current line
   */
  private clearLine(): void {
    if (process.stdout.clearLine && process.stdout.cursorTo) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    } else {
      // Fallback for environments without clearLine support
      process.stdout.write('\r\x1b[K');
    }
  }

  /**
   * Get a random color for phrases
   */
  private getRandomColor(): typeof chalk {
    const colors = [chalk.cyan, chalk.magenta, chalk.yellow, chalk.blue, chalk.green];
    return colors[Math.floor(Math.random() * colors.length)] || chalk.white;
  }

  /**
   * Format elapsed time
   */
  private formatElapsed(): string {
    const elapsed = Date.now() - this.startTime;
    if (elapsed < 1000) {
      return `${elapsed}ms`;
    } else {
      return `${(elapsed / 1000).toFixed(1)}s`;
    }
  }
}

/**
 * Create a new animated spinner
 */
export function createSpinner(options?: SpinnerOptions): AnimatedSpinner {
  return new AnimatedSpinner(options);
}

/**
 * Quick helper for AI thinking spinner
 */
export function createAIThinkingSpinner(text: string = 'AI is thinking'): AnimatedSpinner {
  return new AnimatedSpinner({
    text,
    color: 'cyan',
    showPhrase: true,
    style: 'line',
  });
}

/**
 * Quick helper for processing spinner (no phrases)
 */
export function createProcessingSpinner(text: string = 'Processing'): AnimatedSpinner {
  return new AnimatedSpinner({
    text,
    color: 'blue',
    showPhrase: false,
    style: 'dots',
  });
}
