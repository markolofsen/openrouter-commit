// Mock p-queue before any imports
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

import { CoreOrchestrator } from '../../src/modules/core.js';
import { configManager } from '../../src/modules/config.js';
import { gitManager } from '../../src/modules/git.js';
import { apiManager } from '../../src/modules/api.js';
import { cacheManager } from '../../src/modules/cache.js';
import { diffFilter } from '../../src/modules/diff-filter.js';
import { secretScanner } from '../../src/modules/secret-scanner.js';
import { CliOptions } from '../../src/types/index.js';

// Mock all external dependencies
jest.mock('../../src/modules/config.js');
jest.mock('../../src/modules/git.js');
jest.mock('../../src/modules/api.js');
jest.mock('../../src/modules/cache.js');
jest.mock('../../src/modules/tokenizer.js');
jest.mock('../../src/modules/diff-filter.js');
jest.mock('../../src/modules/secret-scanner.js');

const mockConfigManager = configManager as jest.Mocked<typeof configManager>;
const mockGitManager = gitManager as jest.Mocked<typeof gitManager>;
const mockApiManager = apiManager as jest.Mocked<typeof apiManager>;
const mockCacheManager = cacheManager as jest.Mocked<typeof cacheManager>;
const mockDiffFilter = diffFilter as jest.Mocked<typeof diffFilter>;
const mockSecretScanner = secretScanner as jest.Mocked<typeof secretScanner>;

