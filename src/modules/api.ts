import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import PQueue from 'p-queue';
import { 
  ApiRequest, 
  ApiResponse, 
  ApiError, 
  NetworkError, 
  ProcessingResult, 
  RETRY_CONFIG, 
  CHUNK_LIMITS,
  Config
} from '../types/index.js';
import { logger } from './logger.js';

export class ApiManager {
  private readonly queue: PQueue;
  private readonly clients: Map<string, AxiosInstance> = new Map();
  private config?: Config;

  constructor(concurrency: number = CHUNK_LIMITS.MAX_CONCURRENT_REQUESTS) {
    this.queue = new PQueue({
      concurrency,
      interval: 1000, // 1 second
      intervalCap: concurrency * 2, // Allow burst capacity
    });

    // Handle graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Initialize API client for a provider
   */
  initializeProvider(provider: 'openrouter' | 'openai', config: Config): void {
    this.config = config; // Store config for later use
    const providerConfig = config.providers[provider];

    if (!providerConfig.apiKey) {
      throw new ApiError(`API key not configured for ${provider}`);
    }

    const client = axios.create({
      baseURL: providerConfig.baseUrl,
      timeout: providerConfig.timeout || 60000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerConfig.apiKey}`,
        'User-Agent': 'orcommit/1.0.0',
        ...(provider === 'openrouter' && {
          'HTTP-Referer': 'https://github.com/markolofsen/openrouter-commit',
          'X-Title': 'OpenRouter Commit CLI',
        }),
      },
    });

    // Configure retry logic
    axiosRetry(client, {
      retries: RETRY_CONFIG.MAX_RETRIES,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error: AxiosError) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.response?.status === 429 ||
               (error.response?.status !== undefined && error.response.status >= 500);
      },
      shouldResetTimeout: true,
      onRetry: (retryCount, error) => {
        logger.warn(`Retry attempt ${retryCount} for ${provider}: ${error.message}`);
      },
    });

    // Add response interceptor for better error handling
    client.interceptors.response.use(
      response => response,
      error => this.handleApiError(error, provider)
    );

    this.clients.set(provider, client);
    logger.debug(`Initialized ${provider} client`, { baseUrl: providerConfig.baseUrl });
  }

  /**
   * Generate commit message using the specified provider
   */
  async generateCommitMessage(
    request: ApiRequest,
    provider: 'openrouter' | 'openai'
  ): Promise<ProcessingResult<string>> {
    return this.queue.add(async (): Promise<ProcessingResult<string>> => {
      try {
        const client = this.clients.get(provider);
        if (!client) {
          throw new ApiError(`Client not initialized for ${provider}`);
        }

        logger.debug(`Sending request to ${provider}`, { 
          model: request.model,
          messageCount: request.messages.length,
          maxTokens: request.maxTokens 
        });

        const response = await this.makeRequest(client, request, provider);
        const commitMessage = this.extractCommitMessage(response, provider);

        logger.debug(`Received response from ${provider}`, { 
          messageLength: commitMessage.length,
          usage: response.usage 
        });

        return {
          success: true,
          data: commitMessage,
        };

      } catch (error) {
        logger.error(`API request failed for ${provider}`, error as Error);

        // Preserve the original ApiError or NetworkError
        const apiError = error instanceof ApiError || error instanceof NetworkError
          ? error
          : new ApiError(
              error instanceof Error ? error.message : 'Unknown API error',
              undefined,
              error instanceof Error ? error : undefined
            );

        if (apiError instanceof ApiError && apiError.isRetryable) {
          return {
            success: false,
            error: apiError,
            retryAfter: this.calculateRetryDelay(apiError.statusCode),
          };
        }

        return {
          success: false,
          error: apiError,
        };
      }
    }) as Promise<ProcessingResult<string>>;
  }

  /**
   * Process multiple chunks in parallel
   */
  async processChunks(
    chunks: string[],
    baseRequest: { provider: 'openrouter' | 'openai'; model: string; maxTokens: number; temperature: number; systemPrompt: string },
    provider: 'openrouter' | 'openai'
  ): Promise<ProcessingResult<string[]>> {
    try {
      const promises = chunks.map(chunk => 
        this.generateCommitMessage({
          provider: baseRequest.provider,
          model: baseRequest.model,
          maxTokens: baseRequest.maxTokens,
          temperature: baseRequest.temperature,
          messages: [
            { role: 'system', content: baseRequest.systemPrompt },
            { role: 'user', content: chunk }
          ],
        }, provider)
      );

      const results = await Promise.allSettled(promises);
      const successfulResults: string[] = [];
      const errors: ApiError[] = [];

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success && result.value.data) {
          successfulResults.push(result.value.data);
        } else if (result.status === 'fulfilled' && result.value.error) {
          errors.push(result.value.error instanceof ApiError ? result.value.error : new ApiError('Unknown error'));
        } else if (result.status === 'rejected') {
          errors.push(new ApiError('Promise rejected', undefined, result.reason as Error));
        }
      }

      if (successfulResults.length === 0) {
        return {
          success: false,
          error: new ApiError(`All chunk processing failed. ${errors.length} errors occurred.`),
        };
      }

      return {
        success: true,
        data: successfulResults,
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? new ApiError(error.message, undefined, error) : 
               new ApiError('Unknown chunk processing error'),
      };
    }
  }

  /**
   * Test API connection
   */
  async testConnection(provider: 'openrouter' | 'openai'): Promise<boolean> {
    try {
      const client = this.clients.get(provider);
      if (!client) {
        throw new ApiError(`Client not initialized for ${provider}`);
      }

      const testRequest: ApiRequest = {
        provider,
        model: provider === 'openrouter' ? 'openai/gpt-3.5-turbo' : 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'test' }],
        maxTokens: 10,
        temperature: 0.1,
      };

      const result = await this.generateCommitMessage(testRequest, provider);
      return result.success;

    } catch (error) {
      logger.error(`Connection test failed for ${provider}`, error as Error);
      return false;
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { pending: number; size: number; isPaused: boolean } {
    return {
      pending: this.queue.pending,
      size: this.queue.size,
      isPaused: this.queue.isPaused,
    };
  }

  /**
   * Clear the queue and wait for ongoing requests
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down API manager...');
    this.queue.clear();
    await this.queue.onIdle();
    logger.info('API manager shutdown complete');
  }

  // Private methods

  private async makeRequest(
    client: AxiosInstance,
    request: ApiRequest,
    provider: 'openrouter' | 'openai',
    retryCount: number = 0
  ): Promise<ApiResponse> {
    const endpoint = '/chat/completions';
    const maxRetries = 3;

    const payload = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: request.stream ?? false,
    };

    const config: AxiosRequestConfig = {
      timeout: 60000,
    };

    try {
      const response = await client.post(endpoint, payload, config);
      return this.parseResponse(response.data, provider);
    } catch (error) {
      // Retry logic for missing choices or empty response
      const isRetryableError = error instanceof ApiError &&
        (error.message.includes('no choices found') ||
         error.message.includes('no message content'));

      if (isRetryableError && retryCount < maxRetries) {
        logger.warn(`Retry attempt ${retryCount + 1}/${maxRetries} for ${provider} due to invalid response`);

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));

        return this.makeRequest(client, request, provider, retryCount + 1);
      }

      throw error;
    }
  }

  private parseResponse(data: any, provider: 'openrouter' | 'openai'): ApiResponse {
    // Check for API errors first
    if (data.error) {
      const errorMsg = typeof data.error === 'string'
        ? data.error
        : (data.error.message || 'Unknown API error');
      throw new ApiError(`${provider} API error: ${errorMsg}`);
    }

    // Try to extract message from different response formats
    let message: string | undefined;
    let choice: any;
    let finishReason = 'unknown';

    // Format 1: Standard OpenAI/OpenRouter format with choices array
    if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
      choice = data.choices[0];
      message = choice.message?.content || choice.text;
      finishReason = choice.finish_reason || 'unknown';
    }
    // Format 2: Direct response format (some providers)
    else if (data.response || data.text || data.content) {
      message = data.response || data.text || data.content;
      finishReason = data.finish_reason || 'complete';
    }
    // Format 3: Message directly in data
    else if (data.message) {
      message = typeof data.message === 'string' ? data.message : data.message.content;
      finishReason = data.finish_reason || 'complete';
    }

    // If still no message found, throw error
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      throw new ApiError(`Invalid response format from ${provider}: no choices found`);
    }

    return {
      message,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      } : undefined,
      model: data.model || 'unknown',
      finishReason,
    };
  }

  private extractCommitMessage(response: ApiResponse, provider: string): string {
    let message = response.message.trim();

    // Normalize line endings and whitespace
    message = message.replace(/\r\n/g, '\n'); // Normalize line endings
    message = message.replace(/\n{3,}/g, '\n\n'); // Limit consecutive newlines
    message = message.trim();

    // Remove common AI-generated prefixes (case insensitive)
    const prefixPatterns = [
      /^commit message:\s*/i,
      /^this is commit message:\s*/i,
      /^here is the commit message:\s*/i,
      /^the commit message is:\s*/i,
      /^suggested commit:\s*/i,
      /^commit:\s*/i,
    ];

    for (const pattern of prefixPatterns) {
      message = message.replace(pattern, '');
    }

    // Remove quotes around the message
    message = message.replace(/^["'](.+)["']$/, '$1');

    // Remove leading dashes and asterisks (markdown list markers)
    message = message.replace(/^[-*]\s+/, '');

    message = message.trim();

    // Ensure it's not empty
    if (!message || message.length < 3) {
      throw new ApiError(`Generated commit message too short from ${provider}: "${message}"`);
    }

    // Apply max length from config (if set) - silent truncate as fallback
    // AI should already respect the limit, this is just a safety net
    const maxLength = this.config?.preferences.maxCommitLength;
    if (maxLength && maxLength > 0 && message.length > maxLength) {
      // Silent truncate - AI should have already generated proper length
      const lines = message.split('\n');
      const subject = lines[0] || '';
      if (subject.length > maxLength) {
        message = subject.substring(0, maxLength - 3) + '...';
      } else if (message.length > maxLength) {
        message = message.substring(0, maxLength - 3) + '...';
      }
      // Only log in debug mode
      logger.debug(`Commit message auto-trimmed to ${maxLength} chars (AI should respect this limit)`);
    }

    return message;
  }

  private handleApiError(error: AxiosError, provider: string): Promise<never> {
    if (error.response) {
      // HTTP error response
      const status = error.response.status;
      const data = error.response.data as any;
      
      let message = `${provider} API error (${status})`;
      if (data?.error?.message) {
        message += `: ${data.error.message}`;
      } else if (data?.message) {
        message += `: ${data.message}`;
      }

      throw new ApiError(message, status, error);
    } else if (error.request) {
      // Network error
      throw new NetworkError(`Network error communicating with ${provider}: ${error.message}`, error);
    } else {
      // Other error
      throw new ApiError(`Request setup error for ${provider}: ${error.message}`, undefined, error);
    }
  }

  private calculateRetryDelay(statusCode?: number): number {
    if (statusCode === 429) {
      return RETRY_CONFIG.BASE_DELAY * 2; // Rate limited, wait longer
    }
    return RETRY_CONFIG.BASE_DELAY;
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  }
}

// Singleton instance
export const apiManager = new ApiManager();
