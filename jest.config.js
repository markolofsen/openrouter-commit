export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/tests/unit/**/*.test.ts',
    '**/src/**/*.test.ts'
    // Integration tests excluded by default (run with: npm test -- tests/integration)
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/cli.ts',
    '!src/types/**/*'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        rootDir: '.',
        outDir: '.jest-cache',
        skipLibCheck: true,
        noUncheckedIndexedAccess: false,
      },
    },
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^chalk$': '<rootDir>/tests/__mocks__/chalk.ts'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(p-queue|eventemitter3)/)'
  ],
  testTimeout: 10000,
};
