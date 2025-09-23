# Development Guide

## Project Overview

OpenRouter Commit is a TypeScript CLI tool designed with a modular, decomposed architecture that efficiently handles large Git diffs through intelligent chunking and provides AI-powered commit message generation.

## Architecture Summary

### Core Modules

1. **CLI Module** (`src/cli.ts`)
   - Entry point using Commander.js
   - Handles command parsing and validation
   - Integrates with update-notifier for version checking

2. **Config Module** (`src/modules/config.ts`) 
   - Secure configuration management with 600 file permissions
   - Global API key storage in `~/.config/orcommit.json`
   - Support for multiple providers (OpenRouter, OpenAI)

3. **Git Module** (`src/modules/git.ts`)
   - Git repository interaction and diff parsing
   - Intelligent chunk splitting while preserving context
   - Support for large file processing

4. **API Module** (`src/modules/api.ts`)
   - HTTP client with retry logic and exponential backoff
   - Queue-based request management with p-queue
   - Support for multiple LLM providers

5. **Logger Module** (`src/modules/logger.ts`)
   - Structured logging with colored output
   - Progress indicators and verbose mode
   - Different log levels (debug, info, warn, error, success)

6. **Core Orchestrator** (`src/modules/core.ts`)
   - Main business logic coordination
   - Orchestrates flow between modules
   - Handles chunked processing for large diffs

## Key Design Principles

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
- Intelligent diff chunking to stay within API token limits
- Asynchronous processing with controlled concurrency
- Git diff filtering to reduce noise

### 5. Security
- API keys stored with 600 permissions
- No sensitive data in logs or error messages
- Secure HTTP client configuration

## Development Commands

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build the project
npm run build

# Run tests
npm test
npm run test:watch
npm run test:coverage

# Code quality
npm run lint
npm run lint:fix
npm run format
npm run format:check

# Clean build artifacts
npm run clean
```

## Testing Strategy

### Unit Tests
- Each module tested in isolation
- Comprehensive mocking of external dependencies
- Focus on business logic and edge cases

### Integration Tests
- End-to-end workflow testing
- Real Git repository interaction (mocked)
- API integration testing (mocked)

### Test Structure
```
tests/
├── unit/           # Unit tests for individual modules
├── integration/    # Integration tests
└── setup.ts        # Jest configuration and mocks
```

## Configuration Management

### Config File Structure
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

## Large File Processing

### Chunking Strategy
1. **File-level chunking**: Split diff by files first
2. **Context preservation**: Maintain function/class boundaries
3. **Size limits**: Maximum 8,000 characters per chunk
4. **Intelligent merging**: Combine results from multiple chunks

### Concurrency Control
- Maximum 3 concurrent API requests
- Queue-based processing with p-queue
- Rate limiting and retry logic

## Build and Distribution

### TypeScript Compilation
- Target: ES2022 with Node.js compatibility
- Strict type checking enabled
- Source maps and declarations generated

### NPM Distribution
- Global installation support via `bin` field
- Executable permissions set automatically
- Update notifications via update-notifier

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

## Performance Considerations

### Token Optimization
- Intelligent diff filtering removes whitespace-only changes
- Context-aware chunking preserves semantic meaning
- Efficient prompt engineering for better results

### Memory Management
- Streaming processing for large diffs
- Lazy loading of Git data
- Proper cleanup of resources

### Network Efficiency
- Connection pooling with axios
- Retry logic with exponential backoff
- Request queuing to avoid rate limits

## Security Best Practices

### API Key Management
- Never log API keys
- Secure file permissions (600)
- Environment variable support

### Input Validation
- Sanitize all user inputs
- Validate Git repository state
- Type-safe configuration parsing

### Error Information
- No sensitive data in error messages
- Structured error types for debugging
- User-friendly error descriptions
