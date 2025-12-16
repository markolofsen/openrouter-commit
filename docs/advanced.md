# Advanced Usage

Advanced features and configurations for power users.

---

## AI Provider Configuration

### OpenRouter (Recommended)

Access to 200+ models including Claude, GPT-4, and open-source models.

```bash
orc config set openrouter YOUR_API_KEY
orc config model openrouter anthropic/claude-3-haiku:beta
```

**Popular models:**

- `anthropic/claude-3-haiku:beta` - Fast and cost-effective
- `anthropic/claude-3-opus:beta` - Most capable
- `openai/gpt-4-turbo` - OpenAI's latest
- `mistralai/mistral-large` - Strong open-weights model

### OpenAI Direct

```bash
orc config set openai YOUR_OPENAI_KEY
orc config model openai gpt-4
```

**Available models:**

- `gpt-4` - Most capable
- `gpt-4-turbo` - Faster, cheaper
- `gpt-3.5-turbo` - Fast and economical

### Local Models (Ollama)

Free and private, runs entirely on your machine.

```bash
# Install Ollama first: https://ollama.ai
ollama pull mistral

# Configure ORCommit
orc config model openrouter ollama/mistral
```

---

## Custom Prompts

### Override Default Prompt

```bash
orc commit --prompt "Generate a commit message in the style of Linux kernel commits"
```

### Add Context

```bash
orc commit --context "This is part of the authentication refactoring sprint"
```

### Persistent Custom Prompt

```bash
# Set team-wide prompt
orc config prompt "Generate commit messages following our company guidelines:
- Always include ticket number if mentioned in code
- Use imperative mood
- Keep subject under 50 characters"

# Clear custom prompt
orc config prompt
```

---

## Large Codebase Handling

### Token-Aware Chunking

ORCommit automatically chunks large diffs based on model token limits:

- GPT-4: 8K tokens
- Claude: 100K tokens
- Respects model-specific limits

### Limit Files Analyzed

```bash
# Only analyze the 5 most important changed files
orc commit --max-files 5
```

### Ignore Generated Files

```bash
# Skip lock files, dist/, build/, etc.
orc commit --ignore-generated
```

### Skip Whitespace Changes

```bash
# Focus on meaningful changes only
orc commit --ignore-whitespace
```

---

## Caching System

### Two-Level Cache

1. **Memory cache** - Instant responses for same session
2. **Disk cache** - Persists across sessions (24h TTL)

### Cache Management

```bash
# View cache statistics
orc cache stats
# Output:
# Memory Entries: 25
# Disk Entries: 156
# Total Size: 2.3 MB
# Hit Rate: 78%

# Clean expired entries
orc cache cleanup

# Clear all cache
orc cache clear
```

### Disable Caching

```bash
# Single commit without cache
orc commit --no-cache

# Clear and regenerate
orc commit --clear-cache
```

---

## Interactive Regeneration

When not satisfied with generated message:

1. **Accept** - Use the generated message
2. **Regenerate** - Get a new message
3. **Regenerate with feedback** - Provide guidance for improvement
4. **Cancel** - Exit without committing

Up to 5 regeneration attempts with user feedback.

---

## CI/CD Integration

### Environment Variables

```bash
export OPENROUTER_API_KEY="your-key"
export OPENAI_API_KEY="your-key"
```

### Non-Interactive Mode

```bash
# Auto-confirm without prompts
orc commit --yes

# Preview without committing
orc commit --dry-run --yes
```

### Pipeline Example

```yaml
# GitHub Actions
- name: Generate commit message
  env:
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
  run: |
    npm install -g orcommit
    orc commit --yes --dry-run
```

---

## Git Hooks Integration

### prepare-commit-msg Hook

Auto-generate messages for every commit:

```bash
#!/bin/sh
# .git/hooks/prepare-commit-msg
COMMIT_MSG_FILE=$1
COMMIT_SOURCE=$2

if [ -z "$COMMIT_SOURCE" ]; then
  orc commit --dry-run > "$COMMIT_MSG_FILE" 2>&1
fi
```

### pre-commit Hook

Run security checks before commit:

```bash
#!/bin/sh
# .git/hooks/pre-commit
orc commit --dry-run --verbose || exit 1
```

---

## Commit Format Options

### Conventional Commits

```bash
orc commit --type feat --scope auth
# Output: feat(auth): implement OAuth 2.0 integration
```

### Breaking Changes

```bash
orc commit --breaking --type feat
# Output: feat!: change API response format
#
# BREAKING CHANGE: Response format updated
```

### Emoji Support (Gitmoji)

```bash
orc commit --emoji --type feat
# Output: ✨ feat: add user dashboard
```

### Single Line

```bash
orc commit --one-line --description-length 60
# Generates concise single-line message
```

---

## Performance Optimization

### For Large Repositories

```bash
orc commit \
  --max-files 10 \
  --ignore-generated \
  --ignore-whitespace \
  --no-cache
```

### Cache Configuration

Environment variables for cache tuning:

```bash
export ORC_CACHE_TTL=48h          # Longer cache for stable repos
export ORC_MAX_CONCURRENT=5       # Higher concurrency for fast APIs
export ORC_RELEVANCY_THRESHOLD=0.2 # Stricter filtering
```

---

## Troubleshooting

### Debug Mode

```bash
orc commit --verbose
```

### Common Issues

**"All changes were filtered out"**

- Only generated files were changed
- Try `--ignore-generated=false`

**"Operation timed out"**

- Large repository, try `--max-files 10`
- Check internet connection

**"Push failed"**

- Check push permissions
- Verify upstream: `git branch -vv`

### Test API Connection

```bash
orc test openrouter
orc test openai
```
