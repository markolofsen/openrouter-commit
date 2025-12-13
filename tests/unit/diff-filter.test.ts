import { DiffFilter } from '../../src/modules/diff-filter.js';
import { GitDiff, GitFile, GitChunk, GitLine } from '../../src/types/index.js';

describe('DiffFilter', () => {
  let diffFilter: DiffFilter;

  beforeEach(() => {
    diffFilter = new DiffFilter();
  });

  const createMockDiff = (files: Partial<GitFile>[]): GitDiff => ({
    files: files.map(file => ({
      path: file.path || 'test.ts',
      status: file.status || 'modified',
      chunks: file.chunks || [],
      isBinary: file.isBinary || false,
    })),
    totalLines: files.reduce((sum, file) => 
      sum + (file.chunks || []).reduce((chunkSum, chunk) => chunkSum + chunk.lines.length, 0), 0
    ),
    totalSize: 1000,
  });

  const createMockChunk = (lines: Partial<GitLine>[]): GitChunk => ({
    header: '@@ -1,3 +1,4 @@',
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    context: 'test context',
    lines: lines.map(line => ({
      type: line.type || 'added',
      content: line.content || 'test content',
      lineNumber: line.lineNumber,
    })),
  });

  describe('filterDiff', () => {
    it('should filter out generated files', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      const diff = createMockDiff([
        { path: 'src/main.ts', chunks: [chunk] },
        { path: 'package-lock.json', chunks: [chunk] },
        { path: 'dist/bundle.js', chunks: [chunk] },
        { path: 'node_modules/lib/index.js', chunks: [chunk] },
        { path: 'coverage/report.html', chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, { ignoreGenerated: true });

      expect(filtered.files).toHaveLength(1);
      expect(filtered.files[0]?.path).toBe('src/main.ts');
    });

    it('should filter out binary files', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      const diff = createMockDiff([
        { path: 'src/main.ts', isBinary: false, chunks: [chunk] },
        { path: 'image.png', isBinary: true, chunks: [chunk] },
        { path: 'document.pdf', isBinary: true, chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff);

      expect(filtered.files).toHaveLength(1);
      expect(filtered.files[0]?.path).toBe('src/main.ts');
    });

    it('should filter out lock files when option is enabled', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      const diff = createMockDiff([
        { path: 'src/main.ts', chunks: [chunk] },
        { path: 'package-lock.json', chunks: [chunk] },
        { path: 'yarn.lock', chunks: [chunk] },
        { path: 'Gemfile.lock', chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, { ignoreLockFiles: true });

      expect(filtered.files).toHaveLength(1);
      expect(filtered.files[0]?.path).toBe('src/main.ts');
    });

    it('should keep lock files when option is disabled', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      const diff = createMockDiff([
        { path: 'src/main.ts', chunks: [chunk] },
        { path: 'package-lock.json', chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, {
        ignoreLockFiles: false,
        ignoreGenerated: false  // Also disable generated files filter
      });

      expect(filtered.files).toHaveLength(2);
    });

    it('should filter whitespace-only changes', () => {
      const chunk = createMockChunk([
        { type: 'context', content: 'function test() {' },
        { type: 'removed', content: '  return true;' },
        { type: 'added', content: '    return true;' }, // Only indentation change
        { type: 'added', content: 'console.log("real change");' },
      ]);

      const diff = createMockDiff([
        { path: 'src/main.ts', chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, {
        ignoreWhitespace: true,
        ignoreGenerated: false,
        relevancyThreshold: 0  // Disable relevancy filtering for this test
      });

      expect(filtered.files).toHaveLength(1);
      const filteredChunk = filtered.files[0]?.chunks[0];
      expect(filteredChunk?.lines).toHaveLength(2); // Context + real change
      expect(filteredChunk?.lines.some(line =>
        line.content.includes('real change')
      )).toBe(true);
    });

    it('should filter formatter noise', () => {
      const chunk = createMockChunk([
        { type: 'removed', content: 'import { a } from "lib";' },
        { type: 'added', content: 'import { a } from \'lib\';' }, // Quote style change
        { type: 'added', content: 'const newFeature = true;' }, // Real change
      ]);

      const diff = createMockDiff([
        { path: 'src/main.ts', chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, {
        ignoreFormatterNoise: true,
        ignoreGenerated: false,
        relevancyThreshold: 0
      });

      expect(filtered.files).toHaveLength(1);
      const filteredChunk = filtered.files[0]?.chunks[0];
      expect(filteredChunk?.lines.some(line =>
        line.content.includes('newFeature')
      )).toBe(true);
    });

    it('should remove files with no relevant chunks after filtering', () => {
      const whitespaceOnlyChunk = createMockChunk([
        { type: 'removed', content: '  ' },
        { type: 'added', content: '    ' },
      ]);

      const meaningfulChunk = createMockChunk([
        { type: 'added', content: 'console.log("meaningful change");' },
      ]);

      const diff = createMockDiff([
        { path: 'whitespace-only.ts', chunks: [whitespaceOnlyChunk] },
        { path: 'meaningful.ts', chunks: [meaningfulChunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, {
        ignoreWhitespace: true,
        ignoreGenerated: false,
        relevancyThreshold: 0
      });

      expect(filtered.files).toHaveLength(1);
      expect(filtered.files[0]?.path).toBe('meaningful.ts');
    });

    it('should apply relevancy threshold filtering', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      const diff = createMockDiff([
        { path: 'README.md', chunks: [chunk] }, // Low relevancy
        { path: 'src/important.ts', chunks: [chunk] }, // High relevancy
        { path: 'test.log', chunks: [chunk] }, // Low relevancy
      ]);

      const filtered = diffFilter.filterDiff(diff, { relevancyThreshold: 0.3 });

      // Should keep only files above the relevancy threshold
      expect(filtered.files.length).toBeLessThan(diff.files.length);
      expect(filtered.files.some(f => f.path.includes('important.ts'))).toBe(true);
    });
  });

  describe('isGeneratedFile', () => {
    const generatedFiles = [
      'package-lock.json',
      'yarn.lock',
      'dist/bundle.js',
      'build/output.css',
      'coverage/lcov.info',
      'node_modules/lib/index.js',
      '.vscode/settings.json',
      'generated.g.ts',
      'proto_pb2.py',
      'migrations/001_initial.sql',
    ];

    const sourceFiles = [
      'src/main.ts',
      'lib/utils.js',
      'components/Button.tsx',
      'README.md',
      'package.json',
    ];

    it('should identify generated files correctly', () => {
      generatedFiles.forEach(path => {
        const diff = createMockDiff([{ path }]);
        const filtered = diffFilter.filterDiff(diff, { ignoreGenerated: true });
        expect(filtered.files).toHaveLength(0);
      });
    });

    it('should not filter source files', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      sourceFiles.forEach(path => {
        const diff = createMockDiff([{ path, chunks: [chunk] }]);
        const filtered = diffFilter.filterDiff(diff, {
          ignoreGenerated: true,
          relevancyThreshold: 0
        });
        expect(filtered.files).toHaveLength(1);
      });
    });
  });

  describe('scoreFiles', () => {
    it('should give higher scores to source code files', () => {
      const chunk = createMockChunk([{ type: 'added', content: 'test change' }]);
      const diff = createMockDiff([
        { path: 'src/main.ts', chunks: [chunk] },
        { path: 'README.md', chunks: [chunk] },
        { path: 'package.json', chunks: [chunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff, { relevancyThreshold: 0 });

      // TypeScript file should be first (highest score)
      expect(filtered.files[0]?.path).toBe('src/main.ts');
    });

    it('should score high-value patterns highly', () => {
      const highValueChunk = createMockChunk([
        { type: 'added', content: 'function newFeature() {' },
        { type: 'added', content: '  if (condition) {' },
        { type: 'added', content: '    throw new Error("critical");' },
      ]);

      const lowValueChunk = createMockChunk([
        { type: 'added', content: 'const spacing = 1;' },
      ]);

      const diff = createMockDiff([
        { path: 'high-value.ts', chunks: [highValueChunk] },
        { path: 'low-value.ts', chunks: [lowValueChunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff);

      // High-value file should be first
      expect(filtered.files[0]?.path).toBe('high-value.ts');
    });

    it('should penalize very large files', () => {
      const smallChunk = createMockChunk([
        { type: 'added', content: 'small change' },
      ]);

      const largeChunk = createMockChunk(
        Array(600).fill(0).map(() => ({ type: 'added', content: 'line' }))
      );

      const diff = createMockDiff([
        { path: 'small.ts', chunks: [smallChunk] },
        { path: 'large.ts', chunks: [largeChunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff);

      // Small file should be ranked higher despite being added later
      expect(filtered.files[0]?.path).toBe('small.ts');
    });
  });

  describe('getFilteringSummary', () => {
    it('should provide accurate filtering statistics', () => {
      const originalDiff = createMockDiff([
        { path: 'src/main.ts' },
        { path: 'package-lock.json' },
        { path: 'dist/bundle.js' },
      ]);

      const filteredDiff = createMockDiff([
        { path: 'src/main.ts' },
      ]);

      const summary = diffFilter.getFilteringSummary(originalDiff, filteredDiff);

      expect(summary.filesRemoved).toBe(2);
      expect(summary.sizeReduction).toMatch(/\d+%/);
      expect(summary.topRemovedReasons).toContain('Generated files');
    });
  });

  describe('edge cases', () => {
    it('should handle empty diff', () => {
      const diff = createMockDiff([]);
      const filtered = diffFilter.filterDiff(diff);

      expect(filtered.files).toHaveLength(0);
      expect(filtered.totalLines).toBe(0);
      expect(filtered.totalSize).toBe(0);
    });

    it('should handle files with no chunks', () => {
      const diff = createMockDiff([
        { path: 'empty.ts', chunks: [] },
      ]);

      const filtered = diffFilter.filterDiff(diff);

      expect(filtered.files).toHaveLength(0);
    });

    it('should handle chunks with only context lines', () => {
      const contextOnlyChunk = createMockChunk([
        { type: 'context', content: 'unchanged line 1' },
        { type: 'context', content: 'unchanged line 2' },
      ]);

      const diff = createMockDiff([
        { path: 'context-only.ts', chunks: [contextOnlyChunk] },
      ]);

      const filtered = diffFilter.filterDiff(diff);

      expect(filtered.files).toHaveLength(0);
    });
  });
});
