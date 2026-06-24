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
   * Set API key for specific provider.
   * Creates the provider entry if it does not exist yet, so
   * `orc config set <new-provider> <key>` can register a brand-new provider.
   */
  async setApiKey(provider: string, apiKey: string): Promise<void> {
    const config = await this.load();
    const updatedConfig: Config = {
      ...config,
      providers: {
        ...config.providers,
        [provider]: {
          ...(config.providers[provider] ?? {}),
          apiKey,
        },
      },
      // Configuring a provider makes it the active default — the user keeps
      // a single active provider instead of juggling several. "What you touch
      // becomes active."
      preferences: { ...config.preferences, defaultProvider: provider },
    };

    await this.save(updatedConfig);
  }

  /**
   * Get API key for specific provider
   */
  async getApiKey(provider: string): Promise<string | undefined> {
    const config = await this.load();
    return config.providers[provider]?.apiKey;
  }

  /**
   * Set model for specific provider.
   * Creates the provider entry if it does not exist yet.
   */
  async setModel(provider: string, model: string): Promise<void> {
    const config = await this.load();
    const updatedConfig: Config = {
      ...config,
      providers: {
        ...config.providers,
        [provider]: {
          ...(config.providers[provider] ?? {}),
          model,
        },
      },
      // Touching a provider makes it the active default (see setApiKey).
      preferences: { ...config.preferences, defaultProvider: provider },
    };

    await this.save(updatedConfig);
  }

  /**
   * Configure a custom provider in one call. Merges the provided fields into
   * the provider entry (creating it if absent). Undefined values are filtered
   * out so existing fields are never clobbered with undefined.
   */
  async setProvider(
    provider: string,
    opts: {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      authHeader?: string;
      authScheme?: string;
    }
  ): Promise<void> {
    const config = await this.load();

    // Only merge keys that were actually provided.
    const patch: { -readonly [K in keyof ProviderConfig]?: ProviderConfig[K] } = {};
    if (opts.baseUrl !== undefined) patch.baseUrl = opts.baseUrl;
    if (opts.apiKey !== undefined) patch.apiKey = opts.apiKey;
    if (opts.model !== undefined) patch.model = opts.model;
    if (opts.authHeader !== undefined) patch.authHeader = opts.authHeader;
    if (opts.authScheme !== undefined) patch.authScheme = opts.authScheme;

    const updatedConfig: Config = {
      ...config,
      providers: {
        ...config.providers,
        [provider]: {
          ...(config.providers[provider] ?? {}),
          ...patch,
        },
      },
      // Configuring a provider makes it the active default (see setApiKey).
      preferences: { ...config.preferences, defaultProvider: provider },
    };

    await this.save(updatedConfig);
  }

  /**
   * Set the active (default) provider explicitly. Used by the rare case where
   * several providers are configured and the user wants to switch back to one
   * without re-entering its key — e.g. the current default ran out of credit.
   * Refuses unknown providers so the default can never point at a missing entry.
   */
  async setDefaultProvider(provider: string): Promise<void> {
    const config = await this.load();

    if (!(provider in config.providers)) {
      throw new ConfigError(
        `Provider '${provider}' is not configured. Configure it first ` +
          `(e.g. orc config set ${provider} <key>).`
      );
    }

    await this.save({
      ...config,
      preferences: { ...config.preferences, defaultProvider: provider },
    });
  }

  /**
   * Remove a provider from the dictionary. Refuses to remove the provider that
   * is currently set as the default.
   */
  async removeProvider(provider: string): Promise<void> {
    const config = await this.load();

    if (!(provider in config.providers)) {
      throw new ConfigError(`Provider '${provider}' is not configured.`);
    }

    const { [provider]: _removed, ...remaining } = config.providers;

    // If we just removed the active default, fall back to another configured
    // provider so the default never points at a missing entry. With the
    // "single active provider" model this is the common case — the user
    // removes the one they were using and the remaining one takes over.
    let defaultProvider = config.preferences.defaultProvider;
    if (defaultProvider === provider) {
      const fallback = Object.keys(remaining)[0];
      if (!fallback) {
        throw new ConfigError(
          `Cannot remove '${provider}': it is the only configured provider. ` +
            `Configure another first (e.g. orc config set <provider> <key>).`
        );
      }
      defaultProvider = fallback;
    }

    await this.save({
      ...config,
      providers: remaining,
      preferences: { ...config.preferences, defaultProvider },
    });
  }

  /**
   * List all configured provider names.
   */
  async listProviders(): Promise<string[]> {
    const config = await this.load();
    return Object.keys(config.providers);
  }

  /**
   * Get masked API key for display purposes
   */
  async getMaskedApiKey(provider: string): Promise<string> {
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
  async validateConfig(provider: string): Promise<boolean> {
    const config = await this.load();
    const providerConfig = config.providers[provider];

    return Boolean(providerConfig?.apiKey && providerConfig.apiKey.trim().length > 0);
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
    const userProviders = config.providers ?? {};
    const defaultProviders = DEFAULT_CONFIG.providers;

    // Union of all provider keys: built-in defaults plus any custom providers
    // the user has registered. Built-ins keep their default baseUrl/timeout
    // when the user hasn't overridden them.
    const providerNames = new Set<string>([
      ...Object.keys(defaultProviders),
      ...Object.keys(userProviders),
    ]);

    const providers: Record<string, ProviderConfig> = {};
    for (const name of providerNames) {
      providers[name] = this.mergeProviderConfig(defaultProviders[name], userProviders[name]);
    }

    return {
      providers,
      preferences: {
        ...DEFAULT_CONFIG.preferences,
        ...config.preferences,
      },
      version: config.version || DEFAULT_CONFIG.version,
    };
  }

  private mergeProviderConfig(
    defaultConfig?: ProviderConfig,
    userConfig?: Partial<ProviderConfig>
  ): ProviderConfig {
    return {
      ...(defaultConfig ?? {}),
      ...(userConfig ?? {}),
    };
  }
}

// Singleton instance
export const configManager = new ConfigManager();
