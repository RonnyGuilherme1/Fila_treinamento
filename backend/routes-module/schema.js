const fs = require("fs");
const path = require("path");

async function ensureRoutesSchema(pool) {
  const schemaPath = path.join(__dirname, "../../database/rotas.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
  await pool.query("DELETE FROM rotas_sessoes WHERE expira_em <= NOW()");
}

module.exports = { ensureRoutesSchema };
