/**
 * Integration Test Setup
 *
 * This file provides utilities for setting up and tearing down
 * the test database for integration tests.
 *
 * Prerequisites:
 * 1. Docker must be running
 * 2. Run: docker-compose -f docker-compose.test.yml up -d
 * 3. Run: npx prisma db push (to create tables)
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../.env.test') });

// Prisma client for test database
let prisma: PrismaClient;

/**
 * Get the Prisma client for tests
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }
  return prisma;
}

/**
 * Setup the test database
 * - Pushes the schema to create tables
 * - Should be called once before all integration tests
 */
export async function setupTestDatabase(): Promise<void> {
  console.log('Setting up test database...');

  try {
    // Push schema to test database (creates tables without migrations)
    execSync('npx prisma db push --skip-generate', {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
      },
      stdio: 'pipe',
    });
    console.log('Test database schema pushed successfully');
  } catch (error) {
    console.error('Failed to setup test database:', error);
    throw error;
  }
}

/**
 * Clean all data from the test database
 * - Truncates all tables while preserving schema
 * - Should be called between tests or test suites
 */
export async function cleanTestDatabase(): Promise<void> {
  const client = getPrismaClient();

  // Get all table names (excluding Prisma migration tables)
  const tables = await client.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename NOT LIKE '_prisma%'
  `;

  // Disable foreign key checks, truncate all tables, re-enable
  await client.$executeRaw`SET session_replication_role = 'replica'`;

  for (const { tablename } of tables) {
    await client.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`);
  }

  await client.$executeRaw`SET session_replication_role = 'origin'`;
}

/**
 * Disconnect from the test database
 * - Should be called after all tests complete
 */
export async function disconnectTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}

/**
 * Reset the test database completely
 * - Drops all tables and recreates them
 * - Use sparingly, only when schema changes
 */
export async function resetTestDatabase(): Promise<void> {
  console.log('Resetting test database...');

  try {
    // Force reset (drops and recreates)
    execSync('npx prisma db push --force-reset --skip-generate', {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
      },
      stdio: 'pipe',
    });
    console.log('Test database reset successfully');
  } catch (error) {
    console.error('Failed to reset test database:', error);
    throw error;
  }
}

/**
 * Check if the test database is available
 */
export async function isTestDatabaseAvailable(): Promise<boolean> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for the test database to be available
 * - Useful when starting Docker container
 */
export async function waitForTestDatabase(
  maxAttempts: number = 30,
  delayMs: number = 1000,
): Promise<void> {
  console.log('Waiting for test database...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isTestDatabaseAvailable()) {
      console.log('Test database is available');
      return;
    }
    console.log(`Attempt ${attempt}/${maxAttempts} - Database not ready, waiting...`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('Test database did not become available in time');
}
