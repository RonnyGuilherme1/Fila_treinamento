const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");

const app = express();
app.use(cors({ origin: "*" }));
app.use(compression());
app.use(express.json());

// Servir arquivos estáticos com cache
app.use(
  express.static(path.join(__dirname, "../Frontend"), {
    maxAge: "1d", // Cache por 1 dia
  }),
);

const pool = require("./db");

// =============================
// DASHBOARD
// =============================
app.get("/dashboard", async (req, res) => {
  try {
    const filaTreinamento = await pool.query(
      "SELECT * FROM fila_treinamento ORDER BY posicao",
    );

    const filaManutencao = await pool.query(
      "SELECT * FROM fila_manutencao ORDER BY posicao",
    );

    let atendimentos = { rows: [] };

    try {
      atendimentos = await pool.query(
        `SELECT a.id, a.pessoa, a.cliente, a.fim,
                COALESCE(
                  (SELECT tipo FROM historico_treinamento
                   WHERE pessoa = a.pessoa
                     AND cliente = a.cliente
                   ORDER BY data_inicio DESC
                   LIMIT 1),
                  'Treinamento'
                ) as tipo
         FROM atendimentos a
         WHERE a.fim IS NULL
         ORDER BY a.id DESC`,
      );
    } catch (err) {
      console.error("Erro atendimentos:", err.message);
    }

    const historicoTreinamento = await pool.query(
      "SELECT * FROM historico_treinamento ORDER BY id DESC LIMIT 50",
    );

    const historicoManutencao = await pool.query(
      "SELECT * FROM historico_manutencao ORDER BY id DESC LIMIT 50",
    );

    const ranking = await pool.query(`
      SELECT pessoa, COUNT(*) as total
      FROM historico_treinamento
      WHERE tipo NOT IN ('Pulada')
      GROUP BY pessoa
      ORDER BY total DESC
      LIMIT 10
      `);

    res.json({
      fila: filaTreinamento.rows,
      filaManut: filaManutencao.rows,
      atendimentos: atendimentos.rows,
      historico: historicoTreinamento.rows,
      historicoManut: historicoManutencao.rows,
      ranking: ranking.rows,
    });
  } catch (err) {
    console.error("DASHBOARD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
// =============================
// FILA TREINAMENTO
// =============================
app.get("/fila/treinamento", async (req, res) => {
  const r = await pool.query("SELECT * FROM fila_treinamento ORDER BY posicao");
  res.json(r.rows);
});

// ROTACIONAR TREINAMENTO
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

// PULAR TREINAMENTO (mover primeiro para segunda posição)
app.post("/fila/treinamento/pular", async (req, res) => {
  const { motivo = "Não especificado" } = req.body;

  const r = await pool.query("SELECT * FROM fila_treinamento ORDER BY posicao");
  if (r.rows.length < 2) return res.send("ok");

  const first = r.rows[0];
  const second = r.rows[1];

  await pool.query("UPDATE fila_treinamento SET posicao = 2 WHERE id = $1", [
    first.id,
  ]);
  await pool.query("UPDATE fila_treinamento SET posicao = 1 WHERE id = $1", [
    second.id,
  ]);

  // Registrar no histórico que foi pulado
  await pool.query(
    `INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo, data_inicio)
     VALUES ($1, $2, 'Pulada', $3, NOW())`,
    [first.nome, "Sistema", motivo],
  );

  res.send("ok");
});

// =============================
// ATENDIMENTO TREINAMENTO
// =============================
app.post("/atendimento", async (req, res) => {
  const { pessoa, cliente, tipo = "Atendimento" } = req.body;

  const r = await pool.query(
    "INSERT INTO atendimentos (pessoa, cliente) VALUES ($1,$2) RETURNING *",
    [pessoa, cliente],
  );

  const atendimento = r.rows[0];

  await pool.query(
    `INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo, data_inicio)
     VALUES ($1,$2,$3,'-',NOW())`,
    [pessoa, cliente, tipo],
  );

  res.json(atendimento);
});

// FINALIZAR ATENDIMENTO
app.post("/atendimento/finalizar", async (req, res) => {
  const { id } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query(
      "UPDATE atendimentos SET fim = NOW() WHERE id = $1 RETURNING *",
      [id],
    );

    const att = r.rows[0];

    if (att) {
      await client.query(
        `UPDATE historico_treinamento
         SET data_fim = NOW()
         WHERE id = (
           SELECT id FROM historico_treinamento
           WHERE pessoa = $1
             AND cliente = $2
             AND data_fim IS NULL
           ORDER BY id DESC
           LIMIT 1
         )`,
        [att.pessoa, att.cliente],
      );
    }

    await client.query("COMMIT");
    res.send("ok");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro finalizar atendimento:", err);
    res.status(500).send(err.message);
  } finally {
    client.release();
  }
});

// =============================
// FILA MANUTENÇÃO
// =============================
app.get("/fila/manutencao", async (req, res) => {
  const r = await pool.query("SELECT * FROM fila_manutencao ORDER BY posicao");
  res.json(r.rows);
});

// ROTACIONAR MANUTENÇÃO
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

// MANUTENÇÃO FINALIZADA
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
