const SUPABASE_URL = "https://zpkearbtwumtbdgtezhq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_F5IhJCYpGKthPomfbpMhrw_tjJNR0ed"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
