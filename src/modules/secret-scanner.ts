import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

/**
 * Gitleaks finding from JSON report
 */
export interface GitleaksFinding {
  RuleID: string;
  Description: string;
  StartLine: number;
  EndLine: number;
  StartColumn: number;
  EndColumn: number;
  Match: string;
  Secret: string;
  File: string;
  SymlinkFile: string;
  Commit: string;
  Link: string;
  Entropy: number;
  Author: string;
  Email: string;
  Date: string;
  Message: string;
  Tags: string[];
  Fingerprint: string;
}

/**
 * Detected secret in diff
 */
export interface DetectedSecret {
  /** File path where secret was found */
  file: string;
  /** Line number in file */
  line: number;
  /** Column number in line */
  column: number;
  /** Human-readable message describing the issue */
  message: string;
  /** Pattern name that detected this secret */
  ruleId: string;
  /** Severity level */
  severity: 'error' | 'warning';
  /** Matched secret text (redacted by Gitleaks) */
  data: string;
}

/**
 * Scan result summary
 */
export interface ScanResult {
  /** All detected secrets */
  secrets: DetectedSecret[];
  /** Critical secrets (error severity) */
  criticalSecrets: DetectedSecret[];
  /** Warning level secrets */
  warnings: DetectedSecret[];
  /** Total files scanned */
  filesScanned: number;
  /** Files with issues */
  filesWithIssues: number;
}

/**
 * Secret scanner using Gitleaks engine
 * Detects API keys, passwords, tokens and other secrets in staged changes
 */
export class SecretScanner {
  private readonly gitleaksPath: string;

  constructor() {
    // Path to gitleaks-secret-scanner binary
    this.gitleaksPath = join(process.cwd(), 'node_modules', '.bin', 'gitleaks-secret-scanner');
  }

  /**
   * Scan staged changes for secrets using Gitleaks
   *
   * @returns Scan results with detected secrets
   *
   * @example
   * ```typescript
   * const scanner = new SecretScanner();
   * const result = await scanner.scanStagedChanges();
   *
   * if (result.criticalSecrets.length > 0) {
   *   console.error('Critical secrets found!');
   * }
   * ```
   */
  async scanStagedChanges(): Promise<ScanResult> {
    const reportPath = join(process.cwd(), '.gitleaks-report.json');

    try {
      // Check if gitleaks is installed
      if (!existsSync(this.gitleaksPath)) {
        logger.debug('Gitleaks not found, skipping scan');
        return this.emptyResult();
      }

      logger.debug('Starting Gitleaks scan on staged changes');

      // Run gitleaks scan on staged changes
      try {
        execSync(
          `"${this.gitleaksPath}" --diff-mode staged --report-format json --report-path "${reportPath}" --no-banner`,
          {
            cwd: process.cwd(),
            stdio: 'pipe',
            encoding: 'utf-8'
          }
        );
      } catch (error) {
        // Gitleaks exits with code 1 when secrets are found
        // This is expected behavior, not an error
        if ((error as any).status !== 1) {
          throw error;
        }
      }

      // Read and parse the report
      if (!existsSync(reportPath)) {
        logger.debug('No Gitleaks report generated');
        return this.emptyResult();
      }

      const reportContent = readFileSync(reportPath, 'utf-8');
      const findings: GitleaksFinding[] = JSON.parse(reportContent);

      // Clean up report file
      unlinkSync(reportPath);

      // Convert Gitleaks findings to our format
      const secrets = this.convertFindings(findings);

      const criticalSecrets = secrets.filter(s => s.severity === 'error');
      const warnings = secrets.filter(s => s.severity === 'warning');

      // Count unique files
      const filesWithIssues = new Set(secrets.map(s => s.file)).size;

      logger.debug('Gitleaks scan completed', {
        totalSecrets: secrets.length,
        critical: criticalSecrets.length,
        warnings: warnings.length,
        filesWithIssues
      });

      return {
        secrets,
        criticalSecrets,
        warnings,
        filesScanned: filesWithIssues, // Gitleaks doesn't report total files
        filesWithIssues
      };
    } catch (error) {
      logger.debug('Gitleaks scan failed', error);
      throw error;
    }
  }

  /**
   * Convert Gitleaks findings to DetectedSecret format
   */
  private convertFindings(findings: GitleaksFinding[]): DetectedSecret[] {
    return findings.map(finding => ({
      file: finding.File,
      line: finding.StartLine,
      column: finding.StartColumn,
      message: finding.Description,
      ruleId: finding.RuleID,
      severity: this.getSeverity(finding.RuleID),
      data: this.maskSecret(finding.Secret, finding.Match)
    }));
  }

  /**
   * Determine severity based on rule ID
   */
  private getSeverity(ruleId: string): 'error' | 'warning' {
    // Critical patterns that should always block
    const criticalPatterns = [
      'aws',
      'github',
      'private-key',
      'slack',
      'stripe',
      'openai',
      'google',
      'azure'
    ];

    const lowerRuleId = ruleId.toLowerCase();

    if (criticalPatterns.some(pattern => lowerRuleId.includes(pattern))) {
      return 'error';
    }

    return 'warning';
  }

  /**
   * Mask secret for display
   */
  private maskSecret(secret: string, match: string): string {
    if (secret.length < 8) {
      return '***';
    }

    const visible = 4;
    const start = secret.slice(0, visible);
    const end = secret.slice(-visible);
    const masked = '*'.repeat(Math.min(secret.length - visible * 2, 20));

    return `${start}${masked}${end} (from: ${match.substring(0, 40)}...)`;
  }

  /**
   * Return empty scan result
   */
  private emptyResult(): ScanResult {
    return {
      secrets: [],
      criticalSecrets: [],
      warnings: [],
      filesScanned: 0,
      filesWithIssues: 0
    };
  }
}

// Singleton instance
export const secretScanner = new SecretScanner();
