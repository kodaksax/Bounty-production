import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables before importing pool
dotenv.config();
if (!process.env.DATABASE_URL) {
    const rootEnv = path.resolve(__dirname, '../../../.env');
    console.log(`Checking for root .env at ${rootEnv}`);
    if (fs.existsSync(rootEnv)) {
        dotenv.config({ path: rootEnv });
        console.log('Loaded root .env');
    } else {
        console.log('Root .env not found');
    }
}
console.log('DATABASE_URL length:', process.env.DATABASE_URL?.length || 0);
if (process.env.DATABASE_URL) {
    console.log('DATABASE_URL host:', new URL(process.env.DATABASE_URL).host);
}

// Import pool after env is loaded
const { pool } = require('./db/connection');

async function applyMigration() {
    const migrationPath = path.resolve(__dirname, '../../../supabase/migrations/20260115_enhance_webhook_tracking.sql');
    console.log(`Reading migration from ${migrationPath}...`);

    const sql = fs.readFileSync(migrationPath, 'utf8');

    const client = await pool.connect();
    try {
        console.log(`Executing migration script (first 200 chars): ${sql.substring(0, 200)}...`);
        await client.query(sql);
        console.log('✅ Migration applied successfully');
    } catch (error) {
        console.error('❌ Failed to apply migration:', error);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

applyMigration();
