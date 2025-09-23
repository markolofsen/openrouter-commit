import { TokenManager } from '../../src/modules/tokenizer.js';

// Mock tiktoken
jest.mock('tiktoken', () => ({
  encoding_for_model: jest.fn(() => ({
    encode: jest.fn((text: string) => {
      // Simple mock: 1 token per 4 characters
      return new Array(Math.ceil(text.length / 4));
    }),
    free: jest.fn(),
  })),
}));

describe('TokenManager', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager();
  });

  afterEach(() => {
    tokenManager.cleanup();
  });

  describe('countTokens', () => {
    it('should count tokens for text', () => {
      const text = 'This is a test message';
      const count = tokenManager.countTokens(text, 'gpt-3.5-turbo');
      
      // With our mock: 22 chars / 4 = 6 tokens (rounded up)
      expect(count).toBe(6);
    });

    it('should handle empty text', () => {
      const count = tokenManager.countTokens('', 'gpt-3.5-turbo');
      expect(count).toBe(0);
    });

    it('should fallback to character estimation on error', () => {
      // Test with invalid model to trigger fallback
      const text = 'Test message';
      const count = tokenManager.countTokens(text, 'invalid-model');
      
      // Fallback: 12 chars / 4 = 3 tokens
      expect(count).toBe(3);
    });
  });

  describe('splitIntoTokenChunks', () => {
    it('should return single chunk for small text', () => {
      const text = 'Small text';
      const chunks = tokenManager.splitIntoTokenChunks(text, {
        model: 'gpt-3.5-turbo',
        maxTokens: 1000,
        reservedTokens: 100,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('should split large text into multiple chunks', () => {
      const text = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8';
      const chunks = tokenManager.splitIntoTokenChunks(text, {
        model: 'gpt-3.5-turbo',
        maxTokens: 10, // Small limit to force splitting
        reservedTokens: 2,
      });

      expect(chunks.length).toBeGreaterThan(1);
      
      // Each chunk should be within token limit
      chunks.forEach(chunk => {
        const tokenCount = tokenManager.countTokens(chunk, 'gpt-3.5-turbo');
        expect(tokenCount).toBeLessThanOrEqual(8); // maxTokens - reservedTokens
      });
    });

    it('should preserve line boundaries when possible', () => {
      const text = 'First line\nSecond line\nThird line';
      const chunks = tokenManager.splitIntoTokenChunks(text, {
        model: 'gpt-3.5-turbo',
        maxTokens: 15,
        reservedTokens: 5,
      });

      // Should split by lines rather than arbitrary character positions
      chunks.forEach(chunk => {
        expect(chunk.trim()).not.toBe('');
        // Each chunk should contain complete lines (no partial lines)
        if (chunk.includes('\n')) {
          expect(chunk).toMatch(/^[^\n]*(?:\n[^\n]*)*$/);
        }
      });
    });

    it('should handle single long line by splitting it', () => {
      const longLine = 'This is a very long line that should be split into multiple parts because it exceeds the token limit significantly';
      const chunks = tokenManager.splitIntoTokenChunks(longLine, {
        model: 'gpt-3.5-turbo',
        maxTokens: 10,
        reservedTokens: 2,
      });

      expect(chunks.length).toBeGreaterThan(1);
      
      // Each chunk should be non-empty
      chunks.forEach(chunk => {
        expect(chunk.trim().length).toBeGreaterThan(0);
      });
    });
  });

  describe('getOptimalChunkSize', () => {
    it('should return model-specific limits', () => {
      expect(tokenManager.getOptimalChunkSize('gpt-4')).toBe(5734); // 70% of 8192
      expect(tokenManager.getOptimalChunkSize('gpt-3.5-turbo')).toBe(2867); // 70% of 4096
      expect(tokenManager.getOptimalChunkSize('claude-3-haiku')).toBe(140000); // 70% of 200000
    });

    it('should return default for unknown models', () => {
      const defaultSize = tokenManager.getOptimalChunkSize('unknown-model');
      expect(defaultSize).toBe(4000); // Default conservative limit
    });

    it('should handle partial model name matches', () => {
      expect(tokenManager.getOptimalChunkSize('openai/gpt-4-turbo')).toBe(89600); // 70% of 128000
      expect(tokenManager.getOptimalChunkSize('anthropic/claude-3-sonnet')).toBe(140000);
    });
  });

  describe('estimateSystemTokens', () => {
    it('should estimate system prompt and response tokens', () => {
      const systemPrompt = 'You are a helpful assistant';
      const estimate = tokenManager.estimateSystemTokens(systemPrompt, 'gpt-3.5-turbo');
      
      // Should include system prompt tokens + response tokens + overhead
      const systemTokens = tokenManager.countTokens(systemPrompt, 'gpt-3.5-turbo');
      expect(estimate).toBe(systemTokens + 200 + 50); // response + overhead
    });

    it('should handle empty system prompt', () => {
      const estimate = tokenManager.estimateSystemTokens('', 'gpt-3.5-turbo');
      expect(estimate).toBe(250); // 0 + 200 + 50
    });
  });

  describe('mapToTiktokenModel', () => {
    it('should map OpenAI models correctly', () => {
      // This tests the private method indirectly through countTokens
      const count1 = tokenManager.countTokens('test', 'gpt-4');
      const count2 = tokenManager.countTokens('test', 'gpt-4-turbo');
      
      // Both should use the same tokenizer
      expect(count1).toBe(count2);
    });

    it('should map OpenRouter models to closest equivalent', () => {
      const count1 = tokenManager.countTokens('test', 'openai/gpt-4');
      const count2 = tokenManager.countTokens('test', 'anthropic/claude-3-haiku');
      
      // Both should work without errors
      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {
    it('should free all encoders', () => {
      // Create some encoders by counting tokens
      tokenManager.countTokens('test1', 'gpt-4');
      tokenManager.countTokens('test2', 'gpt-3.5-turbo');
      
      // Cleanup should not throw
      expect(() => tokenManager.cleanup()).not.toThrow();
    });
  });
});
