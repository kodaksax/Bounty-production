#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load .env.production if present, otherwise fallback to any .env
const defaultEnvPath = path.join(__dirname, '..', '.env.production');
if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath });
} else {
  dotenv.config();
}

function getEnv(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return undefined;
}

const SUPABASE_URL = getEnv('SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'REACT_APP_SUPABASE_URL');
const SUPABASE_ANON = getEnv('SUPABASE_ANON_KEY', 'SUPABASE_ANON', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY');

const out = {
  SUPABASE_URL: SUPABASE_URL || '',
  SUPABASE_ANON: SUPABASE_ANON || ''
};

const outPath = path.join(__dirname, '..', 'docs', 'auth', 'callback', 'config.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath);
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('Warning: SUPABASE_URL or SUPABASE_ANON not provided. The generated config will be empty.');
}
