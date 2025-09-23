/**
 * OpenRouter Commit - AI-powered Git commit message generator
 * 
 * A TypeScript CLI tool for generating meaningful commit messages using
 * OpenRouter and OpenAI APIs with efficient chunked processing for large files.
 * 
 * @author Mark Olofsen
 * @version 1.0.0
 */

// Export main modules
export { ConfigManager, configManager } from './modules/config.js';
export { GitManager, gitManager } from './modules/git.js';
export { ApiManager, apiManager } from './modules/api.js';
export { CoreOrchestrator, coreOrchestrator } from './modules/core.js';
export { Logger, logger, ProgressIndicator } from './modules/logger.js';
export { CliApplication } from './cli.js';

// Export types
export * from './types/index.js';

// Export utilities
export * from './utils/index.js';
