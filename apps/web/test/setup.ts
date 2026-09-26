// Default values so importing a route handler does not require a real .env.
// Individual tests override these where behaviour depends on them.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "sb_publishable_test";
process.env.NEXT_PUBLIC_AUTH_CALLBACK_URL ||= "http://localhost:3000/auth/callback";
process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ||= "Mid-client-test";
process.env.NEXT_PUBLIC_MIDTRANS_ENVIRONMENT ||= "sandbox";
