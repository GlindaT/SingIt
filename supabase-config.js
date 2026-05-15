const SUPABASE_URL = "https://zpkearbtwumtbdgtezhq.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwa2VhcmJ0d3VtdGJkZ3RlemhxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODgxMTMxOSwiZXhwIjoyMDk0Mzg3MzE5fQ.6VqFxfn-6-ktLRxrbkcUntIYgGAVdevgQmm3D-c7zC8"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
