const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const pool = require("./db");

// =============================
// 🚀 DASHBOARD (NOVO - OTIMIZADO)
// =============================
app.get("/dashboard", async (req, res) => {
  try {
    const [
      filaTreinamento,
      filaManutencao,
      atendimento,
      historicoTreinamento,
      historicoManutencao,
    ] = await Promise.all([
      pool.query("SELECT * FROM fila_treinamento ORDER BY posicao"),
      pool.query("SELECT * FROM fila_manutencao ORDER BY posicao"),
      pool.query("SELECT * FROM atendimento_atual LIMIT 1"),
      pool.query("SELECT * FROM historico_treinamento ORDER BY id DESC"),
      pool.query("SELECT * FROM historico_manutencao ORDER BY id DESC"),
    ]);

    res.json({
      fila: filaTreinamento.rows,
      filaManut: filaManutencao.rows,
      atual: atendimento.rows[0] || null,
      historico: historicoTreinamento.rows,
      historicoManut: historicoManutencao.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro dashboard");
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

  const primeira = result.rows[0];

  await pool.query("UPDATE fila_treinamento SET posicao = posicao - 1");
  await pool.query(
    "UPDATE fila_treinamento SET posicao = (SELECT MAX(posicao)+1 FROM fila_treinamento) WHERE id=$1",
    [primeira.id],
  );

  res.send("ok");
});

// =============================
// 🔹 ATENDIMENTOS (NOVO MODELO)
// =============================

// ▶️ INICIAR ATENDIMENTO
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

// 🛑 FINALIZAR ATENDIMENTO ESPECÍFICO
app.post("/atendimento/finalizar", async (req, res) => {
  const { id } = req.body;

  const result = await pool.query(
    "UPDATE atendimentos SET fim = NOW() WHERE id = $1 RETURNING *",
    [id],
  );

  // atualiza histórico com fim
  await pool.query(
    `UPDATE historico_treinamento
     SET data_fim = NOW()
     WHERE pessoa = $1 AND cliente = $2 AND data_fim IS NULL`,
    [result.rows[0].pessoa, result.rows[0].cliente],
  );

  res.send("ok");
});

// 📥 LISTAR ATIVOS
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
// 🔹 FILA MANUTENÇÃO
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

  const primeira = result.rows[0];

  await pool.query("UPDATE fila_manutencao SET posicao = posicao - 1");
  await pool.query(
    "UPDATE fila_manutencao SET posicao = (SELECT MAX(posicao)+1 FROM fila_manutencao) WHERE id=$1",
    [primeira.id],
  );

  res.send("ok");
});

// =============================
// 🔹 MANUTENÇÃO
// =============================
app.post("/manutencao", async (req, res) => {
  const { pessoa, equipamento } = req.body;

  await pool.query(
    "INSERT INTO historico_manutencao (pessoa, equipamento) VALUES ($1,$2)",
    [pessoa, equipamento],
  );

  res.send("ok");
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API rodando na porta " + PORT));
