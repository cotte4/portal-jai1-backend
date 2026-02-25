/**
 * End-to-end test: generates an admin JWT, finds a real taxes_filed client,
 * and fires POST /v1/irs-monitor/check/:taxCaseId against the live Railway backend.
 *
 * Run: node scripts/test-real-check.js
 */
require('dotenv').config();
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const API = 'https://portal-jai1-backend-production-7bc7.up.railway.app/v1';

function post(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(`${API}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': '2',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

async function main() {
  const prisma = new PrismaClient();

  try {
    // 1. Find an admin user
    console.log('Finding admin user...');
    const admin = await prisma.user.findFirst({
      where: { role: 'admin' },
      select: { id: true, email: true, role: true, firstName: true },
    });
    if (!admin) throw new Error('No admin user found in DB');
    console.log(`  Admin: ${admin.firstName} (${admin.email})`);

    // 2. Generate JWT using the same secret + payload structure the app uses
    const token = jwt.sign(
      { sub: admin.id, email: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' },
    );
    console.log('  JWT generated ✅');

    // 3. Find a taxes_filed client with SSN and refund amount
    console.log('\nFinding a taxes_filed client...');
    const taxCase = await prisma.taxCase.findFirst({
      where: {
        caseStatus: 'taxes_filed',
        clientProfile: { ssn: { not: null } },
        OR: [
          { federalActualRefund: { not: null } },
          { estimatedRefund: { not: null } },
        ],
      },
      include: {
        clientProfile: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
        irsChecks: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!taxCase) throw new Error('No suitable taxes_filed client found (needs SSN + refund amount)');

    const name = `${taxCase.clientProfile.user.firstName} ${taxCase.clientProfile.user.lastName}`;
    const amount = taxCase.federalActualRefund ?? taxCase.estimatedRefund;
    const lastCheck = taxCase.irsChecks[0];

    console.log(`  Client: ${name}`);
    console.log(`  TaxCaseId: ${taxCase.id}`);
    console.log(`  TaxYear: ${taxCase.taxYear}`);
    console.log(`  Refund amount: $${Math.round(Number(amount))}${taxCase.federalActualRefund ? '' : ' (est.)'}`);
    console.log(`  Last check: ${lastCheck ? `${lastCheck.irsRawStatus} (${new Date(lastCheck.createdAt).toLocaleDateString()})` : 'never'}`);

    // 4. Fire the check
    console.log('\nFiring IRS check against live Railway backend...');
    console.log('  (Playwright will launch Firefox, fill IRS form, read result — ~20–30s)');
    const start = Date.now();

    const { status, body } = await post(`/irs-monitor/check/${taxCase.id}`, token);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`\n  Response in ${elapsed}s — HTTP ${status}`);

    if (status !== 200 && status !== 201) {
      console.error('  ❌ Non-success status:', JSON.stringify(body, null, 2));
      process.exit(1);
    }

    // 5. Print result
    const r = body;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  IRS Raw Status :', r.rawStatus ?? '—');
    console.log('  Mapped Status  :', r.newStatus ?? '(not recognized)');
    console.log('  Status Changed :', r.statusChanged ? `YES: ${r.previousStatus ?? 'null'} → ${r.newStatus}` : 'no');
    console.log('  Check Result   :', r.check?.checkResult ?? '—');
    console.log('  Screenshot     :', r.check?.screenshotPath ?? 'none');
    if (r.check?.irsDetails) {
      const excerpt = r.check.irsDetails.replace(r.rawStatus ?? '', '').replace(/\s+/g, ' ').trim().slice(0, 200);
      console.log('  IRS Details    :', excerpt + (excerpt.length === 200 ? '…' : ''));
    }
    if (!r.success) console.log('  Error          :', r.error ?? r.check?.errorMessage ?? '—');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
