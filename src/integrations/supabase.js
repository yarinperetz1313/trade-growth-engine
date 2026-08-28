const {
  createClient
} = require(
  "@supabase/supabase-js"
);

const {
  config
} = require(
  "../config"
);

let client = null;

function getSupabase() {
  if (client) {
    return client;
  }

  if (
    !config.supabase.url ||
    !config.supabase.anonKey
  ) {
    return null;
  }

  client =
    createClient(
      config.supabase.url,
      config.supabase.anonKey
    );

  return client;
}

function isSupabaseConfigured() {
  return Boolean(
    config.supabase.url &&
    config.supabase.anonKey
  );
}

module.exports = {
  getSupabase,
  isSupabaseConfigured
};
