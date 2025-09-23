// Core configuration types
export interface Config {
  readonly providers: {
    readonly openrouter: ProviderConfig;
    readonly openai: ProviderConfig;
  };
  readonly preferences: UserPreferences;
  readonly version: string;
}

export interface ProviderConfig {
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeout?: number;
}

export interface UserPreferences {
  readonly defaultProvider: 'openrouter' | 'openai';
  readonly maxTokens: number;
  readonly temperature: number;
  readonly autoConfirm: boolean;
  readonly language: string;
  readonly commitFormat: 'conventional' | 'simple';
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
  readonly provider: 'openrouter' | 'openai';
  readonly model: string;
  readonly messages: ApiMessage[];
  readonly maxTokens: number;
  readonly temperature: number;
  readonly stream?: boolean;
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
  readonly provider?: 'openrouter' | 'openai';
  // Extended formatting options
  readonly emoji?: boolean;
  readonly oneLine?: boolean;
  readonly descriptionLength?: number;
  readonly maxFiles?: number;
  readonly ignoreGenerated?: boolean;
  readonly ignoreWhitespace?: boolean;
  // Caching options
  readonly noCache?: boolean;
  readonly clearCache?: boolean;
  // Git push options
  readonly push?: boolean;
  readonly autoPush?: boolean;
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

// Constants
export const DEFAULT_CONFIG: Readonly<Config> = {
  providers: {
    openrouter: {
      baseUrl: 'https://openrouter.ai/api/v1',
      timeout: 60000,
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      timeout: 60000,
    },
  },
  preferences: {
    defaultProvider: 'openrouter',
    maxTokens: 500,
    temperature: 0.6,
    autoConfirm: false,
    language: 'en',
    commitFormat: 'conventional',
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
