/**
 * Jest test setup file
 */

// Mock console methods to reduce test noise
const originalConsole = { ...console };
global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

// Mock process.exit to prevent tests from terminating
const mockExit = jest.fn();
const originalExit = process.exit;
Object.defineProperty(process, 'exit', {
  value: mockExit,
  writable: true,
});

// Mock environment variables
process.env.NODE_ENV = 'test';
process.env.CI = 'true'; // Disable interactive prompts

// Mock timers for cache TTL tests
jest.useFakeTimers();

// Global test utilities
(global as any).advanceTime = (ms: number) => {
  jest.advanceTimersByTime(ms);
};

(global as any).flushPromises = () => new Promise(resolve => setImmediate(resolve));

// Set up global mocks for external dependencies
beforeAll(() => {
  // Suppress update-notifier in tests
  jest.doMock('update-notifier', () => () => ({
    notify: jest.fn(),
  }));
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Restore original implementations after all tests
afterAll(() => {
  global.console = originalConsole;
  process.exit = originalExit;
  jest.useRealTimers();
});

// Add custom matchers for better assertions
expect.extend({
  toBeValidCommitMessage(received: string) {
    const conventionalCommitRegex = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?!?:\s.+/;
    const pass = conventionalCommitRegex.test(received) && received.length <= 72;
    
    return {
      message: () => 
        pass 
          ? `Expected "${received}" not to be a valid commit message`
          : `Expected "${received}" to be a valid commit message (conventional commits format, ≤72 chars)`,
      pass,
    };
  },
  
  toBeApiKey(received: string) {
    const pass = typeof received === 'string' && received.length >= 10 && received.includes('-');
    
    return {
      message: () =>
        pass
          ? `Expected "${received}" not to be a valid API key`
          : `Expected "${received}" to be a valid API key format`,
      pass,
    };
  },
});

// Types are declared in tests/types.d.ts
