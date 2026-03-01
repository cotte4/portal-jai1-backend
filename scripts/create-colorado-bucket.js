/**
 * One-time script: creates the `colorado-screenshots` private bucket in Supabase Storage.
 * Run from the backend directory: node scripts/create-colorado-bucket.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error('❌  SUPABASE_URL or SUPABASE_SERVICE_KEY missing from .env');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log('Creating colorado-screenshots bucket...');

  const { data, error } = await supabase.storage.createBucket('colorado-screenshots', {
    public: false,
    allowedMimeTypes: ['image/png'],
    fileSizeLimit: 5 * 1024 * 1024, // 5 MB max per screenshot
  });

  if (error) {
    if (error.message.includes('already exists')) {
      console.log('✅  Bucket already exists — nothing to do.');
    } else {
      console.error('❌  Failed to create bucket:', error.message);
      process.exit(1);
    }
  } else {
    console.log('✅  Bucket created:', data.name);
  }

  // Verify it's there
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.warn('⚠️  Could not verify bucket list:', listErr.message);
  } else {
    const found = buckets.find(b => b.name === 'colorado-screenshots');
    if (found) {
      console.log(`✅  Verified: colorado-screenshots exists (public: ${found.public})`);
    } else {
      console.warn('⚠️  Bucket not found in list after creation — check Supabase dashboard.');
    }
  }
}

main();
