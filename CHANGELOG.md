# Changelog

## [1.1.6] - 2025-12-15 - Enhanced Safety: Strict Blocking of Package Manager Directories

### 🔒 Critical Safety Improvement

**IMPORTANT: This update prevents accidental commits of dependency directories (`node_modules/`, `vendor/`, etc.)**

### What's New

**Strict Dependency Directory Blocking**
- **ALWAYS blocks** commits containing `node_modules/`, `vendor/`, or `bower_components/`
- Cannot be overridden even with `--yes` flag (by design for safety)
- Shows clear error messages with step-by-step fix instructions
- Detects package manager directories early in the commit process

### Why This Matters

Committing dependency directories is a common mistake that can:
- Bloat repository size significantly (sometimes by gigabytes)
- Cause merge conflicts in teams
- Slow down git operations
- Expose security vulnerabilities
- Violate best practices

### How It Works

When you attempt to commit with staged dependency directories:

```
🚨 BLOCKED: Cannot commit dependency directories

The following were detected in staging area:
  • node_modules directory detected
  • pnpm store directory detected

To fix this issue:
  1. Unstage unwanted files: git reset HEAD node_modules/
  2. Update your .gitignore file
  3. Stage only the files you want to commit
```

**The commit is blocked immediately** - protecting your repository.

### Technical Changes

**Modified Files:**

1. **`src/modules/core.ts:917-985`** - Enhanced `handleSafetyCheck()` method
   - Added special handling for package manager directories
   - Strict blocking that cannot be overridden with `--yes`
   - Clear, actionable error messages with fix instructions
   - Detects patterns: `node_modules/`, `vendor/`, `bower_components/`, `.pnpm/`

### Upgrade Notes

**No breaking changes** - this is a pure safety enhancement.

If you intentionally need to commit dependencies (e.g., vendoring for deployment):
1. This is generally not recommended
2. If absolutely necessary, manually commit without using `orc`
3. Consider alternative approaches like Docker or build artifacts

### Configuration

No configuration needed - works automatically out of the box.

To check what files are staged:
```bash
git status
```

To unstage unwanted directories:
```bash
git reset HEAD node_modules/
git reset HEAD vendor/
```

### Best Practices

Always maintain a proper `.gitignore`:
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
```

---

## [1.1.2] - 2025-12-13 - Test Suite Improvements & Code Quality

### 🧪 Testing & Quality Improvements

**All tests passing: 78/78 (100% success rate)**

- ✅ **diff-filter.test.ts** (17/17 passing)
  - Fixed whitespace-only change detection with new `filterWhitespaceChanges()` function
  - Improved formatter pattern detection (removed overly aggressive patterns)
  - Added proper filtering for removed/added line pairs

- ✅ **config.test.ts** (20/20 passing)
  - Updated config file path from `openrouter-commit.json` to `orcommit.json`
  - Fixed `maskSensitive()` test expectations (correct asterisk count)
  - Added proper mocks for directory creation

- ✅ **api.test.ts** (27/27 passing)
  - Updated User-Agent from `openrouter-commit/1.0.0` to `orcommit/1.0.0`
  - Implemented commit message cleaning (removes AI-generated prefixes)
  - Added proper error interceptor mocks
  - Improved error handling to preserve original error messages

- ✅ **core-workflow.test.ts** (14/14 passing)
  - Added p-queue mock for ES module compatibility
  - Added missing mocks for `analyzeStagedFilesSafety`, `diffFilter` methods
  - Fixed TypeScript type issues

### 🔧 Code Improvements

**API Module (`src/modules/api.ts`)**
- Enhanced `extractCommitMessage()` to clean AI-generated noise:
  - Removes prefixes: "Commit message:", "This is commit message:", etc.
  - Removes quotes around messages
  - Removes leading dashes and asterisks
  - Truncates to 200 characters max
- Improved error handling to preserve `ApiError` instances with `isRetryable` flag

**Diff Filter Module (`src/modules/diff-filter.ts`)**
- New `filterWhitespaceChanges()` method for intelligent whitespace filtering
- Detects and removes removed/added pairs that differ only in whitespace
- More accurate formatter pattern matching (only targets actual formatting noise)

**Configuration Module (`src/modules/config.ts`)**
- Standardized config file name to `orcommit.json`
- Improved `getMaskedApiKey()` calculation

### 📝 Breaking Changes

- Config file renamed: `~/.config/openrouter-commit.json` → `~/.config/orcommit.json`
  - Old configs will need to be migrated manually or re-initialized with `orc config`

---

## [1.1.1] - Enhanced AI Commit Generation with Custom Prompts & Advanced Filtering

### 🎯 Overview

This update introduces major improvements to commit message generation:
1. **Custom prompt support** - Override default AI prompts with your own
2. **Interactive regeneration** with user feedback loop
3. **Two-stage AI processing** - Generation + finalization for better quality
4. **Comprehensive diff filtering** - Expanded patterns for all ecosystems
5. **Enhanced UI/UX** - Better spinners and user experience

## ✨ New Features

### 1. Custom Prompt Support

You can now override the default AI prompts with your own:

#### CLI Options
```bash
# Override system prompt completely
orc commit --prompt "Generate a detailed technical commit message"

