import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger.js';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hash: string;
  model: string;
  provider: string;
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum cache size in MB
  enabled?: boolean;
}

export class CacheManager {
  private readonly cacheDir: string;
  private readonly options: Required<CacheOptions>;
  private memoryCache: Map<string, CacheEntry<string>> = new Map();

  constructor(options: CacheOptions = {}) {
    this.cacheDir = join(homedir(), '.cache', 'orcommit');
    this.options = {
      ttl: options.ttl ?? 24 * 60 * 60 * 1000, // 24 hours
      maxSize: options.maxSize ?? 50, // 50 MB
      enabled: options.enabled ?? true,
    };
  }

  /**
   * Generate cache key from diff content and request parameters
   */
  private generateCacheKey(content: string, model: string, provider: string, temperature: number): string {
    const hash = createHash('sha256')
      .update(content)
      .update(model)
      .update(provider)
      .update(temperature.toString())
      .digest('hex');
    
    return hash.slice(0, 16); // Use first 16 chars for shorter filenames
  }

  /**
   * Get cached commit message if available and valid
   */
  async get(
    content: string,
    model: string,
    provider: string,
    temperature: number
  ): Promise<string | null> {
    if (!this.options.enabled) {
      return null;
    }

    const key = this.generateCacheKey(content, model, provider, temperature);
    
    try {
      // Check memory cache first
      const memoryEntry = this.memoryCache.get(key);
      if (memoryEntry && this.isEntryValid(memoryEntry)) {
        logger.debug('Cache hit (memory)', { key });
        return memoryEntry.data;
      }

      // Check disk cache
      const diskEntry = await this.getFromDisk(key);
      if (diskEntry && this.isEntryValid(diskEntry)) {
        // Promote to memory cache
        this.memoryCache.set(key, diskEntry);
        logger.debug('Cache hit (disk)', { key });
        return diskEntry.data;
      }

      logger.debug('Cache miss', { key });
      return null;

    } catch (error) {
      logger.warn(`Cache read error: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Store commit message in cache
   */
  async set(
    content: string,
    model: string,
    provider: string,
    temperature: number,
    commitMessage: string
  ): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    const key = this.generateCacheKey(content, model, provider, temperature);
    const contentHash = createHash('sha256').update(content).digest('hex');
    
    const entry: CacheEntry<string> = {
      data: commitMessage,
      timestamp: Date.now(),
      hash: contentHash,
      model,
      provider,
    };

    try {
      // Store in memory cache
      this.memoryCache.set(key, entry);
      
      // Limit memory cache size
      await this.evictMemoryCache();

      // Store in disk cache
      await this.saveToDisk(key, entry);
      
      logger.debug('Cache stored', { key, provider, model });

    } catch (error) {
      logger.warn(`Cache write error: ${(error as Error).message}`);
    }
  }

  /**
   * Check if cache entry is still valid
   */
  private isEntryValid(entry: CacheEntry<string>): boolean {
    const now = Date.now();
    const age = now - entry.timestamp;
    
    return age < this.options.ttl;
  }

  /**
   * Get entry from disk cache
   */
  private async getFromDisk(key: string): Promise<CacheEntry<string> | null> {
    try {
      await this.ensureCacheDir();
      
      const filePath = join(this.cacheDir, `${key}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      
      return JSON.parse(data) as CacheEntry<string>;
      
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.debug('Disk cache read error', error as Error);
      }
      return null;
    }
  }

  /**
   * Save entry to disk cache
   */
  private async saveToDisk(key: string, entry: CacheEntry<string>): Promise<void> {
    try {
      await this.ensureCacheDir();
      
      const filePath = join(this.cacheDir, `${key}.json`);
      const data = JSON.stringify(entry, null, 2);
      
      await fs.writeFile(filePath, data, 'utf-8');
      
    } catch (error) {
      logger.debug('Disk cache write error', error as Error);
    }
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.access(this.cacheDir);
    } catch {
      await fs.mkdir(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Evict old entries from memory cache to keep it under size limit
   */
  private async evictMemoryCache(): Promise<void> {
    const maxEntries = 100; // Keep reasonable number in memory
    
    if (this.memoryCache.size <= maxEntries) {
      return;
    }

    // Convert to array and sort by timestamp (oldest first)
    const entries = Array.from(this.memoryCache.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    // Remove oldest entries
    const toRemove = entries.slice(0, entries.length - maxEntries);
    
    for (const [key] of toRemove) {
      this.memoryCache.delete(key);
    }

    logger.debug(`Evicted ${toRemove.length} entries from memory cache`);
  }

  /**
   * Clean up expired entries from disk cache
   */
  async cleanup(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    try {
      await this.ensureCacheDir();
      
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      let cleanedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = join(this.cacheDir, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(data) as CacheEntry<string>;
          
          const age = now - entry.timestamp;
          if (age > this.options.ttl) {
            await fs.unlink(filePath);
            cleanedCount++;
          }
          
        } catch (error) {
          // If we can't parse the file, delete it
          try {
            await fs.unlink(join(this.cacheDir, file));
            cleanedCount++;
          } catch {
            // Ignore deletion errors
          }
        }
      }

      if (cleanedCount > 0) {
        logger.debug(`Cleaned up ${cleanedCount} expired cache entries`);
      }

    } catch (error) {
      logger.warn(`Cache cleanup error: ${(error as Error).message}`);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    memoryEntries: number;
    diskEntries: number;
    totalSize: string;
    oldestEntry?: Date;
    newestEntry?: Date;
  }> {
    const memoryEntries = this.memoryCache.size;
    let diskEntries = 0;
    let totalSize = 0;
    let oldestTimestamp = Number.MAX_SAFE_INTEGER;
    let newestTimestamp = 0;

    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = join(this.cacheDir, file);
          const stats = await fs.stat(filePath);
          const data = await fs.readFile(filePath, 'utf-8');
          const entry = JSON.parse(data) as CacheEntry<string>;
          
          diskEntries++;
          totalSize += stats.size;
          
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp;
          }
          if (entry.timestamp > newestTimestamp) {
            newestTimestamp = entry.timestamp;
          }
          
        } catch {
          // Skip invalid files
        }
      }
      
    } catch (error) {
      logger.warn(`Error getting cache stats: ${(error as Error).message}`);
    }

    return {
      memoryEntries,
      diskEntries,
      totalSize: this.formatBytes(totalSize),
      oldestEntry: oldestTimestamp !== Number.MAX_SAFE_INTEGER ? new Date(oldestTimestamp) : undefined,
      newestEntry: newestTimestamp > 0 ? new Date(newestTimestamp) : undefined,
    };
  }

  /**
   * Clear all cache (memory and disk)
   */
  async clear(): Promise<void> {
    // Clear memory cache
    this.memoryCache.clear();

    // Clear disk cache
    try {
      await this.ensureCacheDir();
      const files = await fs.readdir(this.cacheDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.unlink(join(this.cacheDir, file));
        }
      }
      
      logger.debug('Cache cleared');
      
    } catch (error) {
      logger.warn(`Error clearing cache: ${(error as Error).message}`);
    }
  }

  /**
   * Format bytes as human readable
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }
}

// Singleton instance
export const cacheManager = new CacheManager();
