/**
 * Script: Onboard clients from Input Data 2 spreadsheet
 * Creates User + ClientProfile + TaxCase with full info including encrypted fields.
 *
 * Usage:
 *   cd portal-jai1-backend
 *   npx ts-node scripts/onboard-clients-input2.ts
 *
 * Prerequisites:
 *   - DATABASE_URL and ENCRYPTION_KEY must be set in .env
 *   - Run from the backend root directory
 */

import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// ============ Encryption (mirrors EncryptionService) ============
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  console.error('ERROR: ENCRYPTION_KEY must be set in .env and be at least 32 characters');
  process.exit(1);
}

const keyBuffer = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8');

function encrypt(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

// ============ Client Data ============
interface ClientInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string; // ISO date
  ssn: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  turbotaxEmail: string;
  turbotaxPassword: string | null;
  bankName: string;
  bankRoutingNumber: string;
  bankAccountNumber: string;
  workState: string; // CO, UT, etc.
  // Tax case data
  filingDate: string | null; // ISO date
  federalRefund: number | null;
  stateRefund: number | null;
  caseStatus: 'preparing' | 'taxes_filed';
  federalStatusNew: 'taxes_en_proceso' | null;
  stateStatusNew: 'taxes_en_proceso' | null;
  // Referral code the client was referred by (optional)
  referredByCode?: string;
}

const DEFAULT_PASSWORD = 'Jai1temp2026!'; // Temp password — client should reset on first login

const clients: ClientInput[] = [
  {
    firstName: 'Dolores',
    lastName: 'Dubovitsky Otero',
    email: 'dolodubootero@gmail.com',
    phone: '5491131642383',
    dateOfBirth: '2003-03-08', // Excel serial 37688
    ssn: '050930343',
    addressStreet: '261 Egret Way',
    addressCity: 'Weston',
    addressState: 'FL',
    addressZip: '33327',
    turbotaxEmail: 'dolodubootero@gmail.com',
    turbotaxPassword: 'Jjjai1.',
    bankName: 'Chase Bank',
    bankRoutingNumber: '102001017',
    bankAccountNumber: '705973991',
    workState: 'CO',
    filingDate: null,
    federalRefund: null,
    stateRefund: null,
    caseStatus: 'preparing',
    federalStatusNew: null,
    stateStatusNew: null,
  },
  {
    firstName: 'Milagros',
    lastName: 'Alvarez',
    email: 'Milagrosalvarezup@gmail.com',
    phone: '5491123171066',
    dateOfBirth: '2003-05-25', // Excel serial 37766
    ssn: '846165752',
    addressStreet: 'Los aromos 1270, barrio san isidro chico. Beccar',
    addressCity: 'Beccar',
    addressState: 'Buenos Aires',
    addressZip: '1643',
    turbotaxEmail: 'milagrosalvarezup@gmail.com',
    turbotaxPassword: 'Marina2527#',
    bankName: 'Chase Bank',
    bankRoutingNumber: '102001017',
    bankAccountNumber: '691981016',
    workState: 'CO',
    filingDate: null,
    federalRefund: null,
    stateRefund: null,
    caseStatus: 'preparing',
    federalStatusNew: null,
    stateStatusNew: null,
  },
  {
    firstName: 'Felipe Segundo',
    lastName: 'Carman',
    email: 'felipecarman1@gmail.com',
    phone: '5491161002139',
    dateOfBirth: '2001-09-23', // Excel serial 37157
    ssn: '733344273',
    addressStreet: 'Washington 475',
    addressCity: 'Beccar',
    addressState: 'Buenos Aires',
    addressZip: '',
    turbotaxEmail: 'felipecarman10@gmail.com',
    turbotaxPassword: null,
    bankName: 'First Bank',
    bankRoutingNumber: '107005047',
    bankAccountNumber: '2293224066',
    workState: 'CO',
    filingDate: '2026-02-15', // Excel serial 46068
    federalRefund: 1078,
    stateRefund: 706,
    caseStatus: 'taxes_filed',
    federalStatusNew: 'taxes_en_proceso',
    stateStatusNew: 'taxes_en_proceso',
  },
  {
    firstName: 'Juan Jose',
    lastName: 'Lilli de Landaburu',
    email: 'juanjolilli10@gmail.com',
    phone: '5492213533080',
    dateOfBirth: '2004-04-11', // Excel serial 38088
    ssn: '766776801',
    addressStreet: '3 Harrington Farms Way',
    addressCity: 'Shrewsbury',
    addressState: 'MA',
    addressZip: '01545',
    turbotaxEmail: 'juanjolilli10@gmail.com',
    turbotaxPassword: null,
    bankName: 'First Bank',
    bankRoutingNumber: '107005047',
    bankAccountNumber: '4751310652',
    workState: 'CO',
    filingDate: null,
    federalRefund: null,
    stateRefund: null,
    caseStatus: 'preparing',
    federalStatusNew: null,
    stateStatusNew: null,
  },
  {
    firstName: 'Isidora Paz',
    lastName: 'Seguel Figueroa',
    email: 'epfigueroau@gmail.com',
    phone: '56966597685',
    dateOfBirth: '2004-10-01', // Excel serial 38261
    ssn: '877525041',
    addressStreet: 'granada 220 casa 15 parque ingles vilumanque',
    addressCity: 'Concepcion',
    addressState: 'Bio Bio',
    addressZip: '4081025',
    turbotaxEmail: 'epfigueroau@gmail.com',
    turbotaxPassword: null,
    bankName: 'Wells Fargo',
    bankRoutingNumber: '124002971',
    bankAccountNumber: '2198446292',
    workState: 'UT',
    filingDate: null,
    federalRefund: null,
    stateRefund: null,
    caseStatus: 'preparing',
    federalStatusNew: null,
    stateStatusNew: null,
  },
];

