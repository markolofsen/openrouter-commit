// Core configuration types
export interface Config {
  // Open dictionary of providers, keyed by an arbitrary provider name.
  // Built-ins are `openrouter` and `openai`, but users can register any
  // custom provider (e.g. `cmdop`) through the CLI.
  readonly providers: Record<string, ProviderConfig>;
  readonly preferences: UserPreferences;
  readonly version: string;
}

export interface ProviderConfig {
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeout?: number;
  /**
   * Name of the HTTP header the API key is sent in. Defaults to
   * `'Authorization'`. For providers that expect a raw key in a custom header
   * (e.g. cmdop_router uses `'X-API-Key'`), set this and the key is sent as-is
   * without any scheme prefix.
   */
  readonly authHeader?: string;
  /**
   * Scheme prefix placed before the key in the `Authorization` header.
   * Defaults to `'Bearer'`. Ignored when `authHeader` is not `'Authorization'`
   * (the key is then sent raw). Pass an empty string to send the raw key in
   * the Authorization header.
   */
  readonly authScheme?: string;
}

export interface UserPreferences {
  readonly defaultProvider: string;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly autoConfirm: boolean;
  readonly language: string;
  readonly commitFormat: 'conventional' | 'simple';
  readonly customPrompt?: string;
  readonly maxCommitLength?: number; // Maximum commit message length in characters (0 or undefined = unlimited)
}

// Git-related types
export interface GitDiff {
  readonly files: GitFile[];
  readonly totalLines: number;
  readonly totalSize: number;
}

export interface GitFile {
  readonly path: string;
  readonly status: GitFileStatus;
  readonly chunks: GitChunk[];
  readonly isBinary: boolean;
}

export type GitFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface GitChunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: GitLine[];
  readonly context: string;
}

export interface GitLine {
  readonly type: 'context' | 'added' | 'removed';
  readonly content: string;
  readonly lineNumber?: number;
}

// API types
export interface ApiRequest {
  readonly provider: string;
  readonly model: string;
  readonly messages: ApiMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  readonly stream?: boolean;
  /**
   * OpenAI/OpenRouter `response_format`. When set to a json_schema block, the
   * provider constrains decoding so the model cannot emit malformed JSON or
   * the wrong shape — far more reliable than prompting + regex extraction.
   */
  readonly responseFormat?: Record<string, unknown>;
}

export interface ApiMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ApiResponse {
  readonly message: string;
  readonly usage?: TokenUsage;
  readonly model: string;
  readonly finishReason: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

// CLI types
export interface CliOptions {
  readonly yes?: boolean;
  readonly scope?: string;
  readonly type?: CommitType;
  readonly breaking?: boolean;
  readonly dryRun?: boolean;
  readonly verbose?: boolean;
  readonly watch?: boolean;
  readonly provider?: string;
  // Extended formatting options
  readonly emoji?: boolean;
  readonly oneLine?: boolean;
  readonly descriptionLength?: number;
  readonly maxFiles?: number;
  readonly ignoreGenerated?: boolean;
  readonly ignoreWhitespace?: boolean;
  // Security options
  readonly secretScan?: boolean; // false = skip secret scanning
  // Caching options
  readonly noCache?: boolean;
  readonly clearCache?: boolean;
  // Git push options
  readonly push?: boolean;
  readonly autoPush?: boolean;
  // Custom prompt options
  readonly prompt?: string;
  readonly context?: string;
}

export type CommitType = 'feat' | 'fix' | 'docs' | 'style' | 'refactor' | 'test' | 'chore' | 'perf' | 'ci' | 'build' | 'revert';

// Error types
export abstract class BaseError extends Error {
  abstract readonly code: string;
  abstract readonly isRetryable: boolean;
  
  constructor(message: string, public override readonly cause?: Error) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConfigError extends BaseError {
  readonly code = 'CONFIG_ERROR';
  readonly isRetryable = false;
}

export class GitError extends BaseError {
  readonly code = 'GIT_ERROR';
  readonly isRetryable = false;
}

export class ApiError extends BaseError {
  readonly code = 'API_ERROR';
  readonly isRetryable: boolean;

  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: Error
  ) {
    super(message, cause);
    this.isRetryable = this.determineRetryability(statusCode);
  }

  private determineRetryability(statusCode?: number): boolean {
    if (!statusCode) return false;
    return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
  }
}

export class NetworkError extends BaseError {
  readonly code = 'NETWORK_ERROR';
  readonly isRetryable = true;
}

// Utility types
export interface ProcessingResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: BaseError;
  readonly retryAfter?: number;
}

export interface ChunkProcessingOptions {
  readonly maxChunkSize: number;
  readonly preserveContext: boolean;
  readonly maxConcurrency: number;
}

export interface FileSafetyAnalysis {
  readonly totalFiles: number;
  readonly largeFiles: number;
  readonly suspiciousPatterns: string[];
  readonly riskLevel: 'safe' | 'warning' | 'critical' | 'dangerous';
  readonly recommendations: string[];
}

// Constants
export const DEFAULT_CONFIG: Readonly<Config> = {
  // Open dictionary: only the two built-in providers ship by default. Users add
  // custom providers via the CLI, e.g.:
  //   orc config provider cmdop \
  //     --base-url https://router.cmdop.com/v1 \
  //     --key <key> --model @fast --auth-header X-API-Key
  // which produces an entry like:
  //   cmdop: { baseUrl: 'https://router.cmdop.com/v1', apiKey: '...',
  //            model: '@fast', authHeader: 'X-API-Key' }
  providers: {
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      // Gemini Flash Lite is cheap, fast, and honors strict json_schema
      // structured output — the right default for the constrained-decoding
      // commit envelope this tool relies on. Ship it in the config (not just as
      // a getModel() fallback) so `orc config get` shows the real default.
      model: 'google/gemini-2.5-flash-lite',
      timeout: 60000,
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      timeout: 60000,
    },
  },
  preferences: {
    defaultProvider: 'openrouter',
    // The model returns a JSON envelope ({codeAssessment, commitMessage}); 500
    // tokens truncates that for multi-file diffs, leaving unparseable JSON that
    // used to leak into the commit. 2000 comfortably fits assessment + a long
    // multi-line message. parseAIResponse also recovers from truncation now.
    maxTokens: 2000,
    // Low temperature keeps the message grounded in the actual diff and
    // reduces drift toward memorized, generic commit phrasings.
    temperature: 0.3,
    autoConfirm: false,
    language: 'en',
    commitFormat: 'conventional',
    maxCommitLength: 800, // Reasonable limit for multi-line commits
  },
  version: '1.0.0',
} as const;

export const CHUNK_LIMITS = {
  MAX_CHUNK_SIZE: 8000, // characters
  MAX_CHUNKS_PER_REQUEST: 10,
  MAX_CONCURRENT_REQUESTS: 3,
} as const;

export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY: 1000, // ms
  MAX_DELAY: 30000, // ms
  BACKOFF_FACTOR: 2,
} as const;

export const FILE_SAFETY_LIMITS = {
  // Warning threshold - show warning but allow to continue
  WARNING_FILE_COUNT: 50,
  // Critical threshold - require explicit confirmation
  CRITICAL_FILE_COUNT: 200,
  // Maximum allowed files without override
  MAX_FILE_COUNT: 1000,
  // Large file size threshold (in bytes)
  LARGE_FILE_SIZE: 1024 * 1024, // 1MB
} as const;
