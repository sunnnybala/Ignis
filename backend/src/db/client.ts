import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString =
	process.env.DATABASE_URL || 'postgres://postgres:Sunnybala@5018@localhost:5432/ignis_mvp';

export const pool = new Pool({ connectionString, max: 10 });
export const db = drizzle(pool);


