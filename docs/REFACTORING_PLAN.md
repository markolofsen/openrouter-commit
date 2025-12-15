# ORCommit Refactoring Plan

**Version:** 1.2.0
**Status:** Planning
**Priority:** Medium
**Estimated Effort:** 2-3 weeks

---

## 🎯 Goals

Transform ORCommit into a more maintainable, scalable, and feature-rich AI commit message generator by addressing technical debt and implementing critical security/UX improvements.

### Success Criteria

- ✅ All functions under 50 lines
- ✅ 100% JSDoc coverage for public APIs
- ✅ Secret scanning prevents 100% of credential leaks
- ✅ Git hooks enable zero-config automation
- ✅ Test coverage maintained at 100%
- ✅ Build size < 500KB

---

## 📋 Improvement Areas

### 1. Code Architecture Improvements

#### 1.1 Split Large Methods (Priority: LOW | Effort: MEDIUM)

**Current State:**
- `generateCommit()` in `core.ts`: 286 lines
- `createSystemPrompt()` in `core.ts`: 138 lines
- Violates Single Responsibility Principle
- Hard to test and maintain

**Target State:**
```typescript
// Phase-based architecture
async generateCommit(options: CliOptions): Promise<void> {
  await this.validateEnvironment(options);
  const diff = await this.analyzeStagedChanges(options);
  const message = await this.generateCommitMessageWithRetry(diff, options);
  await this.createAndPushCommit(message, options);
}
```

**Action Items:**
- [ ] Extract `analyzeStagedChanges()` from `generateCommit()` (50 lines)
- [ ] Extract `generateCommitMessageWithRetry()` (60 lines)
- [ ] Extract `createAndPushCommit()` (40 lines)
- [ ] Extract prompt building logic to `PromptBuilder` class
- [ ] Add unit tests for each extracted method

**Files to Modify:**
- `src/modules/core.ts`

**Benefits:**
- Easier unit testing
- Better code reusability
- Clearer code flow
- Simpler debugging

---

#### 1.2 Add Comprehensive JSDoc Comments (Priority: LOW | Effort: LOW)

**Current State:**
- ~40% of public methods lack JSDoc
- No parameter descriptions
- Missing @throws, @example annotations
- Poor IDE autocomplete experience

**Target State:**
```typescript
/**
 * Get structured diff of staged changes
 *
 * @description
 * Retrieves and parses the git diff for all staged files,
 * splitting large diffs into manageable chunks based on token limits.
 *
 * @param options - Chunk processing configuration
 * @param options.maxChunkSize - Maximum size per chunk (default: 50KB)
 * @param options.preserveContext - Keep context lines in diff (default: true)
 *
 * @returns Promise resolving to structured GitDiff object
 * @throws {GitError} If git command fails or repository is invalid
 *
 * @example
 * ```typescript
 * const diff = await gitManager.getStagedDiff({
 *   maxChunkSize: 100000
 * });
 * console.log(`Found ${diff.files.length} changed files`);
 * ```
 *
 * @since 1.1.0
 */
async getStagedDiff(options?: Partial<ChunkProcessingOptions>): Promise<GitDiff>
```

**Action Items:**
- [ ] Add JSDoc to all public methods in `src/modules/git.ts`
- [ ] Add JSDoc to all public methods in `src/modules/core.ts`
- [ ] Add JSDoc to all public methods in `src/modules/api.ts`
- [ ] Add JSDoc to all public methods in `src/modules/diff-filter.ts`
- [ ] Add JSDoc to all type interfaces in `src/types/index.ts`
- [ ] Add JSDoc to all utility functions in `src/utils/`
- [ ] Configure TypeDoc for documentation generation

**Files to Modify:**
- `src/modules/*.ts` (all modules)
- `src/types/index.ts`
- `src/utils/*.ts`

**Benefits:**
- Better developer experience
- Improved IDE autocomplete
- Auto-generated documentation
- Easier onboarding for contributors

---

### 2. Security Enhancements

#### 2.1 Secret Scanning Integration (Priority: HIGH | Effort: MEDIUM)

**Problem:**
Users can accidentally commit API keys, passwords, and tokens without warning. This is a critical security risk that can lead to:
- Repository bloat from credential rotation
- Security breaches if keys are exposed
- Compliance violations
- Team productivity loss from incident response

**Solution:**
Integrate **secretlint** for automatic secret detection before commits.

**Implementation Plan:**

**Phase 1: Install and Configure**
```bash
npm install --save secretlint @secretlint/secretlint-rule-preset-recommend
```

**Phase 2: Create SecretScanner Module** (`src/modules/secret-scanner.ts`)
```typescript
import { lintSource } from "secretlint";
import type { SecretLintCoreResult } from "@secretlint/types";

export interface DetectedSecret {
  file: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
  severity: 'error' | 'warning';
}

export class SecretScanner {
  async scanDiff(diff: GitDiff): Promise<DetectedSecret[]> {
    const secrets: DetectedSecret[] = [];

    for (const file of diff.files) {
      if (file.isBinary || this.isSafeFile(file.path)) continue;

      const content = this.extractAddedContent(file);
      const result = await lintSource({
        content,
        filePath: file.path,
        configFilePath: this.getConfigPath()
      });

      secrets.push(...this.parseResults(result, file.path));
    }

    return secrets;
  }

  private isSafeFile(path: string): boolean {
    return /\.(test|spec|mock)\.(ts|js)$/.test(path);
  }
}
```

