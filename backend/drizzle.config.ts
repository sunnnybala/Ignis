import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	out: './drizzle',
	schema: './src/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: {
		// Fallback helps 'generate' run even if .env isn't set yet
		url: process.env.DATABASE_URL || 'postgres://postgres:Sunnybala@5018@localhost:5432/ignis_mvp',
	},
	verbose: true,
	strict: true,
});


