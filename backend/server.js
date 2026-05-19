const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const pool = require("./db");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(compression());
app.use(express.json({ limit: "100kb" }));

app.use(
  express.static(path.join(__dirname, "../Frontend"), {
    maxAge: "1d",
    etag: true,
  }),
);

const FILAS = {
  treinamento: "fila_treinamento",
  manutencao: "fila_manutencao",
};

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function textoObrigatorio(valor, campo, limite = 120) {
  const texto = String(valor || "").trim();

  if (!texto) {
    const erro = new Error(`Informe ${campo}.`);
    erro.status = 400;
    throw erro;
  }

  if (texto.length > limite) {
    const erro = new Error(`${campo} deve ter no máximo ${limite} caracteres.`);
    erro.status = 400;
    throw erro;
  }

  return texto;
}

function textoOpcional(valor, padrao, limite = 150) {
  const texto = String(valor || "").trim() || padrao;
  return texto.slice(0, limite);
}

function idObrigatorio(valor) {
  const id = Number(valor);

  if (!Number.isInteger(id) || id <= 0) {
    const erro = new Error("ID inválido.");
    erro.status = 400;
    throw erro;
  }

  return id;
}

function validarPeriodo(inicio, fim) {
  if (!inicio || !fim) return null;

  const padraoData = /^\d{4}-\d{2}-\d{2}$/;
  if (!padraoData.test(inicio) || !padraoData.test(fim)) {
    const erro = new Error("Período inválido. Use o formato AAAA-MM-DD.");
    erro.status = 400;
    throw erro;
  }

  return [inicio, fim];
}

async function listarFila(tipo, client = pool) {
  const tabela = FILAS[tipo];
  return client.query(`SELECT * FROM ${tabela} ORDER BY posicao NULLS LAST, id`);
}

