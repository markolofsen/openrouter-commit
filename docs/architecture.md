# Architecture

ORCommit is built with a modular, decomposed architecture using TypeScript.

---

## Core Modules

### CLI Module (`src/cli.ts`)

- Entry point using Commander.js
- Handles command parsing and validation
- Integrates with update-notifier for version checking
- Uses @clack/prompts for elegant interactive UI

### Config Module (`src/modules/config.ts`)

- Secure configuration management with 600 file permissions
- Global API key storage in `~/.config/orcommit.json`
- Support for multiple providers (OpenRouter, OpenAI)
- Environment variable fallback

### Git Module (`src/modules/git.ts`)

- Git repository interaction and diff parsing
- Intelligent chunk splitting while preserving context
- Support for large file processing
- Dependency directory detection

### API Module (`src/modules/api.ts`)

- HTTP client with retry logic and exponential backoff
- Queue-based request management with p-queue
- Support for multiple LLM providers
- Timeout protection and error handling

### Logger Module (`src/modules/logger.ts`)

- Structured logging with colored output
- Progress indicators and verbose mode
- Different log levels (debug, info, warn, error, success)
- Timing information

### Tokenizer Module (`src/modules/tokenizer.ts`)

- Token-aware chunking using tiktoken
- Model-specific token limit handling
- Accurate token counting for cost optimization
- Dynamic chunk sizing

### Cache Module (`src/modules/cache.ts`)

- Two-level caching (memory + disk)
- TTL-based expiration (24h default)
- Automatic cleanup and statistics
- Content-based cache keys (SHA-256)

### Diff Filter Module (`src/modules/diff-filter.ts`)

- Smart filtering of generated files and irrelevant changes
- 100+ patterns for auto-generated files
- Relevancy scoring to focus on meaningful changes
- Whitespace-only change filtering

### Secret Scanner Module (`src/modules/secret-scanner.ts`)

- Integration with Gitleaks for secret detection
- Binary auto-download and caching
- Support for `.gitleaksignore`
- Critical vs warning severity levels

### Core Orchestrator (`src/modules/core.ts`)

- Main business logic coordination
- Orchestrates flow between modules
- Handles chunked processing for large diffs
- Phase-based progress reporting

---

## Design Principles

### 1. Modular Architecture

- Each module has a single responsibility
- Clean interfaces between modules
- Easy to test and maintain

### 2. Type Safety

- Full TypeScript coverage with strict mode
- Comprehensive error types with proper inheritance
- Type-safe configuration management

### 3. Error Handling

- Structured error types (`ConfigError`, `GitError`, `ApiError`, `NetworkError`)
- Retry logic with exponential backoff
- Graceful degradation and user-friendly error messages

### 4. Performance Optimization

- Token-aware diff chunking for API limits
- Asynchronous processing with controlled concurrency
- Two-level caching for instant responses

### 5. Security First

- API keys stored with 600 permissions
- No sensitive data in logs or error messages
- Mandatory secret scanning before commits

---

## Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI       │────▶│   Config    │────▶│   Git       │
│   Module    │     │   Module    │     │   Module    │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Logger    │◀────│   Core      │◀────│   Diff      │
│   Module    │     │   Module    │     │   Filter    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌───────────┐ ┌───────────┐ ┌───────────┐
       │  Secret   │ │ Tokenizer │ │   Cache   │
       │  Scanner  │ │  Module   │ │   Module  │
       └───────────┘ └───────────┘ └───────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   API       │
                    │   Module    │
                    └─────────────┘
```

---

## Processing Pipeline

1. **Input Validation** - Verify git repository and staged changes
2. **Diff Extraction** - Get staged changes from git
3. **Secret Scanning** - Check for credentials and secrets
4. **Diff Filtering** - Remove noise and irrelevant changes
5. **Tokenization** - Chunk diff based on model token limits
6. **Cache Check** - Return cached result if available
7. **API Request** - Send to AI provider for message generation
8. **Response Processing** - Clean and format the commit message
9. **User Confirmation** - Interactive approval or regeneration
10. **Commit Creation** - Execute git commit
11. **Optional Push** - Push to remote if requested

---

## Technology Stack

- **Runtime**: Node.js >= 16.0.0
- **Language**: TypeScript (strict mode)
- **CLI Framework**: Commander.js
- **UI**: @clack/prompts
- **HTTP Client**: Axios
- **Tokenization**: tiktoken
- **Secret Scanning**: Gitleaks
- **Concurrency**: p-queue
- **Testing**: Jest

---

## Build & Distribution

### TypeScript Compilation

- Target: ES2022 with Node.js compatibility
- Strict type checking enabled
- Source maps and declarations generated

### NPM Distribution

- Global installation support via `bin` field
- Executable permissions set automatically
- Update notifications via update-notifier

---

## Extension Points

### Adding New Providers

1. Extend the `ApiManager` with new provider logic
2. Update configuration types and defaults
3. Add provider-specific error handling

### Custom Commit Formats

1. Extend the prompt generation in `CoreOrchestrator`
2. Add new format options to configuration
3. Update CLI validation

### Additional Git Integration

1. Extend `GitManager` with new Git operations
2. Add support for different diff formats
3. Implement file watching for auto-commits
