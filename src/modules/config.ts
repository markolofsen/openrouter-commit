import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Config, ConfigError, DEFAULT_CONFIG, ProviderConfig } from '../types/index.js';

export class ConfigManager {
  private readonly configPath: string;
  private cachedConfig?: Config;

  constructor() {
    this.configPath = join(homedir(), '.config', 'orcommit.json');
  }

  /**
   * Load configuration from file or create default if not exists
   */
  async load(): Promise<Config> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    try {
      await this.ensureConfigDirectory();
      
      const configExists = await this.fileExists(this.configPath);
      if (!configExists) {
        await this.createDefaultConfig();
      }

      const configData = await fs.readFile(this.configPath, 'utf-8');
      const parsedConfig = JSON.parse(configData) as Config;
      
      // Merge with defaults to ensure all properties exist
      this.cachedConfig = this.mergeWithDefaults(parsedConfig);
      return this.cachedConfig;
    } catch (error) {
      throw new ConfigError(
        `Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Save configuration to file
   */
  async save(config: Config): Promise<void> {
    try {
      await this.ensureConfigDirectory();
      
      const configJson = JSON.stringify(config, null, 2);
      await fs.writeFile(this.configPath, configJson, 'utf-8');
      
      // Set secure permissions (600 - owner read/write only)
      await fs.chmod(this.configPath, 0o600);
      
      this.cachedConfig = config;
    } catch (error) {
      throw new ConfigError(
        `Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Set API key for specific provider
   */
  async setApiKey(provider: 'openrouter' | 'openai', apiKey: string): Promise<void> {
    const config = await this.load();
    const updatedConfig: Config = {
      ...config,
      providers: {
        ...config.providers,
        [provider]: {
          ...config.providers[provider],
          apiKey,
        },
      },
    };
    
    await this.save(updatedConfig);
  }

  /**
   * Get API key for specific provider
   */
  async getApiKey(provider: 'openrouter' | 'openai'): Promise<string | undefined> {
    const config = await this.load();
    return config.providers[provider].apiKey;
  }

  /**
   * Set model for specific provider
   */
  async setModel(provider: 'openrouter' | 'openai', model: string): Promise<void> {
    const config = await this.load();
    const updatedConfig: Config = {
      ...config,
      providers: {
        ...config.providers,
        [provider]: {
          ...config.providers[provider],
          model,
        },
      },
    };
    
    await this.save(updatedConfig);
  }

  /**
   * Get masked API key for display purposes
   */
  async getMaskedApiKey(provider: 'openrouter' | 'openai'): Promise<string> {
    const apiKey = await this.getApiKey(provider);
    if (!apiKey) return 'Not set';
    
    if (apiKey.length <= 8) return '*'.repeat(apiKey.length);
    return `${apiKey.slice(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.slice(-4)}`;
  }

  /**
   * Update user preferences
   */
  async updatePreferences(preferences: Partial<Config['preferences']>): Promise<void> {
    const config = await this.load();
    const updatedConfig: Config = {
      ...config,
      preferences: {
        ...config.preferences,
        ...preferences,
      },
    };
    
    await this.save(updatedConfig);
  }

  /**
   * Validate configuration completeness
   */
  async validateConfig(provider: 'openrouter' | 'openai'): Promise<boolean> {
    const config = await this.load();
    const providerConfig = config.providers[provider];
    
    return Boolean(providerConfig.apiKey && providerConfig.apiKey.trim().length > 0);
  }

  /**
   * Get configuration path for debugging
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Clear cached configuration (useful for testing)
   */
  clearCache(): void {
    this.cachedConfig = undefined;
  }

  // Private methods

  private async ensureConfigDirectory(): Promise<void> {
    const configDir = join(homedir(), '.config');
    try {
      await fs.access(configDir);
    } catch {
      await fs.mkdir(configDir, { recursive: true });
    }
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async createDefaultConfig(): Promise<void> {
    await this.save(DEFAULT_CONFIG);
  }

  private mergeWithDefaults(config: Partial<Config>): Config {
    return {
      providers: {
        openrouter: this.mergeProviderConfig(DEFAULT_CONFIG.providers.openrouter, config.providers?.openrouter),
        openai: this.mergeProviderConfig(DEFAULT_CONFIG.providers.openai, config.providers?.openai),
      },
      preferences: {
        ...DEFAULT_CONFIG.preferences,
        ...config.preferences,
      },
      version: config.version || DEFAULT_CONFIG.version,
    };
  }

  private mergeProviderConfig(defaultConfig: ProviderConfig, userConfig?: Partial<ProviderConfig>): ProviderConfig {
    return {
      ...defaultConfig,
      ...userConfig,
    };
  }
}

// Singleton instance
export const configManager = new ConfigManager();
