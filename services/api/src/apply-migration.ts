import fs from 'fs';
import path from 'path';
// Load environment using shared loader (dynamic require to avoid TS rootDir issues)
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const loadEnvPath = path.resolve(__dirname, '..', '..', '..', 'scripts', 'load-env.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const loadEnvMod = require(loadEnvPath);
    if (loadEnvMod && typeof loadEnvMod.loadEnv === 'function') {
        loadEnvMod.loadEnv(path.resolve(__dirname, '..', '..'));
    }
} catch (err) {
    // ignore
}

if (process.env.DATABASE_URL) {
    try {
        console.log('DATABASE_URL host:', new URL(process.env.DATABASE_URL).host);
    } catch {}
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
