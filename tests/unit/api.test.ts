import axios, { AxiosError } from 'axios';
import { ApiManager } from '../../src/modules/api.js';
import { ApiRequest, Config, DEFAULT_CONFIG } from '../../src/types/index.js';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
  })),
}));

// Mock axios-retry
jest.mock('axios-retry', () => jest.fn());

// Mock p-queue
jest.mock('p-queue', () => {
  return jest.fn().mockImplementation(() => ({
    add: jest.fn((fn) => fn()),
    pending: 0,
    size: 0,
    isPaused: false,
    clear: jest.fn(),
    onIdle: jest.fn(() => Promise.resolve()),
  }));
});

const mockAxios = axios as jest.Mocked<typeof axios>;

describe('ApiManager', () => {
  let apiManager: ApiManager;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      interceptors: {
        response: {
          use: jest.fn(),
        },
      },
    };
    mockAxios.create.mockReturnValue(mockAxiosInstance);
    
    apiManager = new ApiManager();
    jest.clearAllMocks();
  });

  const mockConfig: Config = {
    ...DEFAULT_CONFIG,
    providers: {
      openrouter: {
        apiKey: 'test-openrouter-key',
        baseUrl: 'https://openrouter.ai/api/v1',
        timeout: 60000,
      },
      openai: {
        apiKey: 'test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        timeout: 60000,
      },
    },
  };

  describe('initializeProvider', () => {
    it('should initialize OpenRouter provider correctly', () => {
      apiManager.initializeProvider('openrouter', mockConfig);

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: 60000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-openrouter-key',
          'User-Agent': 'openrouter-commit/1.0.0',
          'HTTP-Referer': 'https://github.com/markolofsen/openrouter-commit',
          'X-Title': 'OpenRouter Commit CLI',
        },
      });
    });

    it('should initialize OpenAI provider correctly', () => {
      apiManager.initializeProvider('openai', mockConfig);

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://api.openai.com/v1',
        timeout: 60000,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-openai-key',
          'User-Agent': 'openrouter-commit/1.0.0',
        },
      });
    });

    it('should throw error for missing API key', () => {
      const configWithoutKey = {
        ...mockConfig,
        providers: {
          ...mockConfig.providers,
          openrouter: { ...mockConfig.providers.openrouter, apiKey: undefined },
        },
      };

      expect(() => {
        apiManager.initializeProvider('openrouter', configWithoutKey);
      }).toThrow('API key not configured for openrouter');
    });
  });

  describe('generateCommitMessage', () => {
    const mockRequest: ApiRequest = {
      provider: 'openrouter',
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a commit message generator' },
        { role: 'user', content: 'Generate commit for: +console.log("hello")' },
      ],
      maxTokens: 100,
      temperature: 0.6,
    };

    beforeEach(() => {
      apiManager.initializeProvider('openrouter', mockConfig);
    });

    it('should generate commit message successfully', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'feat: add console log for debugging' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 10,
          total_tokens: 60,
        },
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('feat: add console log for debugging');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: mockRequest.messages,
          max_tokens: 100,
          temperature: 0.6,
          stream: false,
        },
        { timeout: 60000 }
      );
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('API request failed') as AxiosError;
      error.response = {
        status: 500,
        data: { error: { message: 'Internal server error' } },
      } as any;

      mockAxiosInstance.post.mockRejectedValue(error);

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('openrouter API error (500)');
    });

    it('should handle rate limiting (429) as retryable', async () => {
      const error = new Error('Rate limited') as AxiosError;
      error.response = {
        status: 429,
        data: { error: { message: 'Rate limit exceeded' } },
      } as any;

      mockAxiosInstance.post.mockRejectedValue(error);

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.isRetryable).toBe(true);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should handle network errors as retryable', async () => {
      const error = new Error('Network error') as AxiosError;
      error.request = {}; // Indicates network error

      mockAxiosInstance.post.mockRejectedValue(error);

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Network error');
    });

    it('should throw error for client not initialized', async () => {
      const uninitializedManager = new ApiManager();

      const result = await uninitializedManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Client not initialized');
    });

    it('should clean commit message from prefixes', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'Commit message: "feat: add new feature"' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('feat: add new feature');
    });

    it('should clean "this is commit message:" prefix', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'This is commit message: fix: resolve authentication bug' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('fix: resolve authentication bug');
    });

    it('should clean "here is the commit message:" prefix', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'Here is the commit message: refactor: improve code structure' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('refactor: improve code structure');
    });

    it('should clean "the commit message is:" prefix', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'The commit message is: docs: update README' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('docs: update README');
    });

    it('should clean "suggested commit:" prefix', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'Suggested commit: chore: update dependencies' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('chore: update dependencies');
    });

    it('should clean leading dash and asterisk', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: '- feat: add new API endpoint' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toBe('feat: add new API endpoint');
    });

    it('should truncate very long commit messages', async () => {
      const longMessage = 'feat: ' + 'a'.repeat(250); // 255 chars total
      const mockResponse = {
        choices: [
          {
            message: { content: longMessage },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBeLessThanOrEqual(200);
      expect(result.data).toMatch(/\.\.\.$/); // Should end with ...
    });

    it('should reject very short commit messages', async () => {
      const mockResponse = {
        choices: [
          {
            message: { content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.generateCommitMessage(mockRequest, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('too short');
    });
  });

  describe('processChunks', () => {
    const chunks = ['chunk1', 'chunk2', 'chunk3'];
    const baseRequest = {
      provider: 'openrouter' as const,
      model: 'gpt-3.5-turbo',
      maxTokens: 100,
      temperature: 0.6,
      systemPrompt: 'Generate commit messages',
    };

    beforeEach(() => {
      apiManager.initializeProvider('openrouter', mockConfig);
    });

    it('should process multiple chunks successfully', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'feat: chunk change' }, finish_reason: 'stop' }],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.processChunks(chunks, baseRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.data?.every(msg => msg === 'feat: chunk change')).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures gracefully', async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({ 
          data: { 
            choices: [{ message: { content: 'success1' }, finish_reason: 'stop' }] 
          } 
        })
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({ 
          data: { 
            choices: [{ message: { content: 'success3' }, finish_reason: 'stop' }] 
          } 
        });

      const result = await apiManager.processChunks(chunks, baseRequest, 'openrouter');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2); // Only successful ones
      expect(result.data).toContain('success1');
      expect(result.data).toContain('success3');
    });

    it('should fail when all chunks fail', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('API Error'));

      const result = await apiManager.processChunks(chunks, baseRequest, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('All chunk processing failed');
    });
  });

  describe('testConnection', () => {
    beforeEach(() => {
      apiManager.initializeProvider('openrouter', mockConfig);
    });

    it('should return true for successful connection test', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'test response' }, finish_reason: 'stop' }],
        model: 'gpt-3.5-turbo',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await apiManager.testConnection('openrouter');
      expect(result).toBe(true);
    });

    it('should return false for failed connection test', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Connection failed'));

      const result = await apiManager.testConnection('openrouter');
      expect(result).toBe(false);
    });

    it('should throw error for uninitialized client', async () => {
      const uninitializedManager = new ApiManager();

      const result = await uninitializedManager.testConnection('openrouter');
      expect(result).toBe(false);
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status', () => {
      const status = apiManager.getQueueStatus();

      expect(status).toHaveProperty('pending');
      expect(status).toHaveProperty('size');
      expect(status).toHaveProperty('isPaused');
      expect(typeof status.pending).toBe('number');
      expect(typeof status.size).toBe('number');
      expect(typeof status.isPaused).toBe('boolean');
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await expect(apiManager.shutdown()).resolves.not.toThrow();
    });
  });

  describe('error handling edge cases', () => {
    beforeEach(() => {
      apiManager.initializeProvider('openrouter', mockConfig);
    });

    it('should handle malformed API responses', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { invalid: 'response' } });

      const result = await apiManager.generateCommitMessage({
        provider: 'openrouter',
        model: 'gpt-3.5-turbo',
        messages: [],
        maxTokens: 100,
        temperature: 0.6,
      }, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Invalid response format');
    });

    it('should handle empty choices array', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { choices: [] } });

      const result = await apiManager.generateCommitMessage({
        provider: 'openrouter',
        model: 'gpt-3.5-turbo',
        messages: [],
        maxTokens: 100,
        temperature: 0.6,
      }, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('no choices found');
    });

    it('should handle missing message content', async () => {
      mockAxiosInstance.post.mockResolvedValue({ 
        data: { 
          choices: [{ finish_reason: 'stop' }] // Missing message
        } 
      });

      const result = await apiManager.generateCommitMessage({
        provider: 'openrouter',
        model: 'gpt-3.5-turbo',
        messages: [],
        maxTokens: 100,
        temperature: 0.6,
      }, 'openrouter');

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('no message content');
    });
  });
});
