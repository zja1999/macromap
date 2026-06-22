/* Macro Map — configuration.
 *
 * To enable cloud accounts (sign in + cross-device sync), create a free
 * Supabase project (https://supabase.com), run the SQL in supabase/schema.sql,
 * then paste your project URL and the *anon* public key below.
 *
 * The anon key is SAFE to expose in client code — it is designed to be public.
 * Data is protected by Row-Level Security (see schema.sql), not by hiding the key.
 *
 * Leave these blank to run Macro Map in local-only mode (data stays in this
 * browser via localStorage, no account required).
 */
window.MM = window.MM || {};

window.MM.CONFIG = {
  supabaseUrl: "https://gxekdpfxhycjatvtqxfm.supabase.co",
  supabaseAnonKey: "sb_publishable_emaUFLtlVR-uQPUF-9KY6w_MgsENvFD",

  // Accounts that see the in-app Admin tab (requests + feedback). This only
  // shows/hides UI — actual access is enforced by Row-Level Security keyed to
  // these emails (see supabase/admin-schema.sql). Leave empty to disable Admin.
  adminEmails: [
    "zja1999@gmail.com"
  ]
};
