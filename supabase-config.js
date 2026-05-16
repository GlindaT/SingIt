const SUPABASE_URL = "https://djwzneohwexymalnefhi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_5CeiEjbsPTOFOkGbayXgvw_f-m8s2L9"; 

// Esto es necesario para que el cliente se inicialice correctamente
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
