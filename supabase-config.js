const SUPABASE_URL = "https://xcsjmehnnwimbyhalleb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhjc2ptZWhubndpbWJ5aGFsbGViIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0OTAzMDgsImV4cCI6MjA5MjA2NjMwOH0.S23EhnHsmOkP1OfFLuoXTk1ITzqjYZ6BC3jWmpYaeps"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
