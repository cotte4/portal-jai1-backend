/**
 * Migration Script: Encrypt Existing Sensitive Data
 *
 * This script encrypts plain text data that was stored before encryption was implemented:
 * - bankRoutingNumber
 * - bankAccountNumber
 * - turbotaxEmail
 *
 * Run with: npx ts-node scripts/migrate-encrypt-sensitive-data.ts
 *
 * IMPORTANT:
 * - Backup your database before running this script
 * - Run this only ONCE
 * - Make sure ENCRYPTION_KEY and DATABASE_URL are set in your .env
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

// Encryption configuration (must match encryption.service.ts)
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  console.error('ERROR: ENCRYPTION_KEY must be set and at least 32 characters');
  process.exit(1);
}

const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8');

/**
 * Encrypt a string using AES-256-GCM
 */
function encrypt(text: string): string {
  if (!text) return text;

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Check if a string is already encrypted (matches our format)
 */
function isEncrypted(text: string): boolean {
  if (!text) return false;

  const parts = text.split(':');
  if (parts.length !== 3) return false;

  // Check if parts look like base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return parts.every(part => base64Regex.test(part) && part.length > 0);
}

async function migrateEncryption() {
  console.log('='.repeat(60));
  console.log('Migration: Encrypt Sensitive Data');
  console.log('='.repeat(60));
  console.log('');

  // Get all client profiles
  const profiles = await prisma.clientProfile.findMany({
    select: {
      id: true,
      bankRoutingNumber: true,
      bankAccountNumber: true,
      turbotaxEmail: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  console.log(`Found ${profiles.length} client profiles to check\n`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const profile of profiles) {
    const updates: {
      bankRoutingNumber?: string;
      bankAccountNumber?: string;
      turbotaxEmail?: string;
    } = {};

    let needsUpdate = false;

    // Check bankRoutingNumber
    if (profile.bankRoutingNumber && !isEncrypted(profile.bankRoutingNumber)) {
      updates.bankRoutingNumber = encrypt(profile.bankRoutingNumber);
      needsUpdate = true;
    }

    // Check bankAccountNumber
    if (profile.bankAccountNumber && !isEncrypted(profile.bankAccountNumber)) {
      updates.bankAccountNumber = encrypt(profile.bankAccountNumber);
      needsUpdate = true;
    }

    // Check turbotaxEmail
    if (profile.turbotaxEmail && !isEncrypted(profile.turbotaxEmail)) {
      updates.turbotaxEmail = encrypt(profile.turbotaxEmail);
      needsUpdate = true;
    }

    if (needsUpdate) {
      try {
        await prisma.clientProfile.update({
          where: { id: profile.id },
          data: updates,
        });

        console.log(`✓ Encrypted data for: ${profile.user?.email || profile.id}`);

        // Log what was encrypted (without showing actual values)
        const encryptedFields = Object.keys(updates).join(', ');
        console.log(`  Fields: ${encryptedFields}`);

        updatedCount++;
      } catch (error) {
        console.error(`✗ Error updating ${profile.id}:`, error);
        errorCount++;
      }
    } else {
      skippedCount++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Migration Complete');
  console.log('='.repeat(60));
  console.log(`  Updated:  ${updatedCount} profiles`);
  console.log(`  Skipped:  ${skippedCount} profiles (already encrypted or empty)`);
  console.log(`  Errors:   ${errorCount} profiles`);
  console.log('');

  if (errorCount > 0) {
    console.log('⚠️  Some profiles failed to update. Check the errors above.');
  } else if (updatedCount > 0) {
    console.log('✅ All sensitive data has been encrypted successfully!');
  } else {
    console.log('ℹ️  No profiles needed encryption updates.');
  }
}

// Run the migration
migrateEncryption()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
