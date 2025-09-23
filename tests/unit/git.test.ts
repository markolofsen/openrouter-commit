import { exec } from 'child_process';
import { GitManager } from '../../src/modules/git.js';
import { GitDiff, GitFileStatus } from '../../src/types/index.js';

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn(),
}));

const mockExec = exec as jest.MockedFunction<typeof exec>;

describe('GitManager', () => {
  let gitManager: GitManager;

  beforeEach(() => {
    gitManager = new GitManager();
    jest.clearAllMocks();
  });

  describe('isGitRepository', () => {
    it('should return true for valid git repository', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: '.git' } as any, '');
      });

      const result = await gitManager.isGitRepository();
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('git rev-parse --git-dir');
    });

    it('should return false for non-git directory', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(new Error('not a git repository'), { stdout: '' } as any, '');
      });

      const result = await gitManager.isGitRepository();
      expect(result).toBe(false);
    });
  });

  describe('getStagedFiles', () => {
    it('should return list of staged files with status', async () => {
      const mockOutput = 'M\tfile1.ts\nA\tfile2.js\nD\tfile3.py';
      
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: mockOutput } as any, '');
      });

      const files = await gitManager.getStagedFiles();
      
      expect(files).toHaveLength(3);
      expect(files[0]).toEqual({ path: 'file1.ts', status: 'modified' });
      expect(files[1]).toEqual({ path: 'file2.js', status: 'added' });
      expect(files[2]).toEqual({ path: 'file3.py', status: 'deleted' });
    });

    it('should return empty array for no staged files', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: '' } as any, '');
      });

      const files = await gitManager.getStagedFiles();
      expect(files).toHaveLength(0);
    });

    it('should throw GitError on command failure', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(new Error('Git command failed'), { stdout: '' } as any, '');
      });

      await expect(gitManager.getStagedFiles()).rejects.toThrow('Failed to get staged files');
    });
  });

  describe('getStagedDiff', () => {
    it('should return empty diff for no staged changes', async () => {
      mockExec
        .mockImplementationOnce((command, callback) => {
          // git diff --cached --name-status
          callback!(null, { stdout: '' } as any, '');
        });

      const diff = await gitManager.getStagedDiff();
      
      expect(diff.files).toHaveLength(0);
      expect(diff.totalLines).toBe(0);
      expect(diff.totalSize).toBe(0);
    });

    it('should parse diff with file changes', async () => {
      const mockStatusOutput = 'M\tfile1.ts';
      const mockDiffOutput = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 export function hello() {
+  console.log('Hello, world!');
   return 'hello';
 }`;

      mockExec
        .mockImplementationOnce((command, callback) => {
          // git diff --cached --name-status
          callback!(null, { stdout: mockStatusOutput } as any, '');
        })
        .mockImplementationOnce((command, callback) => {
          // git diff --cached --ignore-space-change...
          callback!(null, { stdout: mockDiffOutput } as any, '');
        });

      const diff = await gitManager.getStagedDiff();
      
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.path).toBe('file1.ts');
      expect(diff.files[0]?.status).toBe('modified');
      expect(diff.files[0]?.isBinary).toBe(false);
      expect(diff.files[0]?.chunks).toHaveLength(1);
    });

    it('should handle binary files', async () => {
      const mockStatusOutput = 'M\timage.png';
      const mockDiffOutput = `diff --git a/image.png b/image.png
index 1234567..abcdefg 100644
Binary files a/image.png and b/image.png differ`;

      mockExec
        .mockImplementationOnce((command, callback) => {
          callback!(null, { stdout: mockStatusOutput } as any, '');
        })
        .mockImplementationOnce((command, callback) => {
          callback!(null, { stdout: mockDiffOutput } as any, '');
        });

      const diff = await gitManager.getStagedDiff();
      
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0]?.isBinary).toBe(true);
      expect(diff.files[0]?.chunks).toHaveLength(0);
    });

    it('should split large chunks based on options', async () => {
      const mockStatusOutput = 'M\tfile1.ts';
      const longDiffOutput = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,10 +1,10 @@
${Array(20).fill(0).map((_, i) => `+Line ${i} with some content that makes it longer`).join('\n')}`;

      mockExec
        .mockImplementationOnce((command, callback) => {
          callback!(null, { stdout: mockStatusOutput } as any, '');
        })
        .mockImplementationOnce((command, callback) => {
          callback!(null, { stdout: longDiffOutput } as any, '');
        });

      const diff = await gitManager.getStagedDiff({
        maxChunkSize: 100, // Very small to force splitting
        preserveContext: true,
        maxConcurrency: 1,
      });
      
      expect(diff.files).toHaveLength(1);
      // Should split into multiple chunks due to size limit
      expect(diff.files[0]?.chunks.length).toBeGreaterThan(1);
    });
  });

  describe('createCommit', () => {
    it('should create commit with given message', async () => {
      const commitMessage = 'feat: add new feature';
      const mockOutput = '[main abc1234] feat: add new feature\n 1 file changed, 1 insertion(+)';
      
      mockExec.mockImplementation((command, callback) => {
        expect(command).toContain(`git commit -m "${commitMessage}"`);
        callback!(null, { stdout: mockOutput } as any, '');
      });

      const result = await gitManager.createCommit(commitMessage);
      expect(result).toBe(mockOutput);
    });

    it('should escape quotes in commit message', async () => {
      const commitMessage = 'feat: add "new" feature';
      
      mockExec.mockImplementation((command, callback) => {
        expect(command).toContain(`git commit -m "feat: add \\"new\\" feature"`);
        callback!(null, { stdout: 'success' } as any, '');
      });

      await gitManager.createCommit(commitMessage);
    });

    it('should throw GitError on commit failure', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(new Error('Nothing to commit'), { stdout: '' } as any, '');
      });

      await expect(gitManager.createCommit('test')).rejects.toThrow('Failed to create commit');
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true when there are uncommitted changes', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: ' M file1.ts\n?? file2.js' } as any, '');
      });

      const result = await gitManager.hasUncommittedChanges();
      expect(result).toBe(true);
    });

    it('should return false when working directory is clean', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: '' } as any, '');
      });

      const result = await gitManager.hasUncommittedChanges();
      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return current branch name', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: 'main\n' } as any, '');
      });

      const branch = await gitManager.getCurrentBranch();
      expect(branch).toBe('main');
    });

    it('should throw GitError on failure', async () => {
      mockExec.mockImplementation((command, callback) => {
        callback!(new Error('Not in a git repository'), { stdout: '' } as any, '');
      });

      await expect(gitManager.getCurrentBranch()).rejects.toThrow('Failed to get current branch');
    });
  });

  describe('getRepositoryRoot', () => {
    it('should return repository root path', async () => {
      const rootPath = '/home/user/project';
      
      mockExec.mockImplementation((command, callback) => {
        callback!(null, { stdout: `${rootPath}\n` } as any, '');
      });

      const root = await gitManager.getRepositoryRoot();
      expect(root).toBe(rootPath);
    });
  });

  describe('parseFileStatus', () => {
    it('should parse different file status codes', () => {
      // This tests the private method indirectly through getStagedFiles
      const testCases: Array<[string, GitFileStatus]> = [
        ['A', 'added'],
        ['M', 'modified'],
        ['D', 'deleted'],
        ['R', 'renamed'],
        ['C', 'copied'],
        ['X', 'modified'], // Unknown status defaults to modified
      ];

      testCases.forEach(([statusChar, expectedStatus]) => {
        mockExec.mockImplementation((command, callback) => {
          callback!(null, { stdout: `${statusChar}\ttest.txt` } as any, '');
        });

        gitManager.getStagedFiles().then(files => {
          expect(files[0]?.status).toBe(expectedStatus);
        });
      });
    });
  });

  describe('chunk processing', () => {
    it('should preserve context when splitting chunks', async () => {
      const mockStatusOutput = 'M\tfile1.ts';
      const mockDiffOutput = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,5 +1,6 @@
 function test() {
+  // Added comment
   const value = 1;
   return value;
 }`;

      mockExec
        .mockImplementationOnce((command, callback) => {
          callback!(null, { stdout: mockStatusOutput } as any, '');
        })
        .mockImplementationOnce((command, callback) => {
          callback!(null, { stdout: mockDiffOutput } as any, '');
        });

      const diff = await gitManager.getStagedDiff();
      
      expect(diff.files[0]?.chunks[0]?.context).toBeTruthy();
      expect(diff.files[0]?.chunks[0]?.lines.some(line => line.type === 'context')).toBe(true);
    });
  });
});
