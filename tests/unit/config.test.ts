import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConfigManager } from '../../src/modules/config.js';
import { DEFAULT_CONFIG } from '../../src/types/index.js';

// Mock homedir to use temp directory
jest.mock('os', () => ({
  homedir: () => '/tmp/test-home',
}));

// Mock fs operations
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    chmod: jest.fn(),
    access: jest.fn(),
    mkdir: jest.fn(),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const testConfigPath = '/tmp/test-home/.config/orcommit.json';

  beforeEach(() => {
    configManager = new ConfigManager();
    configManager.clearCache();
    jest.clearAllMocks();
  });

  describe('load', () => {
    it('should create default config if file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      const config = await configManager.load();

      expect(config).toEqual(DEFAULT_CONFIG);
      expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/test-home/.config', { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(mockFs.chmod).toHaveBeenCalledWith(testConfigPath, 0o600);
    });

    it('should load existing config file', async () => {
      const existingConfig = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          openrouter: {
            ...DEFAULT_CONFIG.providers.openrouter,
            apiKey: 'test-key',
          },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(existingConfig));

      const config = await configManager.load();

      expect(config.providers.openrouter.apiKey).toBe('test-key');
      expect(mockFs.readFile).toHaveBeenCalledWith(testConfigPath, 'utf-8');
    });

    it('should merge with defaults for incomplete config', async () => {
      const incompleteConfig = {
        providers: {
          openrouter: { apiKey: 'test-key' },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(incompleteConfig));

      const config = await configManager.load();

      expect(config.providers.openrouter.apiKey).toBe('test-key');
      expect(config.providers.openrouter.baseUrl).toBe(DEFAULT_CONFIG.providers.openrouter.baseUrl);
      expect(config.preferences).toEqual(DEFAULT_CONFIG.preferences);
    });

    it('should throw ConfigError on file read failure', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));

      await expect(configManager.load()).rejects.toThrow('Failed to load configuration');
    });
  });

  describe('save', () => {
    it('should save config with correct permissions', async () => {
      const config = { ...DEFAULT_CONFIG };

      await configManager.save(config);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        testConfigPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      );
      expect(mockFs.chmod).toHaveBeenCalledWith(testConfigPath, 0o600);
    });

    it('should create directory if it does not exist', async () => {
      const config = { ...DEFAULT_CONFIG };
      mockFs.access.mockRejectedValue(new Error('ENOENT')); // Directory doesn't exist
      mockFs.mkdir.mockResolvedValue(undefined);

      await configManager.save(config);

      expect(mockFs.mkdir).toHaveBeenCalledWith('/tmp/test-home/.config', { recursive: true });
    });
  });

  describe('setApiKey', () => {
    it('should set API key for openrouter', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      await configManager.setApiKey('openrouter', 'new-api-key');

      const saveCall = mockFs.writeFile.mock.calls[1]; // Second call after default config creation
      const savedConfig = JSON.parse(saveCall[1] as string);
      
      expect(savedConfig.providers.openrouter.apiKey).toBe('new-api-key');
    });

    it('should set API key for openai', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      await configManager.setApiKey('openai', 'openai-key');

      const saveCall = mockFs.writeFile.mock.calls[1];
      const savedConfig = JSON.parse(saveCall[1] as string);
      
      expect(savedConfig.providers.openai.apiKey).toBe('openai-key');
    });
  });

  describe('getApiKey', () => {
    it('should return API key if set', async () => {
      const configWithKey = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          openrouter: {
            ...DEFAULT_CONFIG.providers.openrouter,
            apiKey: 'test-key',
          },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithKey));

      const apiKey = await configManager.getApiKey('openrouter');
      expect(apiKey).toBe('test-key');
    });

    it('should return undefined if API key not set', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      const apiKey = await configManager.getApiKey('openrouter');
      expect(apiKey).toBeUndefined();
    });
  });

  describe('getMaskedApiKey', () => {
    it('should mask long API key correctly', async () => {
      const configWithKey = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          openrouter: {
            ...DEFAULT_CONFIG.providers.openrouter,
            apiKey: 'sk-1234567890abcdef1234567890abcdef',
          },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithKey));

      const maskedKey = await configManager.getMaskedApiKey('openrouter');
      // API key is 35 chars: first 4 + (35-8=27 masked) + last 4
      expect(maskedKey).toBe('sk-1***************************cdef');
    });

    it('should return "Not set" for missing API key', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      const maskedKey = await configManager.getMaskedApiKey('openrouter');
      expect(maskedKey).toBe('Not set');
    });

    it('should mask short API key completely', async () => {
      const configWithKey = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          openrouter: {
            ...DEFAULT_CONFIG.providers.openrouter,
            apiKey: 'short',
          },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithKey));

      const maskedKey = await configManager.getMaskedApiKey('openrouter');
      expect(maskedKey).toBe('*****');
    });
  });

  describe('validateConfig', () => {
    it('should return true for valid config', async () => {
      const configWithKey = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          openrouter: {
            ...DEFAULT_CONFIG.providers.openrouter,
            apiKey: 'valid-key',
          },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithKey));

      const isValid = await configManager.validateConfig('openrouter');
      expect(isValid).toBe(true);
    });

    it('should return false for missing API key', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      const isValid = await configManager.validateConfig('openrouter');
      expect(isValid).toBe(false);
    });

    it('should return false for empty API key', async () => {
      const configWithEmptyKey = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          openrouter: {
            ...DEFAULT_CONFIG.providers.openrouter,
            apiKey: '   ',
          },
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithEmptyKey));

      const isValid = await configManager.validateConfig('openrouter');
      expect(isValid).toBe(false);
    });
  });

  describe('updatePreferences', () => {
    it('should update custom prompt preference', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      const customPrompt = 'Generate concise commit messages';
      await configManager.updatePreferences({ customPrompt });

      expect(mockFs.writeFile).toHaveBeenCalled();
      const savedConfig = JSON.parse(mockFs.writeFile.mock.calls[0]?.[1] as string);
      expect(savedConfig.preferences.customPrompt).toBe(customPrompt);
    });

    it('should clear custom prompt when set to undefined', async () => {
      const configWithPrompt = {
        ...DEFAULT_CONFIG,
        preferences: {
          ...DEFAULT_CONFIG.preferences,
          customPrompt: 'Old prompt',
        },
      };

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(configWithPrompt));

      await configManager.updatePreferences({ customPrompt: undefined });

      expect(mockFs.writeFile).toHaveBeenCalled();
      const savedConfig = JSON.parse(mockFs.writeFile.mock.calls[0]?.[1] as string);
      expect(savedConfig.preferences.customPrompt).toBeUndefined();
    });

    it('should update multiple preferences at once', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readFile.mockResolvedValue(JSON.stringify(DEFAULT_CONFIG));

      await configManager.updatePreferences({
        customPrompt: 'Custom prompt',
        autoConfirm: true,
        temperature: 0.8,
      });

      expect(mockFs.writeFile).toHaveBeenCalled();
      const savedConfig = JSON.parse(mockFs.writeFile.mock.calls[0]?.[1] as string);
      expect(savedConfig.preferences.customPrompt).toBe('Custom prompt');
      expect(savedConfig.preferences.autoConfirm).toBe(true);
      expect(savedConfig.preferences.temperature).toBe(0.8);
    });
  });

  describe('getConfigPath', () => {
    it('should return correct config path', () => {
      const path = configManager.getConfigPath();
      expect(path).toBe(testConfigPath);
    });
  });
});
