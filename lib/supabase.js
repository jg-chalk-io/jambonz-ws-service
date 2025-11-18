const {createClient} = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Aircall database client (separate database for Aircall webhook data)
let aircallSupabase = null;
if (process.env.AIRCALL_SUPABASE_URL && process.env.AIRCALL_SUPABASE_SERVICE_KEY) {
  aircallSupabase = createClient(
    process.env.AIRCALL_SUPABASE_URL,
    process.env.AIRCALL_SUPABASE_SERVICE_KEY
  );
}

module.exports = {supabase, aircallSupabase};
