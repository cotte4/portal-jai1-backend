/**
 * Push Prisma schema to test database
 *
 * This script sets the DATABASE_URL to the test database
 * and runs prisma db push.
 *
 * Usage: npm run test:db:push
 */

import { execSync } from 'child_process';
import * as path from 'path';

// Test database URL
const TEST_DATABASE_URL = 'postgresql://test_user:test_password@localhost:5433/portal_jai1_test';

console.log('Pushing Prisma schema to test database...');
console.log('Database URL:', TEST_DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

try {
  execSync('npx prisma db push --skip-generate', {
    cwd: path.join(__dirname, '../..'),
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: 'inherit',
  });
  console.log('\nSchema pushed successfully!');
} catch (error) {
  console.error('\nFailed to push schema:', error);
  process.exit(1);
}
