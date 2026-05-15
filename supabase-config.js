const SUPABASE_URL = "https://zpkearbtwumtbdgtezhq.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpwa2VhcmJ0d3VtdGJkZ3RlemhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4MTEzMTksImV4cCI6MjA5NDM4NzMxOX0.vtU6TrIctZPLDHMds1kB0yYHvYE1K9_NCFH-8HyuMkE"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
