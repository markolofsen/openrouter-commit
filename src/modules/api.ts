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
  initializeProvider(provider: string, config: Config): void {
    this.config = config; // Store config for later use
    const providerConfig = config.providers[provider];

    if (!providerConfig?.apiKey) {
      throw new ApiError(`API key not configured for ${provider}`);
    }

    const apiKey = providerConfig.apiKey;

    // Build auth header from provider config. Default behaviour is the classic
    // `Authorization: Bearer <key>`. Custom providers may instead send the key
    // raw in a different header (e.g. cmdop_router's `X-API-Key`).
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'orcommit/1.0.0',
    };

    const authHeader = providerConfig.authHeader || 'Authorization';
    if (authHeader.toLowerCase() === 'authorization') {
      const scheme = providerConfig.authScheme ?? 'Bearer';
      headers[authHeader] = scheme ? `${scheme} ${apiKey}` : apiKey;
    } else {
      // Non-Authorization header → send the raw key (scheme is ignored).
      headers[authHeader] = apiKey;
    }

    // OpenRouter-specific attribution headers (harmless elsewhere, but keep
    // them scoped to the openrouter provider as before).
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/markolofsen/openrouter-commit';
      headers['X-Title'] = 'OpenRouter Commit CLI';
    }

    const client = axios.create({
      baseURL: providerConfig.baseUrl,
      timeout: providerConfig.timeout || 60000,
      headers,
    });

    // Configure retry logic
    axiosRetry(client, {
      retries: RETRY_CONFIG.MAX_RETRIES,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error: AxiosError) => {
        const status = error.response?.status;

        // Don't burn axios-level retries on a request that carried a
        // json_schema response_format to a non-OpenRouter provider: that error
        // is handled once, immediately, by the schema-fallback in makeRequest
        // (retry without response_format). Retrying the same rejected payload
        // 3× with exponential backoff first just wastes ~tens of seconds.
        if (
          !this.isOpenRouter(provider) &&
          status !== undefined &&
          [400, 422, 500, 502].includes(status) &&
          this.requestHadResponseFormat(error)
        ) {
          return false;
        }

        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               status === 429 ||
               (status !== undefined && status >= 500);
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
    provider: string
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
    baseRequest: { provider: string; model: string; maxTokens: number; temperature: number; systemPrompt: string; responseFormat?: Record<string, unknown> },
    provider: string
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
          responseFormat: baseRequest.responseFormat,
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
  async testConnection(provider: string): Promise<boolean> {
    try {
      const client = this.clients.get(provider);
      if (!client) {
        throw new ApiError(`Client not initialized for ${provider}`);
      }

      // Prefer the provider's configured model; otherwise fall back to a safe
      // default by provider name (custom providers without a configured model
      // use the generic gpt-3.5-turbo id).
      const configuredModel = this.config?.providers[provider]?.model;
      const fallbackModel = provider === 'openrouter' ? 'openai/gpt-3.5-turbo' : 'gpt-3.5-turbo';

      const testRequest: ApiRequest = {
        provider,
        model: configuredModel || fallbackModel,
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
    provider: string,
    retryCount: number = 0
  ): Promise<ApiResponse> {
    const endpoint = '/chat/completions';
    const maxRetries = 5; // Increased for overload resilience

    const payload: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      stream: request.stream ?? false,
    };

    // Constrained decoding when a structured schema is requested.
    if (request.responseFormat) {
      payload.response_format = request.responseFormat;

      // `provider` and `plugins` are OpenRouter-specific extensions. Other
      // OpenAI-compatible endpoints reject unknown top-level fields (cmdop's
      // router returns HTTP 422 "Extra inputs are not permitted"), so only send
      // them to OpenRouter. Everyone else gets a clean OpenAI-shaped payload
      // with just `response_format`.
      if (this.isOpenRouter(provider)) {
        // Route ONLY to providers/models that actually honor the schema. Without
        // this OpenRouter may silently pick a model that ignores json_schema, the
        // model returns free text or broken JSON, and downstream parsing degrades
        // to "commit the raw response" — which is how a bare `{` ends up as the
        // commit message. require_parameters makes the request fail loudly instead.
        payload.provider = { require_parameters: true };

        // Server-side repair of imperfect/truncated JSON (missing brace, trailing
        // comma, markdown fences). Non-streaming only; harmless if unsupported.
        payload.plugins = [{ id: 'response-healing' }];
      }
    }

    const config: AxiosRequestConfig = {
      timeout: 60000,
    };

    try {
      const response = await client.post(endpoint, payload, config);
      return this.parseResponse(response.data, provider);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        throw error;
      }

      // Graceful schema fallback: some OpenAI-compatible endpoints accept the
      // request shape but choke on json_schema response_format (cmdop's router
      // currently 502s on it). If we sent a response_format to a non-OpenRouter
      // provider and got a client/server error back, retry ONCE in plain-text
      // mode. We lose constrained decoding (downstream parsing handles the
      // free-text JSON), but the commit still gets generated instead of failing.
      const schemaUnsupported =
        request.responseFormat &&
        !this.isOpenRouter(provider) &&
        retryCount === 0 &&
        [400, 422, 500, 502].includes(error.statusCode ?? 0);

      if (schemaUnsupported) {
        logger.warn(
          `${provider} rejected structured output (${error.statusCode}); ` +
            `retrying without response_format`
        );
        const { responseFormat: _omit, ...textRequest } = request;
        return this.makeRequest(client, textRequest, provider, retryCount + 1);
      }

      const msg = error.message.toLowerCase();

      // Type 1: Parse errors (empty response) - quick retries, 3 attempts max
      const isParseError =
        error.message.includes('no choices found') ||
        error.message.includes('no message content');

      // Type 2: Overload errors (server busy) - longer retries, 5 attempts max
      const isOverloadError =
        msg.includes('overloaded') ||
        msg.includes('temporarily unavailable') ||
        msg.includes('service unavailable') ||
        msg.includes('too many requests') ||
        msg.includes('rate limit') ||
        msg.includes('capacity') ||
        msg.includes('try again');

      if (isParseError && retryCount < 3) {
        // Quick exponential backoff: 1s, 2s, 4s
        const delay = 1000 * Math.pow(2, retryCount);
        logger.warn(`Retry ${retryCount + 1}/3 for ${provider}: ${error.message} (${delay / 1000}s)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(client, request, provider, retryCount + 1);
      }

      if (isOverloadError && retryCount < maxRetries) {
        // Linear backoff with cap: 2s, 4s, 6s, 8s, 10s
        const delay = Math.min(2000 + retryCount * 2000, 10000);
        logger.warn(`Retry ${retryCount + 1}/${maxRetries} for ${provider}: ${error.message} (${delay / 1000}s)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeRequest(client, request, provider, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Whether a provider is OpenRouter, so we know if its proprietary payload
   * extensions (`provider`, `plugins`) are safe to send. Detected by baseUrl
   * (any provider name pointed at openrouter.ai counts), falling back to the
   * conventional `openrouter` provider id.
   */
  /**
   * Whether the failed request's body carried a `response_format`. Used by the
   * retry condition to recognise schema-rejection failures (axios stores the
   * serialized request body on error.config.data).
   */
  private requestHadResponseFormat(error: AxiosError): boolean {
    const data = error.config?.data;
    if (typeof data !== 'string') return false;
    return data.includes('"response_format"');
  }

  private isOpenRouter(provider: string): boolean {
    const baseUrl = this.config?.providers[provider]?.baseUrl ?? '';
    // Match the openrouter.ai host whether preceded by a scheme separator
    // (https://openrouter.ai), a subdomain dot (.openrouter.ai), or nothing.
    return /(^|[/.@])openrouter\.ai\b/i.test(baseUrl) || provider === 'openrouter';
  }

  private parseResponse(data: any, provider: string): ApiResponse {
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
      const detail = this.extractErrorDetail(data);
      if (detail) {
        message += `: ${detail}`;
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

  /**
   * Pull a human-readable detail out of an error response body. Providers are
   * wildly inconsistent here, so we handle the common shapes instead of only
   * OpenAI's `{ error: { message } }`:
   *   - OpenAI/OpenRouter:  { error: { message } }  or  { error: "string" }
   *   - FastAPI/Pydantic:   { detail: [ { loc, msg, type }, ... ] }  (e.g. cmdop)
   *   - FastAPI simple:     { detail: "string" }
   *   - misc:               { message: "string" }
   *   - raw string body
   * Returns undefined when nothing useful can be extracted, so the caller keeps
   * the bare `provider API error (status)`.
   */
  private extractErrorDetail(data: unknown): string | undefined {
    if (data == null) return undefined;

    if (typeof data === 'string') {
      const trimmed = data.trim();
      return trimmed.length ? trimmed : undefined;
    }

    if (typeof data !== 'object') return undefined;
    const obj = data as Record<string, any>;

    // OpenAI / OpenRouter style.
    if (obj.error) {
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.error.message === 'string') return obj.error.message;
    }

    // FastAPI / Pydantic validation errors (what cmdop's router returns).
    if (obj.detail !== undefined) {
      if (typeof obj.detail === 'string') return obj.detail;
      if (Array.isArray(obj.detail)) {
        const parts = obj.detail
          .map((d: any) => {
            if (typeof d === 'string') return d;
            const loc = Array.isArray(d?.loc) ? d.loc.join('.') : undefined;
            const msg = d?.msg ?? d?.message;
            return loc && msg ? `${loc}: ${msg}` : msg || undefined;
          })
          .filter(Boolean);
        if (parts.length) return parts.join('; ');
      }
    }

    if (typeof obj.message === 'string') return obj.message;

    return undefined;
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
