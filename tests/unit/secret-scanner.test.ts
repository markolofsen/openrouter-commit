import { SecretScanner } from '../../src/modules/secret-scanner.js';
import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';

// Mock fs and child_process
jest.mock('child_process');
jest.mock('fs');

describe('SecretScanner', () => {
  let scanner: SecretScanner;

  beforeEach(() => {
    scanner = new SecretScanner();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('scanStagedChanges', () => {
    it('should return empty result when gitleaks binary not found', async () => {
      jest.mocked(existsSync).mockReturnValue(false);

      const result = await scanner.scanStagedChanges();

      expect(result.secrets).toEqual([]);
      expect(result.criticalSecrets).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.filesScanned).toBe(0);
      expect(result.filesWithIssues).toBe(0);
    });

    it('should detect critical secrets (GitHub PAT)', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true); // gitleaks binary exists
      jest.mocked(existsSync).mockReturnValueOnce(true); // report file exists

      const mockGitleaksOutput = JSON.stringify([
        {
          RuleID: 'github-pat',
          Description: 'GitHub Personal Access Token detected',
          StartLine: 1,
          EndLine: 1,
          StartColumn: 10,
          EndColumn: 50,
          Match: 'token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"',
          Secret: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
          File: 'src/config.ts',
          SymlinkFile: '',
          Commit: 'abc123',
          Link: '',
          Entropy: 4.5,
          Author: 'Test',
          Email: 'test@example.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test commit',
          Tags: [],
          Fingerprint: 'abc123:src/config.ts:github-pat:1'
        }
      ]);

      jest.mocked(readFileSync).mockReturnValue(mockGitleaksOutput);
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.secrets).toHaveLength(1);
      expect(result.criticalSecrets).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
      expect(result.criticalSecrets[0].ruleId).toBe('github-pat');
      expect(result.criticalSecrets[0].severity).toBe('error');
      expect(result.criticalSecrets[0].file).toBe('src/config.ts');
      expect(result.criticalSecrets[0].line).toBe(1);
    });

    it('should detect warning-level secrets (generic API key)', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true);
      jest.mocked(existsSync).mockReturnValueOnce(true);

      const mockGitleaksOutput = JSON.stringify([
        {
          RuleID: 'generic-api-key',
          Description: 'Generic API Key detected',
          StartLine: 5,
          EndLine: 5,
          StartColumn: 15,
          EndColumn: 45,
          Match: 'apiKey = "some-random-key-12345"',
          Secret: 'some-random-key-12345',
          File: 'src/utils.ts',
          SymlinkFile: '',
          Commit: 'def456',
          Link: '',
          Entropy: 3.2,
          Author: 'Test',
          Email: 'test@example.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test commit',
          Tags: [],
          Fingerprint: 'def456:src/utils.ts:generic-api-key:5'
        }
      ]);

      jest.mocked(readFileSync).mockReturnValue(mockGitleaksOutput);
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.secrets).toHaveLength(1);
      expect(result.criticalSecrets).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].severity).toBe('warning');
    });

    it('should handle multiple secrets in multiple files', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true);
      jest.mocked(existsSync).mockReturnValueOnce(true);

      const mockGitleaksOutput = JSON.stringify([
        {
          RuleID: 'aws-access-key',
          Description: 'AWS Access Key detected',
          StartLine: 1,
          EndLine: 1,
          StartColumn: 10,
          EndColumn: 30,
          Match: 'aws_key = "AKIAIOSFODNN7EXAMPLE"',
          Secret: 'AKIAIOSFODNN7EXAMPLE',
          File: 'src/config.ts',
          SymlinkFile: '',
          Commit: 'abc123',
          Link: '',
          Entropy: 4.0,
          Author: 'Test',
          Email: 'test@example.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test',
          Tags: [],
          Fingerprint: 'abc123:src/config.ts:aws-access-key:1'
        },
        {
          RuleID: 'slack-bot-token',
          Description: 'Slack Bot Token detected',
          StartLine: 10,
          EndLine: 10,
          StartColumn: 5,
          EndColumn: 50,
          Match: 'slack = "xoxb-123456"',
          Secret: 'xoxb-123456',
          File: 'src/api.ts',
          SymlinkFile: '',
          Commit: 'def456',
          Link: '',
          Entropy: 3.5,
          Author: 'Test',
          Email: 'test@example.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test',
          Tags: [],
          Fingerprint: 'def456:src/api.ts:slack-bot-token:10'
        }
      ]);

      jest.mocked(readFileSync).mockReturnValue(mockGitleaksOutput);
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.secrets).toHaveLength(2);
      expect(result.criticalSecrets).toHaveLength(2);
      expect(result.filesWithIssues).toBe(2);
    });

    it('should handle gitleaks execution error gracefully', async () => {
      jest.mocked(existsSync).mockReturnValue(true);
      jest.mocked(execSync).mockImplementation(() => {
        throw new Error('Gitleaks execution failed');
      });

      await expect(scanner.scanStagedChanges()).rejects.toThrow('Gitleaks execution failed');
    });

    it('should return empty result when no report file generated', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true); // binary exists
      jest.mocked(existsSync).mockReturnValueOnce(false); // no report file
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.secrets).toEqual([]);
      expect(result.filesScanned).toBe(0);
    });

    it('should mask secrets in output', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true);
      jest.mocked(existsSync).mockReturnValueOnce(true);

      const longSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz1234567890';
      const mockGitleaksOutput = JSON.stringify([
        {
          RuleID: 'github-pat',
          Description: 'GitHub PAT',
          StartLine: 1,
          EndLine: 1,
          StartColumn: 1,
          EndColumn: 50,
          Match: `token = "${longSecret}"`,
          Secret: longSecret,
          File: 'test.ts',
          SymlinkFile: '',
          Commit: 'abc',
          Link: '',
          Entropy: 4.5,
          Author: 'Test',
          Email: 'test@test.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test',
          Tags: [],
          Fingerprint: 'abc:test.ts:github-pat:1'
        }
      ]);

      jest.mocked(readFileSync).mockReturnValue(mockGitleaksOutput);
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.secrets[0].data).toContain('****');
      expect(result.secrets[0].data).toContain('ghp_');
      expect(result.secrets[0].data).not.toBe(longSecret);
    });
  });

  describe('severity classification', () => {
    it('should classify AWS secrets as critical', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true);
      jest.mocked(existsSync).mockReturnValueOnce(true);

      const mockGitleaksOutput = JSON.stringify([
        {
          RuleID: 'aws-secret-key',
          Description: 'AWS Secret',
          StartLine: 1,
          EndLine: 1,
          StartColumn: 1,
          EndColumn: 10,
          Match: 'secret',
          Secret: 'test-secret',
          File: 'test.ts',
          SymlinkFile: '',
          Commit: 'abc',
          Link: '',
          Entropy: 4.0,
          Author: 'Test',
          Email: 'test@test.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test',
          Tags: [],
          Fingerprint: 'abc:test.ts:aws-secret-key:1'
        }
      ]);

      jest.mocked(readFileSync).mockReturnValue(mockGitleaksOutput);
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.criticalSecrets).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('should classify generic secrets as warnings', async () => {
      jest.mocked(existsSync).mockReturnValueOnce(true);
      jest.mocked(existsSync).mockReturnValueOnce(true);

      const mockGitleaksOutput = JSON.stringify([
        {
          RuleID: 'generic-secret',
          Description: 'Generic Secret',
          StartLine: 1,
          EndLine: 1,
          StartColumn: 1,
          EndColumn: 10,
          Match: 'secret',
          Secret: 'test-secret',
          File: 'test.ts',
          SymlinkFile: '',
          Commit: 'abc',
          Link: '',
          Entropy: 3.0,
          Author: 'Test',
          Email: 'test@test.com',
          Date: '2025-12-15T00:00:00Z',
          Message: 'test',
          Tags: [],
          Fingerprint: 'abc:test.ts:generic-secret:1'
        }
      ]);

      jest.mocked(readFileSync).mockReturnValue(mockGitleaksOutput);
      jest.mocked(execSync).mockImplementation(() => Buffer.from(''));

      const result = await scanner.scanStagedChanges();

      expect(result.criticalSecrets).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });
  });
});
