const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors()); // <- MAIS SEGURO no Render
app.use(express.json());

// health check (IMPORTANTE pro Render não matar o serviço)
app.get("/", (req, res) => {
  res.send("API OK");
});

const pool = require("./db");

// =============================
// 🚀 DASHBOARD
// =============================
app.get("/dashboard", async (req, res) => {
  try {
    const [
      filaTreinamento,
      filaManutencao,
      atendimentos,
      historicoTreinamento,
      historicoManutencao,
    ] = await Promise.all([
      pool.query("SELECT * FROM fila_treinamento ORDER BY posicao"),
      pool.query("SELECT * FROM fila_manutencao ORDER BY posicao"),
      pool.query(
        "SELECT * FROM atendimentos WHERE fim IS NULL ORDER BY id DESC",
      ),
      pool.query("SELECT * FROM historico_treinamento ORDER BY id DESC"),
      pool.query("SELECT * FROM historico_manutencao ORDER BY id DESC"),
    ]);

    res.json({
      fila: filaTreinamento.rows || [],
      filaManut: filaManutencao.rows || [],
      atendimentos: atendimentos.rows || [],
      historico: historicoTreinamento.rows || [],
      historicoManut: historicoManutencao.rows || [],
    });
  } catch (err) {
    console.error("ERRO DASHBOARD:", err);
    res.status(500).json({ error: "dashboard error" });
  }
});

// =============================
// 🔹 FILA TREINAMENTO
// =============================
app.get("/fila/treinamento", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM fila_treinamento ORDER BY posicao",
  );
  res.json(result.rows);
});

app.post("/fila/treinamento/rotacionar", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM fila_treinamento ORDER BY posicao",
  );

  if (!result.rows.length) return res.send("ok");

  const primeira = result.rows[0];

  await pool.query("UPDATE fila_treinamento SET posicao = posicao - 1");
  await pool.query(
    "UPDATE fila_treinamento SET posicao = (SELECT COALESCE(MAX(posicao),0)+1 FROM fila_treinamento) WHERE id=$1",
    [primeira.id],
  );

  res.send("ok");
});

// =============================
// 🔹 ATENDIMENTOS (MULTI)
// =============================

// INICIAR
app.post("/atendimento", async (req, res) => {
  const { pessoa, cliente } = req.body;

  const result = await pool.query(
    "INSERT INTO atendimentos (pessoa, cliente) VALUES ($1,$2) RETURNING *",
    [pessoa, cliente],
  );

  await pool.query(
    "INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo, data_inicio) VALUES ($1,$2,'Atendimento','-',NOW())",
    [pessoa, cliente],
  );

  res.json(result.rows[0]);
});

// FINALIZAR ESPECÍFICO
app.post("/atendimento/finalizar", async (req, res) => {
  const { id } = req.body;

  const result = await pool.query(
    "UPDATE atendimentos SET fim = NOW() WHERE id = $1 RETURNING *",
    [id],
  );

  if (result.rows.length) {
    const { pessoa, cliente } = result.rows[0];

    await pool.query(
      `UPDATE historico_treinamento
       SET data_fim = NOW()
       WHERE pessoa = $1 AND cliente = $2 AND data_fim IS NULL`,
      [pessoa, cliente],
    );
  }

  res.send("ok");
});

// LISTAR ATIVOS
app.get("/atendimento", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM atendimentos WHERE fim IS NULL ORDER BY id DESC",
  );

  res.json(result.rows);
});

// =============================
// 🔹 PULAR
// =============================
app.post("/pular", async (req, res) => {
  const { pessoa, motivo } = req.body;

  await pool.query(
    "INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo) VALUES ($1,'-','Pulado',$2)",
    [pessoa, motivo],
  );

  res.send("ok");
});

// =============================
// 🔹 MANUTENÇÃO
// =============================
app.get("/fila/manutencao", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM fila_manutencao ORDER BY posicao",
  );
  res.json(result.rows);
});

app.post("/fila/manutencao/rotacionar", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM fila_manutencao ORDER BY posicao",
  );

  if (!result.rows.length) return res.send("ok");

  const primeira = result.rows[0];

  await pool.query("UPDATE fila_manutencao SET posicao = posicao - 1");
  await pool.query(
    "UPDATE fila_manutencao SET posicao = (SELECT COALESCE(MAX(posicao),0)+1 FROM fila_manutencao) WHERE id=$1",
    [primeira.id],
  );

  res.send("ok");
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API rodando na porta " + PORT));