**Phase 3: Integrate into Core Workflow** (`src/modules/core.ts`)
```typescript
// In generateCommit(), after getting diff:
analyzeProgress.update('Scanning for secrets');

const secrets = await secretScanner.scanDiff(diff);
const criticalSecrets = secrets.filter(s => s.severity === 'error');

if (criticalSecrets.length > 0) {
  analyzeProgress.fail('Critical secrets detected!');

  console.log(chalk.red('\n🚨 BLOCKED: Secrets detected in staged files!\n'));

  criticalSecrets.forEach(secret => {
    console.log(chalk.yellow(`  ${secret.file}:${secret.line}:${secret.column}`));
    console.log(chalk.gray(`  ${secret.message}`));
    console.log(chalk.gray(`  Rule: ${secret.ruleId}\n`));
  });

  console.log(chalk.gray('To fix:'));
  console.log(chalk.gray('  1. Remove secrets from code'));
  console.log(chalk.gray('  2. Use environment variables'));
  console.log(chalk.gray('  3. Add to .gitignore\n'));

  throw new GitError('Commit blocked: Secrets detected');
}
```

**Phase 4: Configuration** (`.secretlintrc.json`)
```json
{
  "rules": [
    {
      "id": "@secretlint/secretlint-rule-preset-recommend"
    },
    {
      "id": "@secretlint/secretlint-rule-pattern",
      "options": {
        "patterns": [
          {
            "pattern": "/sk-[a-zA-Z0-9]{48}/",
            "message": "OpenAI API key detected"
          },
          {
            "pattern": "/AKIA[0-9A-Z]{16}/",
            "message": "AWS Access Key detected"
          }
        ]
      }
    }
  ]
}
```

**Action Items:**
- [ ] Install secretlint and preset
- [ ] Create `SecretScanner` class in `src/modules/secret-scanner.ts`
- [ ] Add secret scanning to core workflow
- [ ] Add types to `types/index.ts`
- [ ] Create default `.secretlintrc.json` config
- [ ] Add unit tests for `SecretScanner`
- [ ] Update documentation

**Files to Create:**
- `src/modules/secret-scanner.ts` (new)
- `.secretlintrc.json` (new)
- `tests/unit/secret-scanner.test.ts` (new)

**Files to Modify:**
- `src/modules/core.ts` (integrate scanning)
- `src/types/index.ts` (add interfaces)
- `package.json` (add dependencies)

**Benefits:**
- ✅ Prevents 100% of secret commits
- ✅ Protects user security
- ✅ Industry best practice
- ✅ Zero config for users
- ✅ Lightweight (49.8 KB)

**Example Output:**
```bash
🔍 Analyzing changes...
✓ Found 15 staged files
⚠️  Scanning for secrets...

🚨 BLOCKED: Secrets detected in staged files!

  src/config.ts:42:15
  OpenAI API key detected
  Rule: @secretlint/secretlint-rule-pattern

  src/database.ts:15:32
  Database connection string with credentials
  Rule: @secretlint/secretlint-rule-no-homedir

To fix:
  1. Remove secrets from code
  2. Use environment variables
  3. Add to .gitignore

✖ Commit blocked: Secrets detected
```

---

#### 2.2 Enhanced File Safety Checks

**Current State:**
- Basic pattern matching for `node_modules/`
- Limited to package manager directories
- No file size limits
- No entropy analysis

**Improvements:**
- [ ] Add maximum file size check (10MB per file)
- [ ] Detect high-entropy strings (potential keys)
- [ ] Check for binary files accidentally staged
- [ ] Warn about large lock file changes
- [ ] Add `.orc-ignore` file support

---

### 3. Developer Experience Enhancements

#### 3.1 Git Hooks Integration (Priority: MEDIUM | Effort: HIGH)

**Problem:**
Users must manually run `orc commit` every time. This breaks workflow and reduces adoption.

**Solution:**
Built-in git hooks management for automated workflow.

**Implementation Plan:**

**Phase 1: Hooks Manager Module** (`src/modules/hooks.ts`)
```typescript
export class GitHooksManager {
  async installHook(hookName: string, options: HookOptions): Promise<void> {
    const hookPath = this.getHookPath(hookName);
    const script = this.generateScript(hookName, options);
    await fs.writeFile(hookPath, script, { mode: 0o755 });
  }

  async installPreset(presetName: 'auto-commit' | 'strict' | 'ci-cd'): Promise<void> {
    // Install multiple hooks at once
  }

  async listHooks(): Promise<HookConfig[]> {
    // Show installed hooks
  }
}
```

