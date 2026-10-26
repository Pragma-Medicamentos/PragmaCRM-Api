/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/'],
  setupFiles: [
    '<rootDir>/src/__tests__/setup/testEnv.ts',
    '<rootDir>/src/__tests__/setup/silenceLogs.ts',
  ],
  clearMocks: true,
};
