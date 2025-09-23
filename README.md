# ORCommit Git Manager

> AI-powered Git commit message generator with efficient chunk processing for large files

[![npm version](https://badge.fury.io/js/orcommit.svg)](https://badge.fury.io/js/orcommit)
[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg?v=101)](https://github.com/ellerbrock/typescript-badges/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A sophisticated CLI tool that generates meaningful, contextual commit messages using ORCommit and OpenAI APIs. Designed with a modular TypeScript architecture and optimized for handling large codebases through intelligent diff chunking.

## ✨ Features

- 🤖 **AI-Powered**: Generate commit messages using ORCommit and OpenAI models
- 📦 **Token-Aware Chunking**: Intelligently split large diffs based on actual token limits
- 🚀 **Smart Push Integration**: Interactive push prompts with automatic upstream setup
- 🎨 **Elegant UI**: Structured progress with phase indicators and timing
- ⚡ **Lightning Fast**: Intelligent caching with memory and disk persistence
- 🔧 **Highly Configurable**: Extensive CLI options and provider settings
- 🔒 **Secure**: Safe storage of API keys with proper file permissions (600)
- 🎯 **Conventional Commits**: Full support for conventional commit format with emoji
- 🛡️ **Robust**: Comprehensive error handling with timeouts and auto-recovery
- 🧠 **Smart Filtering**: Automatically filters generated files and whitespace
- 🧪 **Production Ready**: Comprehensive test suite with 90%+ coverage

## 🚀 Installation

Install globally via npm:

```bash
npm install -g orcommit
```

Or use directly with npx:

```bash
npx orcommit
```

## 📖 Quick Start

1. **Set up your API key**:
   ```bash
   orc config set openrouter your-api-key-here
   # or for OpenAI
   orc config set openai your-openai-key-here
   ```

2. **Stage your changes**:
   ```bash
   git add .
   ```

3. **Generate and create commit**:
   ```bash
   orc commit
   ```

That's it! The tool will analyze your staged changes and generate an appropriate commit message.

## 🛠 Commands

### `orc commit` (default)
Generate and create a commit message for staged changes.

**Options:**

**Basic Options:**
- `-y, --yes` - Skip confirmation and auto-commit
- `-d, --dry-run` - Generate message without creating commit
- `-v, --verbose` - Enable verbose logging
- `-w, --watch` - Watch for changes and auto-generate commits

**Commit Format:**
- `-s, --scope <scope>` - Specify commit scope (e.g., auth, ui, api)
- `-t, --type <type>` - Specify commit type (feat, fix, docs, etc.)
- `-b, --breaking` - Mark as breaking change
- `--emoji` - Include appropriate emoji in commit message
- `--one-line` - Generate single-line commit message
- `--description-length <length>` - Maximum description length

**Provider & Processing:**
- `-p, --provider <provider>` - Specify AI provider (openrouter|openai)
- `--max-files <count>` - Maximum number of files to analyze
- `--ignore-generated` - Ignore auto-generated files (default: true)
- `--ignore-whitespace` - Ignore whitespace-only changes (default: true)

**Caching:**
- `--no-cache` - Disable caching for this commit
- `--clear-cache` - Clear cache before generating

**Git Integration:**
- `--push` - Push changes to remote after commit
- `--auto-push` - Automatically push all future commits

**Examples:**
```bash
# Basic usage with interactive push prompt
orc commit

# Auto-confirm and push
orc commit --yes --push

# Generate with emoji and one-line format
orc commit --emoji --one-line

# Specify type, scope and auto-push
orc commit --type feat --scope auth --auto-push

# Dry run to see generated message
orc commit --dry-run --verbose

# Breaking change with description limit
orc commit --breaking --type feat --description-length 50

# Clear cache and use specific provider
orc commit --clear-cache --provider openai

# Process only 5 files with no caching
orc commit --max-files 5 --no-cache
```

### `orc config`
Manage configuration settings.

**Subcommands:**
```bash
# Set API key
orc config set openrouter sk-your-key-here
orc config set openai sk-your-openai-key

# Set default model
orc config model openrouter anthropic/claude-3-haiku:beta
orc config model openai gpt-4

# View configuration
orc config get
orc config get openrouter

# Show config file path
orc config path
```

### `orc cache`
Manage intelligent caching system.

```bash
# Show cache statistics
orc cache stats

# Clear all cached data
orc cache clear

# Clean up expired entries
orc cache cleanup
```

### `orc test`
Test API connection for configured providers.

```bash
# Test default provider
orc test

# Test specific provider
orc test openrouter
orc test openai
```

## ⚙️ Configuration

Configuration is stored in `~/.config/orcommit.json` with secure 600 permissions.

### Default Configuration

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "timeout": 60000
    },
    "openai": {
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

### Supported Commit Types

When using `--type` option, these conventional commit types are supported:

- `feat` - New features
- `fix` - Bug fixes  
- `docs` - Documentation changes
- `style` - Code style changes (formatting, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks
- `perf` - Performance improvements
- `ci` - CI/CD changes
- `build` - Build system changes
- `revert` - Reverting previous commits

## 🏗 Architecture

The tool is built with a modular TypeScript architecture:

### Core Modules

- **CLI Module**: Command-line interface using Commander.js with @clack/prompts
- **Config Module**: Secure configuration management with file permissions (600)
- **Git Module**: Advanced Git repository interaction with intelligent diff parsing
- **API Module**: Robust HTTP client with exponential backoff and concurrency control
- **Logger Module**: Elegant progress indicators with timing and structured output
- **Tokenizer Module**: Token-aware chunking using tiktoken for accurate processing
- **Cache Module**: Two-level caching (memory + disk) with TTL and cleanup
- **Diff Filter Module**: Smart filtering of generated files and irrelevant changes
- **Core Orchestrator**: Main coordination with phase-based processing

### Key Features

- **Token-Based Chunking**: Uses tiktoken to respect actual model token limits
- **Intelligent Caching**: Memory + disk caching with automatic cleanup and TTL
- **Smart Filtering**: Automatically filters out generated files, lock files, and whitespace-only changes
- **Interactive Push**: Prompts user for push with automatic upstream configuration
- **Elegant UI**: Phase-based progress with emojis, timing, and structured output
- **Robust Error Handling**: Comprehensive error types with timeout protection
- **Type Safety**: Full TypeScript coverage with strict mode enabled
- **Production Ready**: Extensive test suite with unit and integration tests

## 🔧 Advanced Usage

### Environment Variables

You can set API keys via environment variables:

```bash
export OPENROUTER_API_KEY="your-key-here"
export OPENAI_API_KEY="your-openai-key"
```

### Smart File Processing

The tool intelligently processes large codebases:

**Token-Aware Chunking:**
- Uses tiktoken for accurate token counting
- Respects model-specific token limits (GPT-4: 8K, Claude: 100K)
- Preserves context at logical boundaries (files, functions)
- Dynamic chunk sizing based on available tokens

**Intelligent Filtering:**
- Auto-detects and skips generated files (dist/, build/, .lock files)
- Filters out whitespace-only changes
- Relevancy scoring to focus on meaningful changes
- Configurable file size limits (default: 1MB per file)

**Performance:**
- Memory + disk caching for instant repeated requests
- Concurrent API processing (up to 3 parallel requests)
- Exponential backoff for rate limit handling

### Custom Models

Configure specific models for each provider:

```bash
# ORCommit models
orc config model openrouter anthropic/claude-3-haiku:beta
orc config model openrouter openai/gpt-4-turbo-preview

# OpenAI models  
orc config model openai gpt-4
orc config model openai gpt-3.5-turbo
```

### Interactive Experience

**Elegant Progress Display:**
```
🔍 Analyzing changes...
✓ Found 15 staged files
✓ Ready to analyze 12 files

🤖 Generating commit message...
✓ Commit message generated (1.2s)

💾 Creating commit...
✓ Commit created
✓ Commit: feat(ui): add interactive push prompts

Do you want to push to remote? › Yes
🚀 Pushing to remote...
✓ Pushed to main (2.1s)
✓ Changes pushed successfully
```

**Smart Push Integration:**
- Interactive prompts for push decisions
- Automatic upstream branch setup
- Support for multiple remotes
- Graceful handling of push failures

## 🧪 Development

### Setup

```bash
git clone <repository>
cd orcommit
npm install
```

### Available Scripts

```bash
npm run build        # Build TypeScript
npm run dev         # Run in development mode
npm run test        # Run tests
npm run test:watch  # Run tests in watch mode
npm run lint        # Run ESLint
npm run format      # Format code with Prettier
```

### Testing

The project includes comprehensive tests:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- utils.test.ts
```

## 📋 Requirements

- Node.js >= 16.0.0
- Git repository
- ORCommit or OpenAI API key

## 🔐 Security

- API keys are stored with 600 file permissions (owner read/write only)
- No API keys are logged or exposed in error messages
- Secure HTTP client with proper timeout and retry handling

## 🐛 Troubleshooting

### Common Issues

**"Not in a git repository"**
- Ensure you're running the command inside a Git repository

**"No staged changes found"**
- Use `git add` to stage files before generating commits
- Check if files are in .gitignore

**"API key not configured"**
- Set your API key: `orc config set openrouter your-key`
- Verify with: `orc config get`

**"All changes were filtered out"**
- Check if only generated files were changed
- Try with `--ignore-generated=false` to include all files
- Use `--verbose` to see what was filtered

**"Operation timed out"**
- Large repositories may take time - operations auto-timeout at 30s
- Try with `--max-files 10` to limit scope
- Check your internet connection and API key validity

**"Push failed"**
- Ensure you have push permissions to the repository
- Check if upstream branch is configured: `git branch -vv`
- Try manual push first: `git push`

### Debug Mode

Use verbose logging for detailed information:

```bash
orc commit --verbose
```

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

- GitHub Issues: [Report bugs or request features](https://github.com/markolofsen/openrouter-commit/issues)
- Documentation: [Additional guides and examples](./docs/)

## 🙏 Acknowledgments

- [OpenRouter](https://openrouter.ai/) for providing access to multiple AI models
- [OpenAI](https://openai.com/) for their powerful language models
- The open-source community for the excellent tools and libraries used in this project

---

**Built with ❤️ using TypeScript, Commander.js, and cutting-edge AI technology.**
