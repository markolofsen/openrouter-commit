import {
  truncateText,
  sanitizeCommitMessage,
  calculateBackoffDelay,
  formatFileSize,
  formatDuration,
  parseConventionalCommit,
  maskSensitive,
  isValidCommitType,
} from '../../src/utils/index.js';

describe('Utils', () => {
  describe('truncateText', () => {
    it('should not truncate text shorter than limit', () => {
      expect(truncateText('hello', 10)).toBe('hello');
    });

    it('should truncate text longer than limit', () => {
      expect(truncateText('hello world', 8)).toBe('hello...');
    });

    it('should handle edge cases', () => {
      expect(truncateText('', 5)).toBe('');
      expect(truncateText('abc', 3)).toBe('abc');
      expect(truncateText('abcd', 3)).toBe('...');
    });
  });

  describe('sanitizeCommitMessage', () => {
    it('should trim whitespace', () => {
      expect(sanitizeCommitMessage('  hello world  ')).toBe('hello world');
    });

    it('should replace newlines with spaces', () => {
      expect(sanitizeCommitMessage('hello\nworld\ntest')).toBe('hello world test');
    });

    it('should collapse multiple spaces', () => {
      expect(sanitizeCommitMessage('hello    world')).toBe('hello world');
    });

    it('should remove non-printable characters', () => {
      expect(sanitizeCommitMessage('hello\x00\x01world')).toBe('helloworld');
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      expect(calculateBackoffDelay(1, 1000, 30000, 2)).toBe(1000);
      expect(calculateBackoffDelay(2, 1000, 30000, 2)).toBe(2000);
      expect(calculateBackoffDelay(3, 1000, 30000, 2)).toBe(4000);
      expect(calculateBackoffDelay(4, 1000, 30000, 2)).toBe(8000);
    });

    it('should respect maximum delay', () => {
      expect(calculateBackoffDelay(10, 1000, 5000, 2)).toBe(5000);
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes correctly', () => {
      expect(formatFileSize(512)).toBe('512.0 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1048576)).toBe('1.0 MB');
      expect(formatFileSize(1073741824)).toBe('1.0 GB');
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(45000)).toBe('45s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(125000)).toBe('2m 5s');
    });
  });

  describe('parseConventionalCommit', () => {
    it('should parse basic conventional commit', () => {
      const result = parseConventionalCommit('feat: add new feature');
      expect(result).toEqual({
        type: 'feat',
        scope: undefined,
        description: 'add new feature',
        breaking: false,
      });
    });

    it('should parse commit with scope', () => {
      const result = parseConventionalCommit('fix(auth): resolve login issue');
      expect(result).toEqual({
        type: 'fix',
        scope: 'auth',
        description: 'resolve login issue',
        breaking: false,
      });
    });

    it('should parse breaking change', () => {
      const result = parseConventionalCommit('feat!: breaking API change');
      expect(result).toEqual({
        type: 'feat',
        scope: undefined,
        description: 'breaking API change',
        breaking: true,
      });
    });

    it('should return null for invalid format', () => {
      expect(parseConventionalCommit('invalid commit message')).toBeNull();
      expect(parseConventionalCommit('feat add feature')).toBeNull();
    });
  });

  describe('maskSensitive', () => {
    it('should mask API keys correctly', () => {
      // String has 19 chars: 'sk-1234567890abcdef'
      // First 4: 'sk-1', Last 4: 'cdef', Middle: 19 - 8 = 11 chars to mask
      expect(maskSensitive('sk-1234567890abcdef', 4)).toBe('sk-1***********cdef');
    });

    it('should handle short strings', () => {
      expect(maskSensitive('abc', 4)).toBe('***');
      expect(maskSensitive('abcdefgh', 4)).toBe('********');
    });
  });

  describe('isValidCommitType', () => {
    it('should validate correct commit types', () => {
      expect(isValidCommitType('feat')).toBe(true);
      expect(isValidCommitType('fix')).toBe(true);
      expect(isValidCommitType('docs')).toBe(true);
      expect(isValidCommitType('test')).toBe(true);
    });

    it('should reject invalid commit types', () => {
      expect(isValidCommitType('invalid')).toBe(false);
      expect(isValidCommitType('feature')).toBe(false);
      expect(isValidCommitType('')).toBe(false);
    });
  });
});
