import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { createNotificationsHandler } from './handler.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const handler = createNotificationsHandler({
  createAdminClient: () => {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }

    return createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as any;
  },
});

Deno.serve((req: Request) => handler(req));
