import { encoding_for_model, Tiktoken } from 'tiktoken';
import { logger } from './logger.js';

export interface TokenizerOptions {
  model: string;
  maxTokens: number;
  reservedTokens?: number; // For system prompt, response, etc.
}

export class TokenManager {
  private encoders: Map<string, Tiktoken> = new Map();
  private readonly defaultMaxTokens = 4000; // Conservative default

  /**
   * Get or create tokenizer for specific model
   */
  private getEncoder(model: string): Tiktoken {
    if (this.encoders.has(model)) {
      return this.encoders.get(model)!;
    }

    try {
      // Map provider models to tiktoken models
      const tiktokenModel = this.mapToTiktokenModel(model);
      const encoder = encoding_for_model(tiktokenModel);
      this.encoders.set(model, encoder);
      return encoder;
    } catch (error) {
      logger.warn(`Failed to load tokenizer for ${model}, using default`);
      // Fallback to gpt-3.5-turbo tokenizer
      const encoder = encoding_for_model('gpt-3.5-turbo');
      this.encoders.set(model, encoder);
      return encoder;
    }
  }

  /**
   * Count tokens in text for specific model
   */
  countTokens(text: string, model: string): number {
    try {
      const encoder = this.getEncoder(model);
      return encoder.encode(text).length;
    } catch (error) {
      logger.warn(`Token counting failed for ${model}, using character estimation`);
      // Fallback: rough estimation (1 token ≈ 4 characters for English)
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Split text into chunks based on token limits
   */
  splitIntoTokenChunks(
    text: string,
    options: TokenizerOptions
  ): string[] {
    const { model, maxTokens, reservedTokens = 500 } = options;
    const effectiveMaxTokens = maxTokens - reservedTokens;
    
    // If text fits in one chunk, return as-is
    const totalTokens = this.countTokens(text, model);
    if (totalTokens <= effectiveMaxTokens) {
      return [text];
    }

    logger.debug(`Splitting ${totalTokens} tokens into chunks of ${effectiveMaxTokens}`);

    const chunks: string[] = [];
    const lines = text.split('\n');
    let currentChunk: string[] = [];
    let currentTokens = 0;

    for (const line of lines) {
      const lineTokens = this.countTokens(line + '\n', model);
      
      // If single line exceeds limit, split it further
      if (lineTokens > effectiveMaxTokens) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.join('\n'));
          currentChunk = [];
          currentTokens = 0;
        }
        
        // Split long line by sentences or words
        const splitLine = this.splitLongLine(line, effectiveMaxTokens, model);
        chunks.push(...splitLine);
        continue;
      }

      // Check if adding this line would exceed limit
      if (currentTokens + lineTokens > effectiveMaxTokens && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [line];
        currentTokens = lineTokens;
      } else {
        currentChunk.push(line);
        currentTokens += lineTokens;
      }
    }

    // Add remaining chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    logger.debug(`Split into ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * Split a single long line into smaller parts
   */
  private splitLongLine(line: string, maxTokens: number, model: string): string[] {
    const chunks: string[] = [];
    
    // Try splitting by sentences first
    const sentences = line.split(/[.!?]+/).filter(s => s.trim());
    if (sentences.length > 1) {
      let currentChunk = '';
      for (const sentence of sentences) {
        const testChunk = currentChunk + sentence + '.';
        if (this.countTokens(testChunk, model) <= maxTokens) {
          currentChunk = testChunk;
        } else {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = sentence + '.';
        }
      }
      if (currentChunk) chunks.push(currentChunk.trim());
      return chunks;
    }

    // Fallback: split by words
    const words = line.split(/\s+/);
    let currentChunk = '';
    
    for (const word of words) {
      const testChunk = currentChunk ? `${currentChunk} ${word}` : word;
      if (this.countTokens(testChunk, model) <= maxTokens) {
        currentChunk = testChunk;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = word;
      }
    }
    
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  /**
   * Calculate optimal chunk size for model
   */
  getOptimalChunkSize(model: string): number {
    const modelLimits: Record<string, number> = {
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo-16k': 16384,
      'gpt-3.5-turbo': 4096,
      'claude-3-haiku': 200000,
      'claude-3-sonnet': 200000,
      'claude-3-opus': 200000,
      'llama-2-70b': 4096,
      'mixtral-8x7b': 32768,
    };

    // Try to find exact match or partial match
    // Check longer model names first to avoid early partial matches
    const sortedKeys = Object.keys(modelLimits).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (model.includes(key) || model.toLowerCase().includes(key.toLowerCase())) {
        return Math.floor(modelLimits[key]! * 0.7); // Use 70% of limit for safety
      }
    }

    // Default conservative limit
    return this.defaultMaxTokens;
  }

