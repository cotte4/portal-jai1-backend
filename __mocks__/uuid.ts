/**
 * Manual mock for uuid module
 * This is used by Jest to replace the ESM uuid module in tests
 */

let counter = 0;

export const v4 = jest.fn(() => `mock-uuid-${++counter}`);

export default {
  v4,
};