# Add additional context to the default prompt
orc commit --context "This is a critical security fix for production"
```

#### Configuration Command
```bash
# Save custom prompt to config (persists across sessions)
orc config prompt "Your custom prompt here"

# Clear custom prompt (revert to default)
orc config prompt
```

**Benefits:**
- Full control over AI behavior
- Team-specific commit message styles
- Project-specific requirements
- Different prompts for different contexts

### 2. Interactive Commit Confirmation with Regeneration

When generating a commit message, users now have three options:

- **✅ Accept** - Use the generated message
- **❌ Cancel** - Abort the commit
- **🔄 Regenerate** - Provide feedback and regenerate

#### How It Works

1. AI generates initial commit message
2. User sees the message and is asked: "Accept this commit message?"
3. If user declines, they're asked: "Would you like to regenerate with additional instructions?"
4. User provides specific feedback (e.g., "Be more specific about the bug fix")
5. AI regenerates with the feedback as `[IMPORTANT_USER_FEEDBACK]`
6. Process repeats up to 5 times (configurable)

#### Example Flow

```bash
📝 Generated commit message:
——————————————————
fix: resolve authentication issue
——————————————————

? Accept this commit message? › No

? Would you like to regenerate with additional instructions? › Yes

? What should be changed or improved? › Mention the specific JWT token validation fix

🔄 Regenerating commit message (attempt 1/5)...

📝 Generated commit message:
——————————————————
fix(auth): resolve JWT token validation in login endpoint

Fixed token expiration check that was causing premature logouts
——————————————————

? Accept this commit message? › Yes

💾 Creating commit...
✓ Commit created
```

### 3. Two-Stage AI Processing for Higher Quality

The commit message generation now uses a two-stage process:

**Stage 1: Generation**
- AI analyzes the diff deeply with comprehensive instructions
- Generates detailed commit message with all important changes
- Focus on accuracy and completeness

**Stage 2: Finalization**
- Second AI pass to clean and perfect the message
- Removes explanatory text, prefixes, formatting artifacts
- Ensures proper format (conventional commits, line length, etc.)
- Lower temperature (0.3) for consistent results

**Benefits:**
- Higher quality messages with better formatting
- No more "Here is the commit message:" prefixes
- Consistent output format
- Better handling of edge cases

### 4. Structured Prompts with Block Delimiters

All prompts are now organized into clearly labeled blocks:

#### Block Types

- `[INSTRUCTIONS]...[/INSTRUCTIONS]` - Main task instructions
- `[RULES]...[/RULES]` - Quality standards and requirements
- `[CONTEXT]...[/CONTEXT]` - User-provided additional context
- `[IMPORTANT_USER_FEEDBACK]...[/IMPORTANT_USER_FEEDBACK]` - Regeneration feedback
- `[DIFF_CONTENT]...[/DIFF_CONTENT]` - Git diff to analyze
- `[RAW_MESSAGE_TO_CLEAN]...[/RAW_MESSAGE_TO_CLEAN]` - Stage 2 finalization input

#### Benefits

1. **Clear separation** - AI can easily distinguish between different sections
2. **Better focus** - Important feedback stands out in its own block
3. **Consistency** - Standardized format across all prompts
4. **Debugging** - Easier to debug and improve prompts

### 5. Comprehensive Diff Filtering for All Ecosystems

Greatly expanded the diff filter patterns to cover all major development ecosystems:

**New Patterns Added:**
- **Lock files**: Pipfile.lock, poetry.lock, Cargo.lock, Podfile.lock, pubspec.lock, flake.lock
- **Build outputs**: target/ (Rust/Java), bin/, obj/ (.NET), .next/, .nuxt/, .astro/, .svelte-kit/
- **Test coverage**: .nyc_output/, htmlcov/, test-results/, .pytest_cache/
- **Dependencies**: vendor/, venv/, .venv/, bower_components/, .pnp/
- **IDE/VCS**: .fleet/, .vs/, .svn/
- **Generated code**: *.g.cs, *.g.go, more protobuf patterns
- **Package files**: *.whl, *.egg, *.jar, *.war, *.deb, *.rpm
- **Config files**: .env.*, secrets.*, credentials.*
- **Documentation builds**: _site/, .docusaurus/, .vuepress/

**Benefits:**
- Works seamlessly with Python, Rust, Go, .NET, Flutter, and more
- Reduces noise in commit messages
- Focuses on actual code changes
- Prevents accidental secret commits

### 6. Enhanced UI with Custom Spinners

New visual improvements for better user experience:

**New Spinner Types:**
- `createAIThinkingSpinner()` - For AI generation with brain emoji
- `createProcessingSpinner()` - For git operations

**Improvements:**
- Better status messages ("Polishing the message", "Creating commit")
- Timing information
- Clear success/failure states
- More informative progress updates

### 7. Text Formatting Utilities

New utilities in `src/utils/formatting.ts`:

#### Core Functions

```typescript
// Clean text (trim, remove double spaces/newlines)
cleanText(text: string): string

