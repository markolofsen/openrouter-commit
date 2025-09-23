# OpenRouter Commit

> AI-powered Git commit message generator with efficient chunk processing for large files

[![npm version](https://badge.fury.io/js/orcommit.svg)](https://badge.fury.io/js/orcommit)
[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg?v=101)](https://github.com/ellerbrock/typescript-badges/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A sophisticated CLI tool that generates meaningful, contextual commit messages using OpenRouter and OpenAI APIs. Designed with a modular TypeScript architecture and optimized for handling large codebases through intelligent diff chunking.

## ✨ Features

- 🤖 **AI-Powered**: Generate commit messages using OpenRouter and OpenAI models
- 📦 **Chunked Processing**: Efficiently handle large diffs by breaking them into manageable pieces
- 🔧 **Configurable**: Support for multiple providers, models, and preferences
- 🔒 **Secure**: Safe storage of API keys with proper file permissions (600)
- 🎯 **Conventional Commits**: Support for conventional commit format
- ⚡ **Fast & Reliable**: Async processing with retry logic and error handling
- 🎨 **Beautiful CLI**: Colored output with progress indicators
- 🔄 **Auto-Updates**: Built-in update notifications
- 🧪 **Well-Tested**: Comprehensive test suite with Jest

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
- `-y, --yes` - Skip confirmation and auto-commit
- `-s, --scope <scope>` - Specify commit scope (e.g., auth, ui, api)
- `-t, --type <type>` - Specify commit type (feat, fix, docs, etc.)
- `-b, --breaking` - Mark as breaking change
- `-d, --dry-run` - Generate message without creating commit
- `-v, --verbose` - Enable verbose logging
- `-p, --provider <provider>` - Specify AI provider (openrouter|openai)

**Examples:**
```bash
# Basic usage
orc commit

# Auto-confirm with specific type and scope
orc commit --yes --type feat --scope auth

# Dry run to see generated message
orc commit --dry-run

# Use specific provider
orc commit --provider openai

# Breaking change
orc commit --breaking --type feat
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

- **CLI Module**: Command-line interface using Commander.js
- **Config Module**: Secure configuration management with file permissions
- **Git Module**: Git repository interaction and diff parsing
- **API Module**: HTTP client with retry logic and rate limiting
- **Logger Module**: Structured logging with progress indicators
- **Core Orchestrator**: Main coordination and business logic

### Key Features

- **Chunked Processing**: Large diffs are intelligently split while preserving context
- **Retry Logic**: Exponential backoff for API failures and rate limits
- **Error Handling**: Comprehensive error types with proper error propagation
- **Type Safety**: Full TypeScript coverage with strict type checking
- **Testing**: Jest-based test suite with mocking for external dependencies

## 🔧 Advanced Usage

### Environment Variables

You can set API keys via environment variables:

```bash
export OPENROUTER_API_KEY="your-key-here"
export OPENAI_API_KEY="your-openai-key"
```

### Large File Handling

The tool automatically chunks large diffs to stay within API token limits:

- Maximum chunk size: 8,000 characters
- Maximum concurrent requests: 3
- Context preservation: File and function boundaries respected

### Custom Models

Configure specific models for each provider:

```bash
# OpenRouter models
orc config model openrouter anthropic/claude-3-haiku:beta
orc config model openrouter openai/gpt-4-turbo-preview

# OpenAI models  
orc config model openai gpt-4
orc config model openai gpt-3.5-turbo
```

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
- OpenRouter or OpenAI API key

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

**"API key not configured"**
- Set your API key: `orc config set openrouter your-key`

**"Connection timeout"**
- Check your internet connection and API key validity
- Try with `--verbose` flag for detailed error information

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
# Push functionality added
