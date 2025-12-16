# Security Model

ORCommit includes multiple layers of security to protect your codebase and credentials.

---

## Secret Scanning (Gitleaks)

ORCommit automatically scans all commits for secrets using the professional **Gitleaks** engine.

### Detected Patterns (100+)

- AWS Access Keys & Secret Keys
- GitHub Personal Access Tokens
- OpenAI API Keys
- Google Cloud API Keys
- Stripe API Keys
- Slack Tokens
- Private Keys (RSA, SSH, EC, PGP)
- Database Connection Strings
- JWT Tokens
- Generic API Keys & Secrets

### How It Works

1. **Automatic scanning** runs on every commit before message generation
2. **Critical blocking** - dangerous secrets (AWS, GitHub, etc.) block commits immediately
3. **Warning prompts** - generic secrets show warnings and ask for confirmation
4. **Zero configuration** - works out of the box with sensible defaults
5. **Fast performance** - scans only staged changes (< 1s for typical commits)

### Example: Blocked Commit

```bash
$ git add src/config.ts
$ orc commit

🔍 Analyzing changes...
⚠️  Scanning for secrets with Gitleaks...

🚨 BLOCKED: Secrets detected in staged files!

Critical secrets found:

  src/config.ts:
    Line 42:15
    Detected a GitHub Personal Access Token, potentially giving access to repositories.
    Found: ghp_**********************qrst
    Rule: github-pat

To fix this issue:
  1. Remove secrets from code
  2. Use environment variables instead
  3. Add affected files to .gitignore
  4. Create .gitleaksignore file to suppress false positives

✖ Commit blocked: Critical secrets detected
```

### Bypass Options

**1. Skip scanning with CLI flag (not recommended):**

```bash
orc commit --no-secret-scan
```

**2. Suppress specific false positives:**

Create `.gitleaksignore` to ignore specific findings:

```
# .gitleaksignore
# Format: file_path:line_number or file_path:*
test-fixtures/fake-key.js:1
docs/examples/api-example.ts:*
*.test.ts:*
```

### Technical Details

- Powered by [Gitleaks](https://github.com/gitleaks/gitleaks) v8.27+
- Binary auto-downloaded on first run (~15MB, cached)
- Scans only staged changes (not entire repository)
- If Gitleaks unavailable, scanning skipped with warning

---

## Dependency Directory Protection

ORCommit automatically blocks commits containing dependency directories.

### Blocked Directories

- `node_modules/` - npm/yarn/pnpm dependencies
- `vendor/` - Composer/Go dependencies
- `bower_components/` - Bower dependencies
- `.pnpm/` - pnpm store

### Protection Features

- **Always active** - cannot be disabled even with `--yes` flag
- **Prevents repository bloat** - saves gigabytes of space
- **Avoids merge conflicts** - keeps your team's git history clean
- **Follows best practices** - dependencies should never be committed

### Example: Blocked Commit

```bash
$ git add .
$ orc commit

🚨 BLOCKED: Cannot commit dependency directories

The following were detected in staging area:
  • node_modules directory detected

To fix this issue:
  1. Unstage unwanted files: git reset HEAD node_modules/
  2. Update your .gitignore file
  3. Stage only the files you want to commit
```

### Why This Matters

Accidentally committing `node_modules/` can:

- Increase repository size by gigabytes
- Cause merge conflicts in team environments
- Slow down git operations significantly
- Expose outdated or vulnerable dependencies
- Violate industry best practices

### Recommended .gitignore

```gitignore
# Dependencies
node_modules/
.pnpm/
bower_components/
vendor/

# Build outputs
dist/
build/
.next/
.nuxt/
```

---

## API Key Security

- API keys stored with **600 file permissions** (owner read/write only)
- No API keys are logged or exposed in error messages
- Secure HTTP client with proper timeout and retry handling
- Environment variable support for CI/CD environments

### Storage Location

```
~/.config/orcommit.json
```

### Best Practices

1. Use environment variables in CI/CD
2. Never commit config files with API keys
3. Rotate keys periodically
4. Use separate keys for development and production

---

## Smart File Filtering

ORCommit automatically filters potentially dangerous or irrelevant files:

- Generated files (dist/, build/, .lock files)
- Binary files
- Large files (configurable limit)
- Whitespace-only changes

This prevents sending sensitive or unnecessary data to AI providers.
