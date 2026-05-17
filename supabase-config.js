const SUPABASE_URL = "https://bvtfbdmqjxmjbqiagsxq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2dGZiZG1xanhtamJxaWFnc3hxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzE1MTMsImV4cCI6MjA5NDYwNzUxM30.YfJvbAvIUaXy0aVlmdHaUi89I9ypEY271nBJ5uFsObI"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
