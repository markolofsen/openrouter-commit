export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/tests/unit/**/*.test.ts',
    '**/tests/integration/**/*.test.ts',
    '**/src/**/*.test.ts'
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
  testTimeout: 10000,
};
