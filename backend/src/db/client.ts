import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString =
	process.env.DATABASE_URL || 'postgres://postgres:Sunnybala@5018@localhost:5432/ignis_mvp';

// Railway Postgres typically requires SSL. `pg` won't always infer this reliably from the URL,
// so we enable SSL automatically for Railway/prod URLs while keeping local dev working.
const shouldUseSsl =
	process.env.PGSSLMODE === 'require' ||
	/sslmode=require/i.test(connectionString) ||
	/\.rlwy\.net\b/i.test(connectionString) ||
	/railway/i.test(connectionString) ||
	process.env.NODE_ENV === 'production';

export const pool = new Pool({
	connectionString,
	max: 10,
	ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool);


