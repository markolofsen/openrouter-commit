import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import updateNotifier, { Package } from 'update-notifier';
import chalk from 'chalk';
import { logger } from './logger.js';

interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  lastChecked: number;
}

interface UpdateCache {
  lastCheck: number;
  latestVersion?: string;
  downloadedVersion?: string;
}

export class AutoUpdater {
  private readonly cacheDir: string;
  private readonly cacheFile: string;
  private readonly CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly packageJson: Package;

  constructor(packageJson: Package) {
    this.packageJson = packageJson;
    this.cacheDir = join(homedir(), '.orcommit', 'updates');
    this.cacheFile = join(this.cacheDir, 'update-cache.json');
  }

  /**
   * Check for updates (respects 24-hour cache)
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    try {
      const cache = await this.loadCache();
      const now = Date.now();

      // Check cache first (24-hour interval)
      if (cache.lastCheck && (now - cache.lastCheck) < this.CHECK_INTERVAL) {
        logger.debug('Using cached update check', {
          lastCheck: new Date(cache.lastCheck),
          latestVersion: cache.latestVersion
        });

        return {
          hasUpdate: cache.latestVersion ? this.isNewerVersion(cache.latestVersion, this.packageJson.version) : false,
          currentVersion: this.packageJson.version,
          latestVersion: cache.latestVersion,
          lastChecked: cache.lastCheck,
        };
      }

      // Perform fresh check
      logger.debug('Performing fresh update check');
      const notifier = updateNotifier({
        pkg: this.packageJson,
        updateCheckInterval: 0, // Force check
      });

      const hasUpdate = notifier.update !== undefined;
      const latestVersion = notifier.update?.latest;

      // Update cache
      await this.saveCache({
        lastCheck: now,
        latestVersion,
        downloadedVersion: cache.downloadedVersion,
      });

      return {
        hasUpdate,
        currentVersion: this.packageJson.version,
        latestVersion,
        lastChecked: now,
      };

    } catch (error) {
      logger.debug('Update check failed', error as Error);
      // Return safe default on error
      return {
        hasUpdate: false,
        currentVersion: this.packageJson.version,
        lastChecked: Date.now(),
      };
    }
  }

  /**
   * Silently update in background (downloads to cache)
   */
  async silentUpdate(): Promise<boolean> {
    try {
      const checkResult = await this.checkForUpdates();

      if (!checkResult.hasUpdate || !checkResult.latestVersion) {
        logger.debug('No update available');
        return false;
      }

      logger.debug('Update available', {
        current: checkResult.currentVersion,
        latest: checkResult.latestVersion
      });

      // Check if we can update globally (has sudo rights)
      const canUpdateGlobally = await this.checkGlobalUpdatePermission();

      if (canUpdateGlobally) {
        // Update globally
        await this.updateGlobally();
        return true;
      } else {
        // Show update notification with instructions
        this.showUpdateNotification(checkResult.latestVersion);
        return false;
      }

    } catch (error) {
      // Silent failure - don't interrupt user workflow
      logger.debug('Silent update failed', error as Error);
      return false;
    }
  }

  /**
   * Check if current process can update globally (has write access to global node_modules)
   */
  private async checkGlobalUpdatePermission(): Promise<boolean> {
    try {
      // Get global npm prefix
      const prefix = execSync('npm config get prefix', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();

      const globalModules = join(prefix, 'lib', 'node_modules');

      // Try to access with write permission
      await fs.access(globalModules, fs.constants.W_OK);
      return true;

    } catch {
      return false;
    }
  }

  /**
   * Update package globally
   */
  private async updateGlobally(): Promise<void> {
    try {
      logger.info('Updating orcommit to latest version...');

      // Determine package manager
      const packageManager = await this.detectPackageManager();

      const command = packageManager === 'pnpm'
        ? 'pnpm add -g orcommit@latest'
        : 'npm install -g orcommit@latest';

      execSync(command, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8'
      });

      logger.info('Successfully updated orcommit!');

    } catch (error) {
      throw new Error(`Global update failed: ${(error as Error).message}`);
    }
  }

  /**
   * Detect package manager (npm or pnpm)
   */
  private async detectPackageManager(): Promise<'npm' | 'pnpm'> {
    try {
      execSync('pnpm --version', { stdio: 'ignore' });
      return 'pnpm';
    } catch {
      return 'npm';
    }
  }

  /**
   * Show update notification to user
   */
  private showUpdateNotification(latestVersion: string): void {
    const canUseSudo = process.platform !== 'win32';
    const packageManager = 'npm'; // Default to npm for instructions

    console.log('');
    logger.info(`Update available: ${this.packageJson.version} → ${latestVersion}`);

    if (canUseSudo) {
      console.log(`  Run: ${chalk.cyan(`sudo ${packageManager} install -g orcommit@latest`)}`);
    } else {
      console.log(`  Run: ${chalk.cyan(`${packageManager} install -g orcommit@latest`)}`);
    }
    console.log('');
  }

  /**
   * Compare versions (simple semver comparison)
   */
  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.replace(/^v/, '').split('.').map(Number);
    const currentParts = current.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;

      if (l > c) return true;
      if (l < c) return false;
    }

    return false;
  }

  /**
   * Load cache from disk
   */
  private async loadCache(): Promise<UpdateCache> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return { lastCheck: 0 };
    }
  }

  /**
   * Save cache to disk
   */
  private async saveCache(cache: UpdateCache): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      // Silent failure - caching is not critical
      logger.debug('Failed to save update cache', error as Error);
    }
  }

  /**
   * Clear update cache (for testing)
   */
  async clearCache(): Promise<void> {
    try {
      await fs.unlink(this.cacheFile);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
