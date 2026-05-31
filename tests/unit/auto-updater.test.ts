import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AutoUpdater } from '../../src/modules/auto-updater.js';
import type { Package } from 'update-notifier';

// Mock fs operations
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    access: jest.fn(),
  },
}));

// Mock child_process
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

// Mock update-notifier
jest.mock('update-notifier', () => {
  return jest.fn(() => ({
    update: undefined,
  }));
});

const mockFs = fs as jest.Mocked<typeof fs>;
const mockExecSync = require('child_process').execSync as jest.Mock;
const mockUpdateNotifier = require('update-notifier') as jest.Mock;

describe('AutoUpdater', () => {
  let autoUpdater: AutoUpdater;
  const mockPackage: Package = {
    name: 'orcommit',
    version: '1.0.0',
  };

  beforeEach(() => {
    autoUpdater = new AutoUpdater(mockPackage);
    jest.clearAllMocks();

    // Default mocks
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);
  });

  describe('checkForUpdates', () => {
    it('should return no update when no new version available', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache not found'));
      mockUpdateNotifier.mockReturnValue({ update: undefined });

      const result = await autoUpdater.checkForUpdates();

      expect(result.hasUpdate).toBe(false);
      expect(result.currentVersion).toBe('1.0.0');
    });

    it('should return update when new version available', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache not found'));
      mockUpdateNotifier.mockReturnValue({
        update: {
          latest: '1.1.0',
          current: '1.0.0',
          type: 'minor',
          name: 'orcommit',
        },
      });

      const result = await autoUpdater.checkForUpdates();

      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe('1.1.0');
      expect(result.currentVersion).toBe('1.0.0');
    });

    it('should use cached result within 24 hours', async () => {
      const cacheData = {
        lastCheck: Date.now() - 1000 * 60 * 60, // 1 hour ago
        latestVersion: '1.1.0',
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(cacheData));

      const result = await autoUpdater.checkForUpdates();

      expect(result.hasUpdate).toBe(true);
      expect(result.latestVersion).toBe('1.1.0');
      // Should not call update-notifier when using cache
      expect(mockUpdateNotifier).not.toHaveBeenCalled();
    });

    it('should perform fresh check after 24 hours', async () => {
      const cacheData = {
        lastCheck: Date.now() - 1000 * 60 * 60 * 25, // 25 hours ago
        latestVersion: '1.1.0',
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(cacheData));
      mockUpdateNotifier.mockReturnValue({
        update: {
          latest: '1.2.0',
          current: '1.0.0',
          type: 'minor',
          name: 'orcommit',
        },
      });

      const result = await autoUpdater.checkForUpdates();

      expect(result.latestVersion).toBe('1.2.0');
      expect(mockUpdateNotifier).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Read error'));
      mockUpdateNotifier.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await autoUpdater.checkForUpdates();

      // Should return safe defaults on error
      expect(result.hasUpdate).toBe(false);
      expect(result.currentVersion).toBe('1.0.0');
    });
  });

  describe('notifyIfUpdateAvailable', () => {
    it('should return false when no update available', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache not found'));
      mockUpdateNotifier.mockReturnValue({ update: undefined });

      const result = await autoUpdater.notifyIfUpdateAvailable();

      expect(result).toBe(false);
    });

    it('should print a notification (never auto-install) when update is available', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache not found'));
      mockUpdateNotifier.mockReturnValue({
        update: {
          latest: '1.1.0',
          current: '1.0.0',
          type: 'minor',
          name: 'orcommit',
        },
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await autoUpdater.notifyIfUpdateAvailable();

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();

      // The notification must NEVER recommend sudo (root-owned installs are
      // the cause of later EACCES failures).
      const printed = consoleSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(printed).not.toMatch(/sudo/i);
      expect(printed).toMatch(/npm install -g orcommit/);

      // It must NOT shell out to install anything.
      expect(mockExecSync).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle errors silently', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache error'));
      mockUpdateNotifier.mockImplementation(() => {
        throw new Error('Network error');
      });

      const result = await autoUpdater.notifyIfUpdateAvailable();

      // Should return false on error without throwing
      expect(result).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should remove cache file', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await autoUpdater.clearCache();

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should not throw if cache file does not exist', async () => {
      mockFs.unlink.mockRejectedValue(new Error('File not found'));

      await expect(autoUpdater.clearCache()).resolves.not.toThrow();
    });
  });

  describe('caching', () => {
    it('should save cache after successful check', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache not found'));
      mockUpdateNotifier.mockReturnValue({
        update: {
          latest: '1.1.0',
          current: '1.0.0',
          type: 'minor',
          name: 'orcommit',
        },
      });

      await autoUpdater.checkForUpdates();

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('update-cache.json'),
        expect.stringContaining('1.1.0'),
        'utf-8'
      );
    });

    it('should handle cache save errors silently', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Cache not found'));
      mockFs.writeFile.mockRejectedValue(new Error('Write error'));
      mockUpdateNotifier.mockReturnValue({ update: undefined });

      // Should not throw
      await expect(autoUpdater.checkForUpdates()).resolves.toBeDefined();
    });
  });
});
