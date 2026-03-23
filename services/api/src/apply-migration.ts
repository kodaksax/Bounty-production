import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables (prefer .env.<NODE_ENV> then fallbacks)
{
    const envName = process.env.NODE_ENV ? `.env.${String(process.env.NODE_ENV).toLowerCase()}` : '.env';
    const serviceEnv = path.resolve(__dirname, '..', '..', envName);
    if (fs.existsSync(serviceEnv)) {
        dotenv.config({ path: serviceEnv });
        console.log(`[env] Loaded environment from ${serviceEnv}`);
    } else {
        const rootEnv = path.resolve(process.cwd(), envName);
        if (fs.existsSync(rootEnv)) {
            dotenv.config({ path: rootEnv });
            console.log(`[env] Loaded environment from ${rootEnv}`);
        } else {
            const local = dotenv.config();
            if (local.error) {
                const rootPlain = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(rootPlain)) {
                    dotenv.config({ path: rootPlain });
                    console.log(`[env] Loaded environment from ${rootPlain}`);
                } else {
                    console.warn('[env] No .env found; continuing with existing environment');
                }
            }
        }
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
