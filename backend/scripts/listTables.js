// Debug helper: lists tables in the connected database's public schema.
// Usage (from backend/):
//   node scripts/listTables.js
/* eslint-disable no-console */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const sp = await c.query('show search_path');
    console.log('search_path:', sp.rows?.[0]?.search_path);

    const r = await c.query(
      "select table_schema, table_name from information_schema.tables where table_type='BASE TABLE' and table_schema not in ('pg_catalog','information_schema') order by table_schema, table_name",
    );
    console.log('tables:', r.rows);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


