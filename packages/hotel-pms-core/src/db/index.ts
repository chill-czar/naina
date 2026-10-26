import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../schema';
import path from 'path';
import * as dotenv from 'dotenv';

// Load .env from local package or monorepo root
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in environment variables');
}

const connectionString = process.env.DATABASE_URL;

export const client = postgres(connectionString, { prepare: false });
export const db = drizzle(client, { schema });

export type Database = typeof db;
