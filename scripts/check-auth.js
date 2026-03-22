require('dotenv').config({ path: './api/.env' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkAuth() {
  console.log("Checking for recently logged in users...");
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  // Sort by last_sign_in_at
  const sorted = users
    .filter(u => u.last_sign_in_at)
    .sort((a, b) => new Date(b.last_sign_in_at) - new Date(a.last_sign_in_at))
    .slice(0, 5);
    
  console.log("Recently signed in users:");
  sorted.forEach(u => {
    console.log(`- ID: ${u.id}, Email: ${u.email}, Last Sign In: ${u.last_sign_in_at}`);
  });
}

checkAuth();