describe('CoreOrchestrator Integration', () => {
  let coreOrchestrator: CoreOrchestrator;

  // Define default options for all tests
  const defaultOptions: CliOptions = {
    verbose: false,
    dryRun: false,
  };

  beforeEach(() => {
    coreOrchestrator = new CoreOrchestrator();
    jest.clearAllMocks();

    // Default mock implementations
    mockConfigManager.load.mockResolvedValue({
      providers: {
        openrouter: { apiKey: 'test-key', baseUrl: 'https://api.test' },
        openai: { apiKey: 'test-key-2', baseUrl: 'https://api.openai.test' },
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
    } as any);

    mockGitManager.isGitRepository.mockResolvedValue(true);
    mockGitManager.getStagedFiles.mockResolvedValue([
      { path: 'src/test.ts', status: 'modified' },
    ]);
    mockGitManager.analyzeStagedFilesSafety.mockResolvedValue({
      riskLevel: 'safe',
      totalFiles: 1,
      largeFiles: 0,
      suspiciousPatterns: [],
      recommendations: [],
    });
    mockConfigManager.validateConfig.mockResolvedValue(true);

    // Mock diffFilter methods - they should pass through the input unchanged for most tests
    mockDiffFilter.quickFilter.mockImplementation((diff) => diff);
    mockDiffFilter.filterDiff.mockImplementation((diff) => diff);
    mockDiffFilter.getFilteringSummary.mockReturnValue({
      filesRemoved: 0,
      linesRemoved: 0,
      sizeReduction: '0%',
      topRemovedReasons: [],
    });

    // Mock secretScanner - by default no secrets detected
    mockSecretScanner.scanStagedChanges = jest.fn().mockResolvedValue({
      secrets: [],
      criticalSecrets: [],
      warnings: [],
      filesScanned: 0,
      filesWithIssues: 0,
    });
  });

  describe('generateCommit', () => {
    it('should complete full workflow successfully', async () => {
      // Mock git diff
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [
          {
            path: 'src/test.ts',
            status: 'modified',
            isBinary: false,
            chunks: [
              {
                header: '@@ -1,3 +1,4 @@',
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 4,
                context: 'function test',
                lines: [
                  { type: 'context', content: 'function test() {' },
                  { type: 'added', content: '  console.log("hello");' },
                  { type: 'context', content: '  return true;' },
                  { type: 'context', content: '}' },
                ],
              },
            ],
          },
        ],
        totalLines: 4,
        totalSize: 100,
      });

      // Mock cache miss
      mockCacheManager.get.mockResolvedValue(null);

      // Mock API response
      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat: add debug logging to test function',
      });

      // Mock user confirmation (auto-confirm disabled)
      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(defaultOptions);

      expect(mockGitManager.getStagedDiff).toHaveBeenCalled();
      expect(mockApiManager.initializeProvider).toHaveBeenCalledWith('openrouter', expect.any(Object));
      expect(mockApiManager.generateCommitMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openrouter',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({ role: 'user' }),
          ]),
        }),
        'openrouter'
      );
      expect(mockCacheManager.set).toHaveBeenCalled();
      expect(mockGitManager.createCommit).toHaveBeenCalledWith('feat: add debug logging to test function');
    });

    it('should use cached result when available', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      // Mock cache hit
      mockCacheManager.get.mockResolvedValue('feat: cached commit message');

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(defaultOptions);

      expect(mockCacheManager.get).toHaveBeenCalled();
      expect(mockApiManager.generateCommitMessage).not.toHaveBeenCalled();
      expect(mockGitManager.createCommit).toHaveBeenCalledWith('feat: cached commit message');
    });

    it('should handle dry-run mode', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockCacheManager.get.mockResolvedValue(null);
      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat: test commit',
      });

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, dryRun: true });

      expect(mockApiManager.generateCommitMessage).toHaveBeenCalled();
      expect(mockGitManager.createCommit).not.toHaveBeenCalled();
    });

    it('should skip caching when noCache option is true', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat: no cache commit',
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, noCache: true });

      expect(mockCacheManager.get).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should clear cache when clearCache option is true', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat: clear cache commit',
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, clearCache: true });

      expect(mockCacheManager.clear).toHaveBeenCalled();
    });

    it('should handle no staged changes', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [],
        totalLines: 0,
        totalSize: 0,
      });

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(defaultOptions);

      expect(mockApiManager.generateCommitMessage).not.toHaveBeenCalled();
      expect(mockGitManager.createCommit).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockCacheManager.get.mockResolvedValue(null);
      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: false,
        error: { message: 'API Error', code: 'API_ERROR', isRetryable: false } as any,
      });

      await coreOrchestrator.initialize();

      await expect(coreOrchestrator.generateCommit(defaultOptions)).rejects.toThrow('API Error');
    });

    it('should use custom provider when specified', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat: openai commit',
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, provider: 'openai' });

      expect(mockApiManager.initializeProvider).toHaveBeenCalledWith('openai', expect.any(Object));
    });

    it('should handle auto-confirm when yes option is true', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat: auto-confirm commit',
      });

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, yes: true });

      expect(mockGitManager.createCommit).toHaveBeenCalledWith('feat: auto-confirm commit');
    });
  });

  describe('validation', () => {
    it('should throw error when not in git repository', async () => {
      mockGitManager.isGitRepository.mockResolvedValue(false);

      await coreOrchestrator.initialize();

      await expect(coreOrchestrator.generateCommit(defaultOptions)).rejects.toThrow('Not in a git repository');
    });

    it('should throw error when no staged files', async () => {
      mockGitManager.getStagedFiles.mockResolvedValue([]);

      await coreOrchestrator.initialize();

      await expect(coreOrchestrator.generateCommit(defaultOptions)).rejects.toThrow('No staged changes found');
    });

    it('should throw error when API key not configured', async () => {
      mockConfigManager.validateConfig.mockResolvedValue(false);

      await coreOrchestrator.initialize();

      await expect(coreOrchestrator.generateCommit(defaultOptions)).rejects.toThrow('API key not configured');
    });
  });

  describe('system prompt generation', () => {
    it('should include emoji instructions when emoji option is true', async () => {
      // This test would need access to private methods or we'd need to expose them
      // For now, we can test the full workflow and verify the API call includes emoji instructions
      
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: '✨ feat: add emoji support',
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, emoji: true });

      expect(mockApiManager.generateCommitMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('emoji'),
            }),
          ]),
        }),
        'openrouter'
      );
    });

    it('should include breaking change instructions when breaking option is true', async () => {
      mockGitManager.getStagedDiff.mockResolvedValue({
        files: [{ path: 'src/test.ts', status: 'modified', isBinary: false, chunks: [] }],
        totalLines: 1,
        totalSize: 50,
      });

      mockApiManager.generateCommitMessage.mockResolvedValue({
        success: true,
        data: 'feat!: breaking change\n\nBREAKING CHANGE: This breaks existing API',
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, breaking: true });

      expect(mockApiManager.generateCommitMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining('BREAKING CHANGE'),
            }),
          ]),
        }),
        'openrouter'
      );
    });
  });

  describe('Secret Scanning', () => {
    beforeEach(() => {
      // Default: no secrets detected
      mockSecretScanner.scanStagedChanges = jest.fn().mockResolvedValue({
        secrets: [],
        criticalSecrets: [],
        warnings: [],
        filesScanned: 0,
        filesWithIssues: 0,
      });
    });

    it('should block commit when critical secrets detected', async () => {
      mockSecretScanner.scanStagedChanges = jest.fn().mockResolvedValue({
        secrets: [
          {
            file: 'src/config.ts',
            line: 10,
            column: 5,
            message: 'GitHub Personal Access Token detected',
            ruleId: 'github-pat',
            severity: 'error',
            data: 'ghp_****',
          },
        ],
        criticalSecrets: [
          {
            file: 'src/config.ts',
            line: 10,
            column: 5,
            message: 'GitHub Personal Access Token detected',
            ruleId: 'github-pat',
            severity: 'error',
            data: 'ghp_****',
          },
        ],
        warnings: [],
        filesScanned: 1,
        filesWithIssues: 1,
      });

      await coreOrchestrator.initialize();

      await expect(coreOrchestrator.generateCommit(defaultOptions)).rejects.toThrow(
        'Commit blocked: Critical secrets detected'
      );

      expect(mockSecretScanner.scanStagedChanges).toHaveBeenCalled();
      expect(mockApiManager.generateCommitMessage).not.toHaveBeenCalled();
      expect(mockGitManager.createCommit).not.toHaveBeenCalled();
    });

    it('should allow commit when no secrets detected', async () => {
      mockSecretScanner.scanStagedChanges = jest.fn().mockResolvedValue({
        secrets: [],
        criticalSecrets: [],
        warnings: [],
        filesScanned: 1,
        filesWithIssues: 0,
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(defaultOptions);

      expect(mockSecretScanner.scanStagedChanges).toHaveBeenCalled();
      expect(mockApiManager.generateCommitMessage).toHaveBeenCalled();
      expect(mockGitManager.createCommit).toHaveBeenCalled();
    });

    it('should skip secret scanning when --no-secret-scan flag is set', async () => {
      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit({ ...defaultOptions, secretScan: false });

      expect(mockSecretScanner.scanStagedChanges).not.toHaveBeenCalled();
      expect(mockApiManager.generateCommitMessage).toHaveBeenCalled();
      expect(mockGitManager.createCommit).toHaveBeenCalled();
    });

    it('should handle warning-level secrets with user confirmation', async () => {
      mockSecretScanner.scanStagedChanges = jest.fn().mockResolvedValue({
        secrets: [
          {
            file: 'src/utils.ts',
            line: 5,
            column: 10,
            message: 'Generic API key detected',
            ruleId: 'generic-api-key',
            severity: 'warning',
            data: 'api_****',
          },
        ],
        criticalSecrets: [],
        warnings: [
          {
            file: 'src/utils.ts',
            line: 5,
            column: 10,
            message: 'Generic API key detected',
            ruleId: 'generic-api-key',
            severity: 'warning',
            data: 'api_****',
          },
        ],
        filesScanned: 1,
        filesWithIssues: 1,
      });

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(defaultOptions);

      expect(mockSecretScanner.scanStagedChanges).toHaveBeenCalled();
      // With warnings, should still proceed if --yes is true or user confirms
      expect(mockApiManager.generateCommitMessage).toHaveBeenCalled();
    });

    it('should handle secret scanning failure gracefully', async () => {
      mockSecretScanner.scanStagedChanges = jest.fn().mockRejectedValue(
        new Error('Gitleaks binary not found')
      );

      const mockConfirmCommit = jest.fn().mockResolvedValue(true);
      (coreOrchestrator as any).confirmCommit = mockConfirmCommit;

      await coreOrchestrator.initialize();
      await coreOrchestrator.generateCommit(defaultOptions);

      // Should continue with commit even if scanning fails
      expect(mockSecretScanner.scanStagedChanges).toHaveBeenCalled();
      expect(mockApiManager.generateCommitMessage).toHaveBeenCalled();
      expect(mockGitManager.createCommit).toHaveBeenCalled();
    });
  });
});
