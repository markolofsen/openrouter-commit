import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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
   * Check for updates and, if one exists, print a single non-intrusive
   * notification line. NEVER installs anything automatically.
   *
   * Rationale: the previous implementation silently ran `npm install -g` behind
   * the user's back when it had write access, and recommended `sudo npm i -g`
   * when it didn't. The sudo path is actively harmful — it creates root-owned
   * files under the global prefix that then break every future non-sudo
   * install (exactly the EACCES trap users hit). Updating the user's binary
   * without consent is also surprising. So this is now notification-only, and
   * the suggested command never contains sudo.
   */
  async notifyIfUpdateAvailable(): Promise<boolean> {
    try {
      const checkResult = await this.checkForUpdates();

      if (!checkResult.hasUpdate || !checkResult.latestVersion) {
        logger.debug('No update available');
        return false;
      }

      logger.debug('Update available', {
        current: checkResult.currentVersion,
        latest: checkResult.latestVersion,
      });

      this.showUpdateNotification(checkResult.latestVersion);
      return true;
    } catch (error) {
      // Silent failure - don't interrupt user workflow
      logger.debug('Update notification failed', error as Error);
      return false;
    }
  }

  /**
   * Show update notification to user.
   *
   * The suggested command intentionally NEVER uses sudo: a sudo global install
   * creates root-owned files that break later non-sudo installs. If the user's
   * setup genuinely needs elevated rights, that's a sign the global prefix is
   * misconfigured — `orc doctor` diagnoses and explains how to fix it properly.
   */
  private showUpdateNotification(latestVersion: string): void {
    console.log('');
    logger.info(`Update available: ${this.packageJson.version} → ${latestVersion}`);
    console.log(`  Run: ${chalk.cyan('npm install -g orcommit@latest')}`);
    console.log(`  ${chalk.gray('Permission error? Run')} ${chalk.cyan('orc doctor')} ${chalk.gray('for a fix.')}`);
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
