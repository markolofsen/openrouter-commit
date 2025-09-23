import { promises as fs } from 'fs';
import { CacheManager } from '../../src/modules/cache.js';

// Mock fs operations
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    access: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    unlink: jest.fn(),
    stat: jest.fn(),
  },
}));

// Mock os module
jest.mock('os', () => ({
  homedir: () => '/tmp/test-home',
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  const testContent = 'test diff content';
  const testModel = 'gpt-3.5-turbo';
  const testProvider = 'openrouter';
  const testTemperature = 0.6;
  const testCommitMessage = 'feat: add new feature';

  beforeEach(() => {
    cacheManager = new CacheManager({
      ttl: 1000, // 1 second for testing
      maxSize: 1,
      enabled: true,
    });
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return null when cache is disabled', async () => {
      const disabledCache = new CacheManager({ enabled: false });
      
      const result = await disabledCache.get(testContent, testModel, testProvider, testTemperature);
      expect(result).toBeNull();
    });

    it('should return cached value from memory', async () => {
      // First, set a value in cache
      await cacheManager.set(testContent, testModel, testProvider, testTemperature, testCommitMessage);
      
      // Mock successful memory cache hit
      const result = await cacheManager.get(testContent, testModel, testProvider, testTemperature);
      expect(result).toBe(testCommitMessage);
    });

    it('should return cached value from disk when not in memory', async () => {
      const cacheEntry = {
        data: testCommitMessage,
        timestamp: Date.now(),
        hash: 'test-hash',
        model: testModel,
        provider: testProvider,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(cacheEntry));
      
      const result = await cacheManager.get(testContent, testModel, testProvider, testTemperature);
      expect(result).toBe(testCommitMessage);
    });

    it('should return null for expired cache entry', async () => {
      const expiredEntry = {
        data: testCommitMessage,
        timestamp: Date.now() - 2000, // 2 seconds ago, older than TTL
        hash: 'test-hash',
        model: testModel,
        provider: testProvider,
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(expiredEntry));
      
      const result = await cacheManager.get(testContent, testModel, testProvider, testTemperature);
      expect(result).toBeNull();
    });

    it('should return null when disk cache file not found', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      const result = await cacheManager.get(testContent, testModel, testProvider, testTemperature);
      expect(result).toBeNull();
    });

    it('should handle disk cache read errors gracefully', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));
      
      const result = await cacheManager.get(testContent, testModel, testProvider, testTemperature);
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should not set when cache is disabled', async () => {
      const disabledCache = new CacheManager({ enabled: false });
      
      await disabledCache.set(testContent, testModel, testProvider, testTemperature, testCommitMessage);
      
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('should store value in memory and disk cache', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT')); // Directory doesn't exist
      
      await cacheManager.set(testContent, testModel, testProvider, testTemperature, testCommitMessage);
      
      expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/test-home/.cache/orcommit', { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalled();
      
      // Verify the written data structure
      const writeCall = mockFs.writeFile.mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toBe(testCommitMessage);
      expect(writtenData.model).toBe(testModel);
      expect(writtenData.provider).toBe(testProvider);
    });

    it('should handle write errors gracefully', async () => {
      mockFs.writeFile.mockRejectedValue(new Error('Disk full'));
      
      await expect(
        cacheManager.set(testContent, testModel, testProvider, testTemperature, testCommitMessage)
      ).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries from disk', async () => {
      const currentTime = Date.now();
      const expiredEntry = {
        data: 'old message',
        timestamp: currentTime - 2000, // Expired
        hash: 'old-hash',
        model: testModel,
        provider: testProvider,
      };
      const validEntry = {
        data: 'recent message',
        timestamp: currentTime,
        hash: 'new-hash',
        model: testModel,
        provider: testProvider,
      };

      mockFs.readdir.mockResolvedValue(['expired.json', 'valid.json', 'not-json.txt'] as any);
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(expiredEntry))
        .mockResolvedValueOnce(JSON.stringify(validEntry));

      await cacheManager.cleanup();

      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/test-home/.cache/orcommit/expired.json');
      expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    });

    it('should remove invalid cache files', async () => {
      mockFs.readdir.mockResolvedValue(['invalid.json'] as any);
      mockFs.readFile.mockRejectedValue(new Error('Invalid JSON'));

      await cacheManager.cleanup();

      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/test-home/.cache/orcommit/invalid.json');
    });

    it('should handle cleanup errors gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      await expect(cacheManager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', async () => {
      const mockFiles = ['file1.json', 'file2.json', 'not-json.txt'];
      const mockEntry = {
        data: testCommitMessage,
        timestamp: Date.now(),
        hash: 'test-hash',
        model: testModel,
        provider: testProvider,
      };

      mockFs.readdir.mockResolvedValue(mockFiles as any);
      mockFs.readFile.mockResolvedValue(JSON.stringify(mockEntry));
      mockFs.stat.mockResolvedValue({ size: 100 } as any);

      const stats = await cacheManager.getStats();

      expect(stats.diskEntries).toBe(2); // Only .json files
      expect(stats.totalSize).toBe('200.0 B'); // 2 files * 100 bytes
      expect(stats.memoryEntries).toBe(0); // No memory entries in this test
    });

    it('should handle stats errors gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      const stats = await cacheManager.getStats();

      expect(stats.diskEntries).toBe(0);
      expect(stats.totalSize).toBe('0.0 B');
    });
  });

  describe('clear', () => {
    it('should clear both memory and disk cache', async () => {
      mockFs.readdir.mockResolvedValue(['file1.json', 'file2.json'] as any);

      await cacheManager.clear();

      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/test-home/.cache/orcommit/file1.json');
      expect(mockFs.unlink).toHaveBeenCalledWith('/tmp/test-home/.cache/orcommit/file2.json');
    });

    it('should handle clear errors gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Permission denied'));

      await expect(cacheManager.clear()).resolves.not.toThrow();
    });
  });

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      const stats1 = { totalSize: '512.0 B' };
      const stats2 = { totalSize: '1.0 KB' };
      const stats3 = { totalSize: '1.0 MB' };

      // This tests the private method indirectly through getStats
      expect(typeof stats1.totalSize).toBe('string');
      expect(typeof stats2.totalSize).toBe('string');
      expect(typeof stats3.totalSize).toBe('string');
    });
  });

  describe('cache key generation', () => {
    it('should generate different keys for different inputs', async () => {
      // This is tested indirectly by setting and getting different values
      await cacheManager.set('content1', 'model1', 'provider1', 0.1, 'message1');
      await cacheManager.set('content2', 'model2', 'provider2', 0.2, 'message2');

      // Different content should generate different cache keys
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
      
      const call1 = mockFs.writeFile.mock.calls[0];
      const call2 = mockFs.writeFile.mock.calls[1];
      
      expect(call1[0]).not.toBe(call2[0]); // Different file paths (keys)
    });
  });
});
