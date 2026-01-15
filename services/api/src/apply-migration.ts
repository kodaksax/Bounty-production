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
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

    const client = await pool.connect();
    try {
        for (const statement of statements) {
            console.log(`Executing statement: ${statement.substring(0, 50)}...`);
            await client.query(statement);
        }
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
