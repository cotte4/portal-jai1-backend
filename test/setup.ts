/**
 * Global test setup for Jest
 * This file runs before all tests
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes!!!!';
process.env.FRONTEND_URL = 'http://localhost:4200';
process.env.DATABASE_URL = 'postgresql://test_user:test_password@localhost:5433/portal_jai1_test';

// Increase timeout for slower CI environments
jest.setTimeout(30000);

// Suppress console logs during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   // Keep error for debugging
//   error: console.error,
// };

// Clean up after all tests
afterAll(async () => {
  // Add any global cleanup here
});
