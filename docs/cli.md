# CLI Reference

Complete reference for all ORCommit commands and options.

---

## Installation

```bash
# Global installation (recommended)
npm install -g orcommit

# Or use directly without installing
npx orcommit
```

---

## Commands

### `orc commit` (default)

Generate and create a commit message for staged changes.

```bash
orc commit [options]
```

#### Basic Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation and auto-commit |
| `-d, --dry-run` | Generate message without creating commit |
| `-v, --verbose` | Enable verbose logging |
| `-w, --watch` | Watch for changes and auto-generate commits |

#### AI Customization

| Option | Description |
|--------|-------------|
| `--prompt <text>` | Override default AI prompt completely |
| `--context <text>` | Add additional context to the prompt |

#### Commit Format

| Option | Description |
|--------|-------------|
| `-s, --scope <scope>` | Specify commit scope (e.g., auth, ui, api) |
| `-t, --type <type>` | Specify commit type (feat, fix, docs, etc.) |
| `-b, --breaking` | Mark as breaking change |
| `--emoji` | Include appropriate emoji in commit message |
| `--one-line` | Generate single-line commit message |
| `--description-length <length>` | Maximum description length |

#### Provider & Processing

| Option | Description |
|--------|-------------|
| `-p, --provider <provider>` | Specify AI provider (openrouter\|openai) |
| `--max-files <count>` | Maximum number of files to analyze |
| `--ignore-generated` | Ignore auto-generated files (default: true) |
| `--ignore-whitespace` | Ignore whitespace-only changes (default: true) |

#### Caching

| Option | Description |
|--------|-------------|
| `--no-cache` | Disable caching for this commit |
| `--clear-cache` | Clear cache before generating |

#### Git Integration

| Option | Description |
|--------|-------------|
| `--push` | Push changes to remote after commit |
| `--auto-push` | Automatically push all future commits |

#### Security

| Option | Description |
|--------|-------------|
| `--no-secret-scan` | Skip secret scanning (not recommended) |

#### Examples

```bash
# Basic usage - interactive with regeneration support
orc commit

# Auto-confirm and push to remote
orc commit --yes --push

# Custom prompt for specific style
orc commit --prompt "Generate a detailed technical commit message with examples"

# Add context for better AI understanding
orc commit --context "This fixes a critical security vulnerability in JWT validation"

# Combine context with custom settings
orc commit --context "Refactoring for performance" --type refactor --scope api

# Generate with emoji and conventional commits
orc commit --emoji --one-line --type feat --scope ui

# Breaking change with detailed description
orc commit --breaking --type feat --description-length 100

# Dry run to preview AI-generated message
orc commit --dry-run --verbose

# Use specific AI provider (OpenAI instead of default)
orc commit --provider openai --clear-cache

# Large codebase optimization
orc commit --max-files 10 --no-cache --ignore-generated
```

---

### `orc config`

Manage configuration settings and customize AI behavior.

#### Set API Keys

```bash
orc config set openrouter sk-your-key-here
orc config set openai sk-your-openai-key
```

#### Set Default Model

```bash
orc config model openrouter anthropic/claude-3-haiku:beta
orc config model openrouter openai/gpt-4-turbo
orc config model openai gpt-4
```

#### Custom Prompts

```bash
# Set custom prompt (persists across sessions)
orc config prompt "Generate concise commit messages following our team standards"

# Clear custom prompt (revert to default)
orc config prompt
```

#### View Configuration

```bash
orc config get              # View all settings
orc config get openrouter   # View specific provider
orc config path             # Show config file path
```

---

### `orc cache`

Manage intelligent caching system.

```bash
orc cache stats    # Show cache statistics
orc cache clear    # Clear all cached data
orc cache cleanup  # Clean up expired entries
```

---

### `orc test`

Test API connection for configured providers.

```bash
orc test             # Test default provider
orc test openrouter  # Test specific provider
orc test openai
```

---

## Supported Commit Types

When using `--type` option:

| Type | Description |
|------|-------------|
| `feat` | New features |
| `fix` | Bug fixes |
| `docs` | Documentation changes |
| `style` | Code style changes (formatting, etc.) |
| `refactor` | Code refactoring |
| `test` | Adding or updating tests |
| `chore` | Maintenance tasks |
| `perf` | Performance improvements |
| `ci` | CI/CD changes |
| `build` | Build system changes |
| `revert` | Reverting previous commits |

---

## Environment Variables

```bash
export OPENROUTER_API_KEY="your-key-here"
export OPENAI_API_KEY="your-openai-key"
```

---

## Configuration File

Config is stored at `~/.config/orcommit.json` with secure permissions (600).

```json
{
  "providers": {
    "openrouter": {
      "apiKey": "sk-...",
      "model": "anthropic/claude-3-haiku:beta",
      "baseUrl": "https://openrouter.ai/api/v1",
      "timeout": 60000
    },
    "openai": {
      "apiKey": "sk-...",
      "model": "gpt-3.5-turbo",
      "baseUrl": "https://api.openai.com/v1",
      "timeout": 60000
    }
  },
  "preferences": {
    "defaultProvider": "openrouter",
    "maxTokens": 500,
    "temperature": 0.6,
    "autoConfirm": false,
    "language": "en",
    "commitFormat": "conventional"
  }
}
```