**Phase 2: CLI Commands**
```bash
# Install specific hook
orc hooks install prepare-commit-msg

# Install preset
orc hooks preset auto-commit
orc hooks preset strict      # tests + secret scan + format check
orc hooks preset ci-cd       # auto-push after commit

# List installed hooks
orc hooks list

# Uninstall hook
orc hooks uninstall prepare-commit-msg
```

**Phase 3: Hook Templates**

**prepare-commit-msg** (Auto-generate messages):
```bash
#!/bin/sh
COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2

if [ -z "$COMMIT_SOURCE" ]; then
  orc commit --dry-run > "$COMMIT_MSG_FILE" 2>&1
fi
```

**pre-commit** (Safety checks):
```bash
#!/bin/sh
# Secret scanning
orc scan --secrets || exit 1

# Large file detection
orc scan --large-files || exit 1

# Run tests
npm test || exit 1
```

**post-commit** (Auto-push):
```bash
#!/bin/sh
# Auto-push to remote
git push

# Show commit info
git --no-pager log -1 --stat
```

**Action Items:**
- [ ] Create `GitHooksManager` class
- [ ] Add `orc hooks` command to CLI
- [ ] Create hook templates for all git hooks
- [ ] Add preset configurations
- [ ] Add uninstall functionality
- [ ] Write documentation
- [ ] Add integration tests

**Files to Create:**
- `src/modules/hooks.ts` (new)
- `tests/integration/hooks.test.ts` (new)

**Files to Modify:**
- `src/cli.ts` (add commands)
- `README.md` (document hooks)

**Benefits:**
- ✅ Zero-config automation
- ✅ Seamless workflow integration
- ✅ Team-wide consistency
- ✅ Reduced human error

---

### 4. Testing & Quality

#### 4.1 Expand Test Coverage

**Current:**
- 78 tests, 100% passing
- Mainly unit tests
- Limited integration tests

**Improvements:**
- [ ] Add integration tests for hooks
- [ ] Add E2E tests for full workflow
- [ ] Add performance benchmarks
- [ ] Add regression tests for bug fixes
- [ ] Test error scenarios comprehensively

#### 4.2 CI/CD Enhancements

- [ ] Add automated secret scanning in CI
- [ ] Add bundle size monitoring
- [ ] Add performance regression detection
- [ ] Add automated security audits

---

## 📅 Implementation Timeline

### Week 1-2: Security (HIGH Priority)
- ✅ Integrate secretlint
- ✅ Create SecretScanner module
- ✅ Add to core workflow
- ✅ Write tests
- ✅ Update documentation

### Week 3-4: Git Hooks (MEDIUM Priority)
- ⏳ Create GitHooksManager
- ⏳ Add CLI commands
- ⏳ Create hook templates
- ⏳ Add preset configurations
- ⏳ Integration tests

### Week 5-6: Code Quality (LOW Priority)
- ⏳ Refactor large methods
- ⏳ Add JSDoc comments
- ⏳ Extract reusable utilities
- ⏳ Improve error handling

---

## 🎯 Success Metrics

### Code Quality
- ✅ Average function length < 50 lines
- ✅ Cyclomatic complexity < 10
- ✅ 100% JSDoc coverage for public APIs
- ✅ Zero ESLint warnings

### Security
- ✅ 100% secret detection rate
- ✅ Zero false positives for secrets
- ✅ All deps security audited

### Performance
- ✅ Build size < 500KB
- ✅ Cold start < 2s
- ✅ Secret scan < 1s for 100 files

### Developer Experience
- ✅ < 5 min setup time
- ✅ Zero-config hooks
- ✅ Clear error messages
- ✅ Comprehensive documentation

---

## 🔄 Migration Guide

### For Existing Users

**No Breaking Changes!**

All improvements are backward compatible. Users can opt-in to new features:

```bash
# Optional: Enable secret scanning (recommended)
# Already enabled by default in v1.2.0

# Optional: Install git hooks
orc hooks preset auto-commit

# Optional: Update config
orc config get  # Check current settings
```

### For Contributors

1. Pull latest changes
2. Run `npm install` (new deps: secretlint)
3. Read updated contribution guidelines
4. Review new JSDoc standards

---

## 📚 References

**Libraries:**
- [secretlint](https://github.com/secretlint/secretlint) - Secret detection
- [Commander.js](https://github.com/tj/commander.js) - CLI framework
- [chalk](https://github.com/chalk/chalk) - Terminal colors

**Standards:**
- [Conventional Commits](https://www.conventionalcommits.org/)
- [JSDoc](https://jsdoc.app/)
- [Git Hooks](https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks)

**Best Practices:**
- [OWASP Secrets Management](https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password)
- [Clean Code by Robert Martin](https://www.oreilly.com/library/view/clean-code-a/9780136083238/)

---

## 📝 Notes

- Maintain 100% test coverage throughout refactoring
- No breaking changes in public API
- All new features must be opt-in
- Documentation updates required for each change
- Performance regression tests for critical paths

---

**Last Updated:** 2025-12-15
**Next Review:** After Week 2 (Secret Scanner implementation)