// Wrap text in named blocks
wrapInBlock(blockName: string, content: string, clean?: boolean): string

// Create multi-block structured prompts
createStructuredPrompt(blocks: Array<{name, content, clean?}>): string
```

#### Helper Functions

```typescript
wrapUserFeedback(feedback: string): string
wrapDiffContent(diff: string): string
wrapInstructions(instructions: string): string
wrapRules(rules: string): string
wrapContext(context: string): string
wrapExamples(examples: string): string
```

## 🔧 Technical Changes

### Modified Files

1. **`src/cli.ts`**
   - Added `--prompt <text>` option for custom system prompts
   - Added `--context <text>` option for additional context
   - Added `config prompt [text]` command to save/clear custom prompts
   - Updated command structure and help text

2. **`src/modules/core.ts`**
   - Updated `createSystemPrompt()` to support custom prompts and structured blocks
   - Added `finalizeCommitMessage()` for two-stage AI processing
   - Modified `generateCommitMessage()` to accept `userFeedback` parameter
   - Replaced `confirmCommit()` with interactive regeneration flow
   - Added regeneration loop with max 5 attempts and safety limits
   - Updated cache logic to skip caching during regeneration
   - Integrated custom spinners for better UX
   - Imported formatting utilities (wrapInstructions, wrapRules, etc.)

3. **`src/modules/api.ts`**
   - Simplified `extractCommitMessage()` - minimal cleanup only
   - Moved final cleaning to Stage 2 finalization
   - Improved message extraction logic

4. **`src/modules/diff-filter.ts`**
   - Massively expanded `generatedFilePatterns` array
   - Added 100+ new patterns for all major ecosystems
   - Improved pattern specificity and coverage
   - Added comprehensive comments for pattern categories

5. **`src/utils/formatting.ts`** (NEW)
   - Text cleaning and block wrapping utilities
   - `cleanText()`, `wrapInBlock()`, `createStructuredPrompt()`
   - Helper functions: wrapInstructions, wrapRules, wrapContext, etc.
   - Removes double spaces, excessive newlines, normalizes line endings

6. **`src/modules/spinner.ts`** (NEW)
   - `createAIThinkingSpinner()` - For AI operations
   - `createProcessingSpinner()` - For git operations
   - Consistent spinner interface across the app

7. **`src/modules/promo.ts`** (NEW)
   - Promotional message functionality (not included in release notes)

8. **`tests/unit/formatting.test.ts`** (NEW)
   - Comprehensive tests for all formatting utilities
   - Edge case coverage
   - 30+ test cases

### Breaking Changes

None - all changes are backward compatible.

## 📊 Example: Structured Prompt

Before:
```
You are a senior software engineer...
YOUR MISSION: Analyze the git diff...
QUALITY STANDARDS:
- Be SPECIFIC...
```

After:
```
[INSTRUCTIONS]
You are a senior software engineer...
YOUR MISSION: Analyze the git diff...
[/INSTRUCTIONS]

[RULES]
- Be SPECIFIC about what changed
- Be ACCURATE - every word counts
- Be COMPLETE - don't omit details
[/RULES]

[CONTEXT]
This is a production hotfix
[/CONTEXT]

[IMPORTANT_USER_FEEDBACK]
Mention the specific API endpoint that was fixed
[/IMPORTANT_USER_FEEDBACK]

[DIFF_CONTENT]
+++ src/api/auth.ts
@@ -15,3 +15,4 @@
+  validateToken(token);
[/DIFF_CONTENT]
```

## 🚀 Usage

### Basic Usage (Auto-confirm)

```bash
orc --yes  # Skips confirmation, uses first generation
```

### Interactive Usage

```bash
orc  # Interactive mode with regeneration option
```

### With Custom Context

```bash
orc --context "This is a critical security fix"
```

### With Custom Prompt

```bash
orc --prompt "Generate a very detailed commit message with examples"
```

## 🎨 Configuration

No configuration changes needed. The feature works out-of-box.

To skip interactive confirmation (old behavior):
```bash
orc config set auto-confirm true
# or use --yes flag
```

## 🔒 Limits & Safety

- **Maximum regenerations**: 5 attempts per commit
- **Cache behavior**: Regenerated messages are not cached (fresh each time)
- **Fallback**: If interactive prompts fail (e.g., in CI), falls back to simple yes/no
- **Validation**: Feedback must be at least 3 characters

## 💡 Tips

1. **Be specific in feedback**: Instead of "make it better", say "mention the specific function that was refactored"
2. **Use context flag**: For project-specific requirements that apply to all commits
3. **Iterate gradually**: Small improvements work better than complete rewrites
4. **Check before accepting**: The AI learns from your feedback patterns

## 🧪 Testing

Run formatting utility tests:
```bash
npm test tests/unit/formatting.test.ts
```

Verify build:
```bash
npm run build
```

## 📝 Notes

- Regeneration feedback is added to the prompt in a prominent `[IMPORTANT_USER_FEEDBACK]` block
- All text is automatically cleaned (trimmed, double spaces/newlines removed)
- Diff content is NOT cleaned to preserve exact formatting
- The two-stage AI process (generation + finalization) still applies to regenerated messages
