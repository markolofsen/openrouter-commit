/**
 * Unit tests for Phase 1-3 improvements:
 * - Adaptive line limits
 * - Quick filter
 * - Git context
 * - File prioritization
 */

import { diffFilter } from '../../src/modules/diff-filter.js';
import { GitFile, GitDiff } from '../../src/types/index.js';

describe('Phase 1-3 Improvements - Unit Tests', () => {
  describe('Quick Filter', () => {
    const createMockFile = (path: string, isBinary: boolean = false): GitFile => ({
      path,
      status: 'modified',
      isBinary,
      chunks: [],
    });

    it('should remove binary files', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('image.png', true),
          createMockFile('src/index.ts', false),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.files[0]?.path).toBe('src/index.ts');
    });

    it('should remove lock files', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('package-lock.json'),
          createMockFile('yarn.lock'),
          createMockFile('package.json'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.files[0]?.path).toBe('package.json');
    });

    it('should remove node_modules', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('node_modules/react/index.js'),
          createMockFile('src/index.ts'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.files[0]?.path).toBe('src/index.ts');
    });

    it('should remove build outputs', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('dist/bundle.js'),
          createMockFile('.next/build-manifest.json'),
          createMockFile('src/app.ts'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.files[0]?.path).toBe('src/app.ts');
    });

    it('should remove vendor directory', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('vendor/autoload.php'),
          createMockFile('src/main.php'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.files[0]?.path).toBe('src/main.php');
    });

    it('should remove cache directories', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('.cache/webpack.js'),
          createMockFile('.tmp/temp.txt'),
          createMockFile('src/app.js'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.files[0]?.path).toBe('src/app.js');
    });

    it('should keep all relevant source files', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('src/index.ts'),
          createMockFile('src/utils/helper.js'),
          createMockFile('README.md'),
          createMockFile('package.json'),
          createMockFile('Makefile'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(5); // All should pass
    });

    it('should handle empty input', () => {
      const diff: GitDiff = {
        files: [],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(0);
    });

    it('should handle all filtered case', () => {
      const diff: GitDiff = {
        files: [
          createMockFile('node_modules/pkg/index.js'),
          createMockFile('dist/bundle.js'),
          createMockFile('package-lock.json'),
        ],
        totalLines: 0,
        totalSize: 0,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(0);
    });

    it('should update totalLines and totalSize correctly', () => {
      const diff: GitDiff = {
        files: [
          {
            ...createMockFile('src/test.ts'),
            chunks: [{
              header: '@@ -1,1 +1,1 @@',
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              context: 'test',
              lines: [
                { type: 'added', content: 'line 1' },
                { type: 'added', content: 'line 2' },
              ],
            }],
          },
          createMockFile('node_modules/pkg.js'), // Will be filtered
        ],
        totalLines: 10,
        totalSize: 100,
      };

      const filtered = diffFilter.quickFilter(diff);
      expect(filtered.files.length).toBe(1);
      expect(filtered.totalLines).toBe(2); // Recalculated
    });
  });

  describe('Lower Relevancy Threshold', () => {
    it('should have threshold of 0.05', () => {
      const defaultOptions = (diffFilter as any).defaultOptions;
      expect(defaultOptions.relevancyThreshold).toBe(0.05);
    });

    it('should be lower than previous 0.1', () => {
      const threshold = (diffFilter as any).defaultOptions.relevancyThreshold;
      expect(threshold).toBeLessThan(0.1);
    });
  });
});