  /**
   * Map provider-specific model names to tiktoken models
   */
  private mapToTiktokenModel(model: string): "gpt-4" | "gpt-3.5-turbo" | "text-davinci-003" | "text-davinci-002" | "text-davinci-001" | "text-curie-001" | "text-babbage-001" | "text-ada-001" | "davinci" | "curie" | "babbage" | "ada" | "code-davinci-002" | "code-davinci-001" | "code-cushman-002" | "code-cushman-001" | "davinci-codex" | "cushman-codex" | "text-davinci-edit-001" | "code-davinci-edit-001" | "text-embedding-ada-002" | "text-similarity-davinci-001" | "text-similarity-curie-001" | "text-similarity-babbage-001" | "text-similarity-ada-001" | "text-search-davinci-doc-001" | "text-search-curie-doc-001" | "text-search-babbage-doc-001" | "text-search-ada-doc-001" | "code-search-babbage-code-001" | "code-search-ada-code-001" | "gpt2" {
    const modelMap: Record<string, "gpt-4" | "gpt-3.5-turbo" | "text-davinci-003" | "text-davinci-002" | "text-davinci-001" | "text-curie-001" | "text-babbage-001" | "text-ada-001" | "davinci" | "curie" | "babbage" | "ada" | "code-davinci-002" | "code-davinci-001" | "code-cushman-002" | "code-cushman-001" | "davinci-codex" | "cushman-codex" | "text-davinci-edit-001" | "code-davinci-edit-001" | "text-embedding-ada-002" | "text-similarity-davinci-001" | "text-similarity-curie-001" | "text-similarity-babbage-001" | "text-similarity-ada-001" | "text-search-davinci-doc-001" | "text-search-curie-doc-001" | "text-search-babbage-doc-001" | "text-search-ada-doc-001" | "code-search-babbage-code-001" | "code-search-ada-code-001" | "gpt2"> = {
      // OpenAI models
      'gpt-4': 'gpt-4',
      'gpt-4-turbo': 'gpt-4',
      'gpt-4-turbo-preview': 'gpt-4',
      'gpt-3.5-turbo': 'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k': 'gpt-3.5-turbo',
      
      // OpenRouter models mapped to closest equivalent
      'openai/gpt-4': 'gpt-4',
      'openai/gpt-4-turbo': 'gpt-4',
      'openai/gpt-3.5-turbo': 'gpt-3.5-turbo',
      'anthropic/claude-3-haiku': 'gpt-3.5-turbo', // No Claude tokenizer in tiktoken
      'anthropic/claude-3-sonnet': 'gpt-4',
      'anthropic/claude-3-opus': 'gpt-4',
      'meta-llama/llama-2-70b': 'gpt-3.5-turbo',
      'mistralai/mixtral-8x7b': 'gpt-4',
    };

    return modelMap[model.toLowerCase()] || 'gpt-3.5-turbo';
  }

  /**
   * Estimate tokens needed for system prompt and response
   */
  estimateSystemTokens(systemPrompt: string, model: string): number {
    const systemTokens = this.countTokens(systemPrompt, model);
    const responseTokens = 200; // Conservative estimate for commit message
    const overhead = 50; // API overhead
    
    return systemTokens + responseTokens + overhead;
  }

  /**
   * Clean up encoders on shutdown
   */
  cleanup(): void {
    for (const encoder of this.encoders.values()) {
      encoder.free();
    }
    this.encoders.clear();
  }
}

// Singleton instance
export const tokenManager = new TokenManager();
