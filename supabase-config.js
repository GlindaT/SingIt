const SUPABASE_URL = "https://djwzneohwexymalnefhi.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqd3puZW9od2V4eW1hbG5lZmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4Nzc0NDUsImV4cCI6MjA5NDQ1MzQ0NX0.AhBVDpfvRV-7ijiHjEulzaXM8HQJJ9EADg35961_O7Y"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
