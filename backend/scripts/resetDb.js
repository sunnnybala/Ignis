// Wipes the database by dropping/recreating the public schema, then exits.
// Intended for local development only.
//
// Safety:
// - Requires CONFIRM_DB_RESET=YES
// - Refuses to run against likely-remote DB URLs unless ALLOW_REMOTE_DB_RESET=YES
//
// Usage:
//   CONFIRM_DB_RESET=YES npm run db:reset
//
// On Windows PowerShell:
//   $env:CONFIRM_DB_RESET="YES"; npm run db:reset
//
// To override remote protection (NOT recommended):
//   $env:CONFIRM_DB_RESET="YES"; $env:ALLOW_REMOTE_DB_RESET="YES"; npm run db:reset

/* eslint-disable no-console */

// Load backend/.env automatically for npm scripts (npm does not auto-load .env).
try {
  const path = require('node:path');
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // ignore if dotenv isn't available for some reason
}

const { Client } = require('pg');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function looksRemote(url) {
  const s = String(url || '').toLowerCase();
  // Common hosted indicators
  if (s.includes('.rlwy.net') || s.includes('railway')) return true;
  if (s.includes('supabase.co')) return true;
  // If it's not obviously local, treat as remote by default.
  const localHints = ['localhost', '127.0.0.1', 'host.docker.internal'];
  return !localHints.some((h) => s.includes(h));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) die('resetDb: DATABASE_URL is not set');

  if (String(process.env.CONFIRM_DB_RESET || '') !== 'YES') {
    die('resetDb: refusing to run without CONFIRM_DB_RESET=YES');
  }

  const remote = looksRemote(url);
  if (remote && String(process.env.ALLOW_REMOTE_DB_RESET || '') !== 'YES') {
    die(
      'resetDb: refusing to run against a non-local DATABASE_URL.\n' +
        'If you are absolutely sure, set ALLOW_REMOTE_DB_RESET=YES (not recommended).',
    );
  }

  const client = new Client({ connectionString: url });
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'db.reset.start',
      remote,
    }),
  );

  await client.connect();
  try {
    // Drop and recreate schemas (wipes all tables, enums, indexes, etc.)
    // Important: Drizzle stores migration state in a separate "drizzle" schema by default.
    // If we don't drop it, drizzle-kit will think migrations are already applied and will not recreate tables.
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('COMMIT');

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'db.reset.done',
      }),
    );
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'db.reset.failed',
      message: String(e && e.message ? e.message : e),
    }),
  );
  process.exit(1);
});


