export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        outDir: '.jest-cache',
        skipLibCheck: true,
        noUncheckedIndexedAccess: false,
      },
    },
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
    }]
  },
  testMatch: [
    '**/tests/unit/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/cli.ts',
    '!src/types/**/*'
  ],
  coverageDirectory: 'coverage',
  testTimeout: 10000,
};
