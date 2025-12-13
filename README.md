# ORCommit - AI Commit Message Generator | Automated Git Commits with OpenAI & Claude

<p align="center">
  <img src="https://unpkg.com/orcommit@latest/preview.png" alt="ORCommit Banner" width="600">
</p>

> **AI-powered git automation** for developers: Generate professional commit messages instantly using OpenAI, Claude, or local AI models

<p align="center">
  <a href="https://badge.fury.io/js/orcommit"><img src="https://badge.fury.io/js/orcommit.svg" alt="npm version"></a>
  <a href="https://github.com/ellerbrock/typescript-badges/"><img src="https://badges.frapsoft.com/typescript/code/typescript.svg?v=101" alt="TypeScript"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

**ORCommit** is the ultimate **AI commit message generator** and **git automation CLI tool** for modern developers. Generate meaningful, contextual commit messages using **GPT-4**, **Claude AI**, **OpenRouter**, or **local AI models (Ollama)**. Built with TypeScript, featuring **intelligent diff chunking**, **interactive regeneration**, **custom prompts**, and **multi-provider support**.

Perfect for developers seeking **automated git commits**, **AI-powered development tools**, and **developer productivity** automation with support for **Conventional Commits** format.

## ✨ Key Features - Why Choose ORCommit?

### 🤖 **Multi-Provider AI Support**
Generate commit messages with your choice of AI:
- **OpenAI** (GPT-4, GPT-4 Turbo, GPT-3.5)
- **Anthropic Claude** (via OpenRouter)
- **OpenRouter** (access to 200+ AI models)
- **Local AI Models** (Ollama support - free & private)

### 🔄 **Interactive Regeneration with Feedback**
Not happy with the generated message? Provide feedback and regenerate:
- Accept, cancel, or improve commit messages
- Two-stage AI processing for higher quality
- Up to 5 regeneration attempts with user guidance
- Smart caching for instant responses

### 🎯 **Custom Prompts & Context**
Full control over AI behavior:
- Override default prompts with `--prompt`
- Add project context with `--context`
- Save team-specific prompts to config
- Perfect for corporate standards and coding guidelines

### 📦 **Intelligent Diff Processing**
Handles codebases of any size:
- Token-aware chunking for large files
- Smart filtering (100+ patterns for generated files)
- Supports all ecosystems: JS, Python, Rust, Go, .NET, Flutter
- Filters lock files, build outputs, and dependencies

### 🚀 **Seamless Git Workflow**
Complete git automation:
- Interactive push prompts with upstream setup
- Git hooks integration for automated commits
- Conventional Commits format support
- Emoji support (Gitmoji compatible)
- Breaking change detection

### ⚡ **Lightning Fast Performance**
Optimized for speed:
- Two-level caching (memory + disk)
- Concurrent API processing
- Exponential backoff for rate limits
- Instant cached responses

### 🔒 **Enterprise-Ready Security**
Built with security in mind:
- Secure API key storage (600 permissions)
- No logging of sensitive data
- Environment variable support
- Prevents accidental secret commits

### 🎨 **Beautiful Developer Experience**
Polished UI/UX:
- Elegant progress indicators
- Clear success/failure states
- Timing information
- Structured phase-based output
- Verbose mode for debugging

### ✅ **Production-Ready Quality**
Thoroughly tested and reliable:
- **78 comprehensive tests** (100% passing)
- Full unit and integration test coverage
- TypeScript strict mode enabled
- Clean commit message generation (removes AI noise)
- Intelligent whitespace filtering
- Robust error handling

## 🚀 Installation

Install globally via npm:

```bash
npm install -g orcommit
```

Or use directly with npx:

```bash
npx orcommit
```

## 📖 Quick Start - Get Started in 3 Steps

### 1️⃣ **Install ORCommit**
```bash
# Global installation (recommended)
npm install -g orcommit

# Or use directly without installing
npx orcommit
```

### 2️⃣ **Configure Your AI Provider**
```bash
# Option 1: OpenRouter (recommended - access to 200+ models)
orc config set openrouter your-api-key-here

# Option 2: OpenAI (GPT-4, GPT-3.5)
orc config set openai your-openai-key-here

# Option 3: Use local AI models (free & private)
# Install Ollama first: https://ollama.ai
orc config model openrouter ollama/mistral
```