async function rotacionarFila(tipo) {
  const tabela = FILAS[tipo];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await client.query(
      `SELECT * FROM ${tabela} ORDER BY posicao NULLS LAST, id FOR UPDATE`,
    );

    if (!r.rows.length) {
      await client.query("COMMIT");
      return;
    }

    const [primeiro, ...restante] = r.rows;

    for (let i = 0; i < restante.length; i += 1) {
      await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
        i + 1,
        restante[i].id,
      ]);
    }

    await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
      r.rows.length,
      primeiro.id,
    ]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function pularFila(tipo, motivo) {
  const tabela = FILAS[tipo];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await client.query(
      `SELECT * FROM ${tabela} ORDER BY posicao NULLS LAST, id FOR UPDATE`,
    );

    if (r.rows.length < 2) {
      await client.query("COMMIT");
      return;
    }

    const [primeiro, segundo] = r.rows;

    await client.query(`UPDATE ${tabela} SET posicao = 2 WHERE id = $1`, [
      primeiro.id,
    ]);
    await client.query(`UPDATE ${tabela} SET posicao = 1 WHERE id = $1`, [
      segundo.id,
    ]);

    if (tipo === "treinamento") {
      await client.query(
        `INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo, data_inicio)
         VALUES ($1, $2, 'Pulada', $3, NOW())`,
        [primeiro.nome, "Sistema", motivo],
      );
    } else {
      await client.query(
        `INSERT INTO historico_manutencao (pessoa, equipamento, data)
         VALUES ($1, $2, NOW())`,
        [primeiro.nome, `PULADO - ${motivo}`],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// =============================
// DASHBOARD
// =============================
app.get(
  "/dashboard",
  asyncRoute(async (_req, res) => {
    const filaTreinamento = await listarFila("treinamento");
    const filaManutencao = await listarFila("manutencao");

    const atendimentos = await pool.query(
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

    const historicoTreinamento = await pool.query(`
      SELECT pessoa, cliente, tipo, motivo, data_inicio, data_fim
      FROM historico_treinamento
      WHERE tipo <> 'Pulada'
      ORDER BY id DESC
      LIMIT 5
    `);

    const historicoManutencao = await pool.query(`
      SELECT pessoa, equipamento, data
      FROM historico_manutencao
      ORDER BY id DESC
      LIMIT 5
    `);

    const ranking = await pool.query(`
      SELECT pessoa, COUNT(*) as total
      FROM historico_treinamento
      WHERE tipo <> 'Pulada'
      GROUP BY pessoa
      ORDER BY total DESC, pessoa ASC
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
  }),
);

// =============================
// FILA TREINAMENTO
// =============================
app.get(
  "/fila/treinamento",
  asyncRoute(async (_req, res) => {
    const r = await listarFila("treinamento");
    res.json(r.rows);
  }),
);

app.post(
  "/fila/treinamento/rotacionar",
  asyncRoute(async (_req, res) => {
    await rotacionarFila("treinamento");
    res.send("ok");
  }),
);

app.post(
  "/fila/treinamento/pular",
  asyncRoute(async (req, res) => {
    const motivo = textoOpcional(req.body.motivo, "Não especificado", 150);
    await pularFila("treinamento", motivo);
    res.send("ok");
  }),
);

// =============================
// ATENDIMENTO TREINAMENTO
// =============================
app.post(
  "/atendimento",
  asyncRoute(async (req, res) => {
    const pessoa = textoObrigatorio(req.body.pessoa, "a pessoa", 100);
    const cliente = textoObrigatorio(req.body.cliente, "o cliente", 120);
    const tipo = textoOpcional(req.body.tipo, "Atendimento", 60);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const r = await client.query(
        "INSERT INTO atendimentos (pessoa, cliente) VALUES ($1, $2) RETURNING *",
        [pessoa, cliente],
      );

      await client.query(
        `INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo, data_inicio)
         VALUES ($1, $2, $3, '-', NOW())`,
        [pessoa, cliente, tipo],
      );

      await client.query("COMMIT");
      res.json(r.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

app.post(
  "/atendimento/finalizar",
  asyncRoute(async (req, res) => {
    const id = idObrigatorio(req.body.id);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const r = await client.query(
        "UPDATE atendimentos SET fim = NOW() WHERE id = $1 AND fim IS NULL RETURNING *",
        [id],
      );

      const atendimento = r.rows[0];

      if (!atendimento) {
        const erro = new Error("Atendimento não encontrado ou já finalizado.");
        erro.status = 404;
        throw erro;
      }

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
        [atendimento.pessoa, atendimento.cliente],
      );

      await client.query("COMMIT");
      res.send("ok");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }),
);

// =============================
// FILA MANUTENÇÃO
// =============================
app.get(
  "/fila/manutencao",
  asyncRoute(async (_req, res) => {
    const r = await listarFila("manutencao");
    res.json(r.rows);
  }),
);

app.post(
  "/fila/manutencao/rotacionar",
  asyncRoute(async (_req, res) => {
    await rotacionarFila("manutencao");
    res.send("ok");
  }),
);

app.post(
  "/fila/manutencao/pular",
  asyncRoute(async (req, res) => {
    const motivo = textoOpcional(req.body.motivo, "Não especificado", 150);
    await pularFila("manutencao", motivo);
    res.send("ok");
  }),
);

app.post(
  "/manutencao",
  asyncRoute(async (req, res) => {
    const pessoa = textoObrigatorio(req.body.pessoa, "a pessoa", 100);
    const equipamento = textoObrigatorio(req.body.equipamento, "o equipamento", 80);

    await pool.query(
      "INSERT INTO historico_manutencao (pessoa, equipamento) VALUES ($1, $2)",
      [pessoa, equipamento],
    );

    res.send("ok");
  }),
);

// =============================
// HISTÓRICO COMPLETO
// =============================
app.get(
  "/historico/completo",
  asyncRoute(async (req, res) => {
    const periodo = validarPeriodo(req.query.inicio, req.query.fim);
    const params = periodo || [];
    const filtroTreinamento = periodo
      ? "AND data_inicio::date BETWEEN $1::date AND $2::date"
      : "";
    const whereManutencao = periodo
      ? "WHERE data::date BETWEEN $1::date AND $2::date"
      : "";

    const treinamentos = await pool.query(
      `SELECT pessoa, cliente, tipo, data_inicio, data_fim
       FROM historico_treinamento
       WHERE tipo <> 'Pulada'
       ${filtroTreinamento}
       ORDER BY id DESC
       LIMIT 100`,
      params,
    );

    const puladas = await pool.query(
      `SELECT pessoa, motivo, data_inicio
       FROM historico_treinamento
       WHERE tipo = 'Pulada'
       ${filtroTreinamento}
       ORDER BY id DESC
       LIMIT 100`,
      params,
    );

    const manutencao = await pool.query(
      `SELECT pessoa, equipamento, data
       FROM historico_manutencao
       ${whereManutencao}
       ORDER BY id DESC
       LIMIT 100`,
      params,
    );

    const ranking = await pool.query(
      `SELECT pessoa, COUNT(*) as total
       FROM historico_treinamento
       WHERE tipo <> 'Pulada'
       ${filtroTreinamento}
       GROUP BY pessoa
       ORDER BY total DESC, pessoa ASC`,
      params,
    );

    res.json({
      treinamentos: treinamentos.rows,
      puladas: puladas.rows,
      manutencao: manutencao.rows,
      ranking: ranking.rows,
    });
  }),
);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ erro: err.message || "Erro interno" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API rodando na porta " + PORT));
