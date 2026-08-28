require("dotenv").config();

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`
    );
  }

  return value;
}

const config = {
  nodeEnv:
    process.env.NODE_ENV ||
    "development",

  port:
    Number(process.env.PORT) ||
    3000,

  supabase: {
    url:
      process.env.SUPABASE_URL ||
      null,

    anonKey:
      process.env.SUPABASE_ANON_KEY ||
      null
  },

  openai: {
    enabled:
      Boolean(
        process.env.OPENAI_API_KEY
      ),

    model:
      process.env.OPENAI_MODEL ||
      "gpt-5-mini"
  },

  live: {
    enabled:
      process.env.LIVE_MODE ===
      "true"
  }
};

module.exports = {
  config,
  required
};
