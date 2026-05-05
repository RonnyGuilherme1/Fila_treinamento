const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const pool = require("./db");

// =============================
// DASHBOARD
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
      fila: filaTreinamento.rows,
      filaManut: filaManutencao.rows,
      atendimentos: atendimentos.rows,
      historico: historicoTreinamento.rows,
      historicoManut: historicoManutencao.rows,
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ error: "dashboard fail" });
  }
});

// =============================
// FILA TREINAMENTO
// =============================
app.get("/fila/treinamento", async (req, res) => {
  const r = await pool.query("SELECT * FROM fila_treinamento ORDER BY posicao");
  res.json(r.rows);
});

// =============================
// ROTACIONAR
// =============================
app.post("/fila/treinamento/rotacionar", async (req, res) => {
  const r = await pool.query("SELECT * FROM fila_treinamento ORDER BY posicao");

  if (!r.rows.length) return res.send("ok");

  const first = r.rows[0];

  await pool.query("UPDATE fila_treinamento SET posicao = posicao - 1");
  await pool.query(
    "UPDATE fila_treinamento SET posicao = (SELECT COALESCE(MAX(posicao),0)+1 FROM fila_treinamento) WHERE id=$1",
    [first.id],
  );

  res.send("ok");
});

// =============================
// ATENDIMENTO
// =============================
app.post("/atendimento", async (req, res) => {
  const { pessoa, cliente } = req.body;

  const r = await pool.query(
    "INSERT INTO atendimentos (pessoa, cliente) VALUES ($1,$2) RETURNING *",
    [pessoa, cliente],
  );

  res.json(r.rows[0]);
});

// FINALIZAR
app.post("/atendimento/finalizar", async (req, res) => {
  const { id } = req.body;

  await pool.query("UPDATE atendimentos SET fim = NOW() WHERE id = $1", [id]);

  res.send("ok");
});

// LISTAR ATIVOS
app.get("/atendimento", async (req, res) => {
  const r = await pool.query(
    "SELECT * FROM atendimentos WHERE fim IS NULL ORDER BY id DESC",
  );

  res.json(r.rows);
});

// =============================
// MANUTENÇÃO
// =============================
app.get("/fila/manutencao", async (req, res) => {
  const r = await pool.query("SELECT * FROM fila_manutencao ORDER BY posicao");
  res.json(r.rows);
});

app.post("/fila/manutencao/rotacionar", async (req, res) => {
  const r = await pool.query("SELECT * FROM fila_manutencao ORDER BY posicao");

  if (!r.rows.length) return res.send("ok");

  const first = r.rows[0];

  await pool.query("UPDATE fila_manutencao SET posicao = posicao - 1");
  await pool.query(
    "UPDATE fila_manutencao SET posicao = (SELECT COALESCE(MAX(posicao),0)+1 FROM fila_manutencao) WHERE id=$1",
    [first.id],
  );

  res.send("ok");
});

app.post("/manutencao", async (req, res) => {
  const { pessoa, equipamento } = req.body;

  await pool.query(
    "INSERT INTO historico_manutencao (pessoa, equipamento) VALUES ($1,$2)",
    [pessoa, equipamento],
  );

  res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API rodando na porta " + PORT));