### 3️⃣ **Generate Your First AI Commit**
```bash
# Stage your changes
git add .

# Generate and commit (interactive mode)
orc commit

# Or auto-commit without confirmation
orc commit --yes

# With custom context for better results
orc commit --context "Critical security fix for authentication"
```

**That's it!** The AI will analyze your code changes and generate a professional commit message automatically.

## 🛠 Commands

### `orc commit` (default)
Generate and create a commit message for staged changes.

**Options:**

**Basic Options:**
- `-y, --yes` - Skip confirmation and auto-commit
- `-d, --dry-run` - Generate message without creating commit
- `-v, --verbose` - Enable verbose logging
- `-w, --watch` - Watch for changes and auto-generate commits

**AI Customization (NEW):**
- `--prompt <text>` - Override default AI prompt completely
- `--context <text>` - Add additional context to the prompt

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

### `orc config`
Manage configuration settings and customize AI behavior.

**Subcommands:**
```bash
# Set API key for AI providers
orc config set openrouter sk-your-key-here
orc config set openai sk-your-openai-key

# Set default AI model
orc config model openrouter anthropic/claude-3-haiku:beta
orc config model openrouter openai/gpt-4-turbo
orc config model openai gpt-4

# Custom prompts (NEW) - persist across sessions
orc config prompt "Generate concise commit messages following our team standards"
orc config prompt  # Clear custom prompt (revert to default)

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

## 💡 Use Cases - Who Benefits from ORCommit?

### 👨‍💻 **Individual Developers**
- Save time writing commit messages
- Maintain consistent commit history
- Learn best practices from AI-generated messages
- Never forget to document important changes

### 👥 **Development Teams**
- Enforce team commit message standards with custom prompts
- Ensure conventional commits compliance
- Improve code review efficiency
- Track changes across large codebases

### 🏢 **Enterprise & Agencies**
- Maintain corporate coding standards
- Audit trail for compliance
- Multi-language project support
- Integration with existing git workflows

### 🎓 **Students & Learning**
- Learn git best practices
- Understand what makes a good commit message
- Practice conventional commits format
- Build portfolio with professional commits

### 🚀 **Open Source Projects**
- Maintain consistent contribution quality
- Help new contributors write better commits
- Save maintainer time on commit message reviews
- Support for multiple languages and formats

## 🏗 Architecture & Technology Stack

Built with modern TypeScript and cutting-edge AI technology:

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

## 🏢 Built by Reforms.ai - AI SaaS Development Experts

**ORCommit** is developed and maintained by **[Reforms.ai](https://reforms.ai)**, a leading AI SaaS development company specializing in cutting-edge AI-powered solutions for modern development workflows.

### 🚀 About Reforms.ai

Reforms.ai is a technology company focused on building innovative AI-powered tools and SaaS solutions that enhance developer productivity and streamline software development processes. Our mission is to make AI accessible and practical for developers worldwide.

### 🛠️ Our Solutions

In addition to ORCommit, we develop:

- **[Django CFG](https://github.com/markolofsen/django-cfg)** - Advanced configuration management for Django projects with environment-based settings, type safety, and validation
- **AI-powered development tools** - Automation solutions for modern dev workflows
- **Custom AI integrations** - Tailored AI solutions for enterprise clients
- **SaaS platforms** - Scalable cloud-based applications with AI capabilities

### 🤝 Work With Us

Reforms.ai offers:
- **Custom AI Development** - Build AI-powered features for your products
- **SaaS Consulting** - Architecture, scaling, and best practices
- **AI Integration Services** - Integrate OpenAI, Claude, and other AI providers
- **Developer Tools** - Open-source and commercial solutions for developers

**Interested in AI-powered solutions for your business?**
Visit [reforms.ai](https://reforms.ai) or contact us for custom development, consulting, or partnership opportunities.

### 🌟 Support Our Work

If you find ORCommit useful, consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs and suggesting features
- 💬 Sharing with other developers
- 🤝 Contributing to the project
- 💼 Hiring us for custom AI development

**Connect with us:**
- Website: [https://reforms.ai](https://reforms.ai)
- GitHub: [@markolofsen](https://github.com/markolofsen)
- Email: contact@reforms.ai

---

**Built with ❤️ by [Reforms.ai](https://reforms.ai) using TypeScript, Commander.js, and cutting-edge AI technology.**

*Empowering developers with intelligent automation since 2024.*