async function onboardClient(client: ClientInput): Promise<void> {
  const emailLower = client.email.toLowerCase().trim();

  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { email: emailLower },
  });

  if (existing) {
    console.log(`  SKIP: ${client.firstName} ${client.lastName} — email ${emailLower} already exists`);
    return;
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // Encrypt sensitive fields
  const encryptedSsn = encrypt(client.ssn);
  const encryptedAddress = encrypt(client.addressStreet);
  const encryptedTurbotaxEmail = encrypt(client.turbotaxEmail);
  const encryptedTurbotaxPassword = client.turbotaxPassword ? encrypt(client.turbotaxPassword) : null;
  const encryptedRouting = encrypt(client.bankRoutingNumber);
  const encryptedAccount = encrypt(client.bankAccountNumber);

  // Create everything in a transaction
  await prisma.$transaction(async (tx) => {
    // 1. Create User
    const user = await tx.user.create({
      data: {
        email: emailLower,
        passwordHash,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone,
        role: UserRole.client,
        isActive: true,
        emailVerified: true, // Script-onboarded users don't need email verification
        referredByCode: client.referredByCode || null,
      },
    });

    // 2. Create ClientProfile
    const profile = await tx.clientProfile.create({
      data: {
        userId: user.id,
        ssn: encryptedSsn,
        dateOfBirth: new Date(client.dateOfBirth),
        addressStreet: encryptedAddress,
        addressCity: client.addressCity,
        addressState: client.addressState,
        addressZip: client.addressZip,
        addressCountry: 'USA',
        turbotaxEmail: encryptedTurbotaxEmail,
        turbotaxPassword: encryptedTurbotaxPassword,
        profileComplete: true,
        isDraft: false,
        isReadyToPresent: false,
        isIncomplete: true,
      },
    });

    // 3. Create TaxCase
    const taxYear = 2026;
    const estimatedRefund = (client.federalRefund || 0) + (client.stateRefund || 0);

    const taxCaseData: any = {
      clientProfileId: profile.id,
      taxYear,
      workState: client.workState,
      bankName: client.bankName,
      bankRoutingNumber: encryptedRouting,
      bankAccountNumber: encryptedAccount,
      caseStatus: client.caseStatus,
      caseStatusChangedAt: new Date(),
      statusUpdatedAt: new Date(),
    };

    if (client.caseStatus === 'taxes_filed') {
      taxCaseData.taxesFiled = true;
      taxCaseData.taxesFiledAt = client.filingDate ? new Date(client.filingDate) : new Date();
      taxCaseData.federalStatusNew = client.federalStatusNew;
      taxCaseData.federalStatusNewChangedAt = client.filingDate ? new Date(client.filingDate) : new Date();
      taxCaseData.stateStatusNew = client.stateStatusNew;
      taxCaseData.stateStatusNewChangedAt = client.filingDate ? new Date(client.filingDate) : new Date();
      taxCaseData.federalActualRefund = client.federalRefund;
      taxCaseData.stateActualRefund = client.stateRefund;
      taxCaseData.estimatedRefund = estimatedRefund;
    }

    await tx.taxCase.create({ data: taxCaseData });

    console.log(`  OK: ${client.firstName} ${client.lastName} (${emailLower}) — ${client.caseStatus}`);
  });
}

async function main() {
  console.log('=== Onboarding clients from Input Data 2 ===');
  console.log(`Default password: ${DEFAULT_PASSWORD}`);
  console.log(`Clients to process: ${clients.length}\n`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (const client of clients) {
    try {
      const emailLower = client.email.toLowerCase().trim();
      const existing = await prisma.user.findUnique({ where: { email: emailLower } });
      if (existing) {
        console.log(`  SKIP: ${client.firstName} ${client.lastName} — already exists`);
        skipped++;
        continue;
      }
      await onboardClient(client);
      success++;
    } catch (error: any) {
      console.error(`  FAIL: ${client.firstName} ${client.lastName} — ${error.message}`);
      failed++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Created: ${success}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
