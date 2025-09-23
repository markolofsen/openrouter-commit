/**
 * Utility functions for OpenRouter Commit
 */

/**
 * Truncate text to specified length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Sanitize commit message to ensure it's valid
 */
export function sanitizeCommitMessage(message: string): string {
  return message
    .trim()
    .replace(/\n+/g, ' ') // Replace newlines with spaces
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\x20-\x7E]/g, '') // Remove non-printable characters
    .trim();
}

/**
 * Calculate delay for exponential backoff
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelay: number = 1000,
  maxDelay: number = 30000,
  factor: number = 2
): number {
  const delay = baseDelay * Math.pow(factor, attempt - 1);
  return Math.min(delay, maxDelay);
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Debounce function calls
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | undefined;
  
  return (...args: Parameters<T>) => {
    const later = () => {
      timeout = undefined;
      func(...args);
    };
    
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Create a promise that resolves after specified delay
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate if a string is a valid commit type
 */
export function isValidCommitType(type: string): boolean {
  const validTypes = [
    'feat', 'fix', 'docs', 'style', 'refactor',
    'test', 'chore', 'perf', 'ci', 'build', 'revert'
  ];
  return validTypes.includes(type);
}

/**
 * Parse conventional commit message
 */
export interface ConventionalCommit {
  type: string;
  scope?: string;
  description: string;
  body?: string;
  footer?: string;
  breaking: boolean;
}

export function parseConventionalCommit(message: string): ConventionalCommit | null {
  // Simplified conventional commit parser
  const conventionalRegex = /^(\w+)(\(([^)]+)\))?(!)?\s*:\s*(.+)$/;
  const match = message.match(conventionalRegex);
  
  if (!match) {
    return null;
  }
  
  const [, type, , scope, breaking, description] = match;
  
  return {
    type: type || '',
    scope: scope || undefined,
    description: description || '',
    breaking: Boolean(breaking),
  };
}

/**
 * Format bytes as human readable
 */
export function humanFileSize(bytes: number, si = false, dp = 1): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

  return bytes.toFixed(dp) + ' ' + units[u];
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return Boolean(
    process.env.CI ||
    process.env.CONTINUOUS_INTEGRATION ||
    process.env.BUILD_NUMBER ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL
  );
}

/**
 * Get safe environment variable
 */
export function getEnvVar(name: string, defaultValue = ''): string {
  return process.env[name] || defaultValue;
}

/**
 * Mask sensitive information in strings
 */
export function maskSensitive(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars * 2) {
    return '*'.repeat(value.length);
  }
  
  const start = value.substring(0, visibleChars);
  const end = value.substring(value.length - visibleChars);
  const middle = '*'.repeat(Math.max(0, value.length - visibleChars * 2));
  
  return start + middle + end;
}
