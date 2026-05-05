const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

// 🔥 CONFIG DO BANCO
const pool = require("./db");

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
// 🔹 ATENDIMENTO
// =============================
app.post("/atendimento", async (req, res) => {
  const { pessoa, cliente } = req.body;

  await pool.query("DELETE FROM atendimento_atual");

  await pool.query(
    "INSERT INTO atendimento_atual (pessoa, cliente) VALUES ($1,$2)",
    [pessoa, cliente],
  );

  await pool.query(
    "INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo) VALUES ($1,$2,'Atendimento','-')",
    [pessoa, cliente],
  );

  res.send("ok");
});

app.get("/atendimento", async (req, res) => {
  const result = await pool.query("SELECT * FROM atendimento_atual LIMIT 1");
  res.json(result.rows[0] || null);
});

app.delete("/atendimento", async (req, res) => {
  await pool.query("DELETE FROM atendimento_atual");
  res.send("ok");
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
// 🔹 HISTÓRICO
// =============================
app.get("/historico/treinamento", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM historico_treinamento ORDER BY id DESC",
  );
  res.json(result.rows);
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
// 🔹 HISTÓRICO MANUTENÇÃO
// =============================
app.get("/historico/manutencao", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM historico_manutencao ORDER BY id DESC",
  );
  res.json(result.rows);
});

// =============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log("API rodando na porta " + PORT));
