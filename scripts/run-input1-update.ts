/**
 * Runs the Input Data 1 SQL updates via Prisma.
 * Usage: npx ts-node scripts/run-input1-update.ts
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

interface ClientUpdate {
  name: string;
  firstNameMatch: string;
  lastNameMatch: string;
  matchMode: 'exact' | 'like';
  filingDate: string | null;
  federalRefund: number | null;
  stateRefund: number | null;
  caseStatus: 'taxes_filed' | 'preparing';
}

const clients: ClientUpdate[] = [
  { name: 'Maria Constanza Farre Abelenda', firstNameMatch: 'maria constanza', lastNameMatch: 'farre abelenda', matchMode: 'exact', filingDate: '2026-01-27', federalRefund: 1215, stateRefund: 738, caseStatus: 'taxes_filed' },
  { name: 'Ariana Sangiuliano', firstNameMatch: 'ariana', lastNameMatch: 'sangiuliano', matchMode: 'exact', filingDate: '2026-01-27', federalRefund: 1060, stateRefund: 750, caseStatus: 'taxes_filed' },
  { name: 'Luis Guerrero', firstNameMatch: 'luis', lastNameMatch: 'guerrero', matchMode: 'exact', filingDate: '2026-01-27', federalRefund: 1210, stateRefund: 606, caseStatus: 'taxes_filed' },
  { name: 'Bruno Héctor Alejandro Vergara Vidal', firstNameMatch: '%', lastNameMatch: '%vergara vidal%', matchMode: 'like', filingDate: '2026-01-28', federalRefund: 1903, stateRefund: 538, caseStatus: 'taxes_filed' },
  { name: 'Vanesa Enriqueta Rivera Peñaloza', firstNameMatch: '%', lastNameMatch: '%rivera pe%', matchMode: 'like', filingDate: '2026-01-27', federalRefund: 1346, stateRefund: 693, caseStatus: 'taxes_filed' },
  { name: 'Juan Ignacio Alonso', firstNameMatch: '%juan ignacio%', lastNameMatch: 'alonso', matchMode: 'like', filingDate: '2026-01-27', federalRefund: 171, stateRefund: 357, caseStatus: 'taxes_filed' },
  { name: 'Belen Curutchet', firstNameMatch: '%', lastNameMatch: 'curutchet', matchMode: 'like', filingDate: '2026-02-03', federalRefund: 963, stateRefund: 448, caseStatus: 'taxes_filed' },
  { name: 'Manuel Sascaro', firstNameMatch: '%', lastNameMatch: 'sascaro', matchMode: 'like', filingDate: '2026-02-03', federalRefund: 543, stateRefund: 176, caseStatus: 'taxes_filed' },
  { name: 'Valentino Garcia Crocitta', firstNameMatch: '%', lastNameMatch: '%garcia crocitta%', matchMode: 'like', filingDate: '2026-02-03', federalRefund: 1338, stateRefund: 429, caseStatus: 'taxes_filed' },
  { name: 'Lautaro Ezequiel Perez', firstNameMatch: '%lautaro%', lastNameMatch: 'perez', matchMode: 'like', filingDate: '2026-02-10', federalRefund: 1542, stateRefund: 693, caseStatus: 'taxes_filed' },
  { name: 'Juan Cruz Ceballos', firstNameMatch: '%', lastNameMatch: 'ceballos', matchMode: 'like', filingDate: '2026-02-08', federalRefund: 1543, stateRefund: 395, caseStatus: 'taxes_filed' },
  { name: 'Lara Romero', firstNameMatch: 'lara', lastNameMatch: 'romero', matchMode: 'exact', filingDate: '2026-02-15', federalRefund: 1226, stateRefund: 597, caseStatus: 'taxes_filed' },
  { name: 'Segundo Soto Ansay', firstNameMatch: '%', lastNameMatch: '%soto ansay%', matchMode: 'like', filingDate: '2026-02-10', federalRefund: 1194, stateRefund: 395, caseStatus: 'taxes_filed' },
  { name: 'Aisha Mariam Auday Cruz', firstNameMatch: '%aisha%', lastNameMatch: '%auday%', matchMode: 'like', filingDate: '2026-02-12', federalRefund: 1035, stateRefund: 703, caseStatus: 'taxes_filed' },
  { name: 'Francisco Villamayor', firstNameMatch: '%', lastNameMatch: 'villamayor', matchMode: 'like', filingDate: '2026-02-12', federalRefund: 508, stateRefund: 669, caseStatus: 'taxes_filed' },
  { name: 'Otto Kraus', firstNameMatch: '%', lastNameMatch: 'kraus', matchMode: 'like', filingDate: null, federalRefund: null, stateRefund: null, caseStatus: 'preparing' },
  { name: 'Lara Mariam Auday Cruz', firstNameMatch: '%lara%', lastNameMatch: '%auday%', matchMode: 'like', filingDate: '2026-02-13', federalRefund: 583, stateRefund: 698, caseStatus: 'taxes_filed' },
  { name: 'Martina Busco Saldias', firstNameMatch: '%', lastNameMatch: '%busco saldias%', matchMode: 'like', filingDate: '2026-02-12', federalRefund: 1038, stateRefund: 341, caseStatus: 'taxes_filed' },
  { name: 'Tomas Martinez Aguero', firstNameMatch: '%', lastNameMatch: '%martinez aguero%', matchMode: 'like', filingDate: '2026-02-10', federalRefund: 1387, stateRefund: 741, caseStatus: 'taxes_filed' },
  { name: 'Ana Sara Pasini Bistolfi', firstNameMatch: '%', lastNameMatch: '%pasini%', matchMode: 'like', filingDate: '2026-02-10', federalRefund: 1347, stateRefund: 356, caseStatus: 'taxes_filed' },
  { name: 'Luisina Mileti', firstNameMatch: '%', lastNameMatch: 'mileti', matchMode: 'like', filingDate: '2026-02-15', federalRefund: 589, stateRefund: 407, caseStatus: 'preparing' },
];

async function findClientProfile(c: ClientUpdate): Promise<string | null> {
  let where: any;
  if (c.matchMode === 'exact') {
    where = {
      user: {
        firstName: { equals: c.firstNameMatch, mode: 'insensitive' },
        lastName: { equals: c.lastNameMatch, mode: 'insensitive' },
      },
    };
  } else {
    // Use contains/startsWith for LIKE patterns
    const firstCond: any = {};
    const lastCond: any = {};

    if (c.firstNameMatch !== '%') {
      const clean = c.firstNameMatch.replace(/%/g, '');
      firstCond.contains = clean;
      firstCond.mode = 'insensitive';
    }

    if (c.lastNameMatch.startsWith('%') && c.lastNameMatch.endsWith('%')) {
      const clean = c.lastNameMatch.replace(/%/g, '');
      lastCond.contains = clean;
      lastCond.mode = 'insensitive';
    } else {
      const clean = c.lastNameMatch.replace(/%/g, '');
      lastCond.equals = clean;
      lastCond.mode = 'insensitive';
    }

    where = {
      user: {
        ...(Object.keys(firstCond).length > 0 ? { firstName: firstCond } : {}),
        ...(Object.keys(lastCond).length > 0 ? { lastName: lastCond } : {}),
      },
    };
  }

  const profile = await prisma.clientProfile.findFirst({
    where,
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });

  return profile?.id || null;
}

async function updateClient(c: ClientUpdate): Promise<'updated' | 'not_found' | 'no_taxcase'> {
  const profileId = await findClientProfile(c);
  if (!profileId) return 'not_found';

  // Find the latest tax case (2025 or 2026)
  const taxCase = await prisma.taxCase.findFirst({
    where: { clientProfileId: profileId },
    orderBy: { taxYear: 'desc' },
  });

  if (!taxCase) return 'no_taxcase';

  const now = new Date();
  const estimatedRefund = (c.federalRefund || 0) + (c.stateRefund || 0);

  if (c.caseStatus === 'taxes_filed') {
    const filingDateObj = c.filingDate ? new Date(c.filingDate) : now;
    await prisma.taxCase.update({
      where: { id: taxCase.id },
      data: {
        caseStatus: 'taxes_filed',
        caseStatusChangedAt: filingDateObj,
        taxesFiled: true,
        taxesFiledAt: filingDateObj,
        federalStatusNew: 'taxes_en_proceso',
        federalStatusNewChangedAt: filingDateObj,
        stateStatusNew: 'taxes_en_proceso',
        stateStatusNewChangedAt: filingDateObj,
        federalActualRefund: c.federalRefund,
        stateActualRefund: c.stateRefund,
        estimatedRefund,
        statusUpdatedAt: now,
      },
    });
  } else {
    // preparing
    const updateData: any = {
      caseStatus: 'preparing',
      caseStatusChangedAt: now,
      statusUpdatedAt: now,
    };
    if (c.federalRefund != null) updateData.federalActualRefund = c.federalRefund;
    if (c.stateRefund != null) updateData.stateActualRefund = c.stateRefund;
    if (estimatedRefund > 0) updateData.estimatedRefund = estimatedRefund;

    await prisma.taxCase.update({
      where: { id: taxCase.id },
      data: updateData,
    });
  }

  return 'updated';
}

async function main() {
  console.log('=== Input Data 1: Updating existing client TaxCases ===\n');

  let updated = 0;
  let notFound = 0;
  let noTaxCase = 0;

  for (const c of clients) {
    const result = await updateClient(c);
    if (result === 'updated') {
      console.log(`  OK: ${c.name} — ${c.caseStatus}${c.federalRefund ? ` (fed $${c.federalRefund} / state $${c.stateRefund})` : ''}`);
      updated++;
    } else if (result === 'not_found') {
      console.log(`  NOT FOUND: ${c.name} — no matching user in DB`);
      notFound++;
    } else {
      console.log(`  NO TAXCASE: ${c.name} — user found but no 2026 tax case`);
      noTaxCase++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Updated:    ${updated}`);
  console.log(`  Not found:  ${notFound}`);
  console.log(`  No taxcase: ${noTaxCase}`);
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
