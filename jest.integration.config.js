/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/integration/**/*.test.ts'],
  clearMocks: true,
  testTimeout: 60000,
  setupFiles: ['<rootDir>/src/__tests__/integration/setup/loadEnv.ts'],
};
