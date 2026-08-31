const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const sslSetting = String(process.env.DATABASE_SSL || "").trim().toLowerCase();

// Render/production requires SSL, while a local PostgreSQL installation often
// does not support it. DATABASE_SSL can explicitly override this behavior.
const useSsl = sslSetting === "true" || (sslSetting !== "false" && process.env.NODE_ENV === "production");

const poolConfig = { connectionString };
if (useSsl) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

module.exports = pool;
