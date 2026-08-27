const express = require("express");
const cors = require("cors");
const compression = require("compression");
const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("./db");
const { createRoutesRouter, initializeRoutesModule } = require("./routes-module");

const app = express();

app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/rotas/") || req.path.startsWith("/api/rotas")) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.de https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }
  }
  next();
});

app.use(
  "/vendor/leaflet",
  express.static(path.join(__dirname, "node_modules/leaflet/dist"), {
    maxAge: "30d",
    etag: true,
  }),
);

app.use(
  "/rotas",
  express.static(path.join(__dirname, "../Frontend/rotas"), {
    maxAge: "1d",
    etag: true,
    setHeaders(res, filePath) {
      if (path.extname(filePath) === ".html" || path.basename(filePath) === "service-worker.js") {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

app.use(
  express.static(path.join(__dirname, "../Frontend"), {
    maxAge: "1d",
    etag: true,
    setHeaders(res, filePath) {
      if (path.extname(filePath) === ".webmanifest") {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

const FILAS = {
  treinamento: "fila_treinamento",
  manutencao: "fila_manutencao",
};

const HISTORICO_LIMITE_TELA = 100;
const HISTORICO_LIMITE_EXPORTACAO = 1000;
const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function erroHttp(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
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

function validarTipoFila(tipo) {
  const tabela = FILAS[tipo];

  if (!tabela) {
    throw erroHttp("Tipo de fila invalido.", 400);
  }

  return tabela;
}

function booleanoOpcional(valor, campo) {
  if (valor === undefined) return undefined;
  if (typeof valor === "boolean") return valor;

  const erro = new Error(`${campo} deve ser verdadeiro ou falso.`);
  erro.status = 400;
  throw erro;
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

function limitarHistorico(limite) {
  const numero = Number(limite);

  if (!Number.isInteger(numero) || numero <= 0) return HISTORICO_LIMITE_TELA;
  return Math.min(numero, HISTORICO_LIMITE_EXPORTACAO);
}

function dataParaExcel(valor) {
  if (!valor) return null;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;

  return data;
}

function formatarDuracaoExportacao(inicio, fim) {
  const dataInicio = dataParaExcel(inicio);
  const dataFim = dataParaExcel(fim);

  if (!dataInicio || !dataFim) return "-";

  const diff = dataFim - dataInicio;
  if (Number.isNaN(diff) || diff < 0) return "-";

  const segundos = Math.floor(diff / 1000);
  const minutos = Math.floor(segundos / 60);
  const horas = Math.floor(minutos / 60);

  if (horas > 0) return `${horas}h ${minutos % 60}m`;
  return `${minutos}m ${segundos % 60}s`;
}

function colunaExcel(indice) {
  let numero = indice;
  let coluna = "";

  while (numero > 0) {
    const resto = (numero - 1) % 26;
    coluna = String.fromCharCode(65 + resto) + coluna;
    numero = Math.floor((numero - 1) / 26);
  }

  return coluna;
}

function textoPlanilha(valor) {
  return String(valor || "-").trim() || "-";
}

async function buscarHistoricoCompleto({ inicio, fim, limite = HISTORICO_LIMITE_TELA, incluirRanking = true } = {}) {
  const periodo = validarPeriodo(inicio, fim);
  const paramsPeriodo = periodo || [];
  const limiteSeguro = limitarHistorico(limite);
  const paramsComLimite = [...paramsPeriodo, limiteSeguro];
  const limiteSql = `$${paramsComLimite.length}`;
  const filtroTreinamento = periodo
    ? "AND data_inicio::date BETWEEN $1::date AND $2::date"
    : "";
  const whereManutencao = periodo
    ? "WHERE data::date BETWEEN $1::date AND $2::date"
    : "";

  const consultas = [
    pool.query(
      `SELECT pessoa, cliente, tipo, data_inicio, data_fim
       FROM historico_treinamento
       WHERE tipo <> 'Pulada'
       ${filtroTreinamento}
       ORDER BY id DESC
       LIMIT ${limiteSql}`,
      paramsComLimite,
    ),
    pool.query(
      `SELECT pessoa, motivo, data_inicio
       FROM historico_treinamento
       WHERE tipo = 'Pulada'
       ${filtroTreinamento}
       ORDER BY id DESC
       LIMIT ${limiteSql}`,
      paramsComLimite,
    ),
    pool.query(
      `SELECT pessoa, equipamento, data
       FROM historico_manutencao
       ${whereManutencao}
       ORDER BY id DESC
       LIMIT ${limiteSql}`,
      paramsComLimite,
    ),
  ];

  if (incluirRanking) {
    consultas.push(
      pool.query(
        `SELECT pessoa, COUNT(*) as total
         FROM historico_treinamento
         WHERE tipo <> 'Pulada'
         ${filtroTreinamento}
         GROUP BY pessoa
         ORDER BY total DESC, pessoa ASC`,
        paramsPeriodo,
      ),
    );
  }

  const [treinamentos, puladas, manutencao, ranking] = await Promise.all(consultas);

  return {
    treinamentos: treinamentos.rows,
    puladas: puladas.rows,
    manutencao: manutencao.rows,
    ranking: ranking?.rows || [],
  };
}

function estilizarTabelaExcel(worksheet, totalColunas) {
  const ultimaColuna = colunaExcel(totalColunas);
  worksheet.autoFilter = `A1:${ultimaColuna}1`;
  worksheet.views = [{ state: "frozen", ySplit: 1 }];

  const header = worksheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = rowNumber === 1 ? 24 : 22;

    for (let colNumber = 1; colNumber <= totalColunas; colNumber += 1) {
      const cell = row.getCell(colNumber);
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
    }
  }
}

function adicionarAbaTabela(workbook, nome, colunas, linhas, colunasData = []) {
  const worksheet = workbook.addWorksheet(nome);
  worksheet.columns = colunas;

  linhas.forEach((linha) => worksheet.addRow(linha));

  colunasData.forEach((coluna) => {
    worksheet.getColumn(coluna).numFmt = "dd/mm/yyyy hh:mm";
  });

  estilizarTabelaExcel(worksheet, colunas.length);
  return worksheet;
}

function criarWorkbookHistorico(historico) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Fila Conecta";
  workbook.created = new Date();
  workbook.modified = new Date();

  const resumo = workbook.addWorksheet("Resumo");
  resumo.columns = [
    { key: "campo", width: 30 },
    { key: "valor", width: 24 },
    { key: "extra1", width: 18 },
    { key: "extra2", width: 18 },
  ];

  resumo.mergeCells("A1:D1");
  resumo.getCell("A1").value = "Histórico de Atendimentos";
  resumo.getCell("A1").font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  resumo.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF16A34A" },
  };
  resumo.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  resumo.getRow(1).height = 30;

  resumo.getCell("A3").value = "Data/hora da exportação";
  resumo.getCell("B3").value = new Date();
  resumo.getCell("B3").numFmt = "dd/mm/yyyy hh:mm";

  const totais = [
    ["Total de treinamentos", historico.treinamentos.length],
    ["Total de puladas", historico.puladas.length],
    ["Total de manutenções", historico.manutencao.length],
    [
      "Total geral",
      historico.treinamentos.length + historico.puladas.length + historico.manutencao.length,
    ],
  ];

  totais.forEach(([campo, valor], index) => {
    const row = resumo.getRow(5 + index);
    row.getCell(1).value = campo;
    row.getCell(2).value = valor;
  });

  for (let rowNumber = 3; rowNumber <= 8; rowNumber += 1) {
    const row = resumo.getRow(rowNumber);
    row.height = 22;

    for (let colNumber = 1; colNumber <= 2; colNumber += 1) {
      const cell = row.getCell(colNumber);
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      cell.alignment = { vertical: "middle" };
    }

    row.getCell(1).font = { bold: true };
  }

  adicionarAbaTabela(
    workbook,
    "Treinamentos",
    [
      { header: "Técnico", key: "tecnico", width: 24 },
      { header: "Cliente", key: "cliente", width: 28 },
      { header: "Tipo", key: "tipo", width: 20 },
      { header: "Data/Hora", key: "dataHora", width: 20 },
      { header: "Duração", key: "duracao", width: 16 },
    ],
    historico.treinamentos.map((item) => ({
      tecnico: textoPlanilha(item.pessoa),
      cliente: textoPlanilha(item.cliente),
      tipo: textoPlanilha(item.tipo),
      dataHora: dataParaExcel(item.data_inicio),
      duracao: formatarDuracaoExportacao(item.data_inicio, item.data_fim),
    })),
    ["dataHora"],
  );

  adicionarAbaTabela(
    workbook,
    "Puladas",
    [
      { header: "Técnico", key: "tecnico", width: 24 },
      { header: "Motivo", key: "motivo", width: 40 },
      { header: "Data/Hora", key: "dataHora", width: 20 },
    ],
    historico.puladas.map((item) => ({
      tecnico: textoPlanilha(item.pessoa),
      motivo: textoPlanilha(item.motivo),
      dataHora: dataParaExcel(item.data_inicio),
    })),
    ["dataHora"],
  );

  adicionarAbaTabela(
    workbook,
    "Manutenção",
    [
      { header: "Técnico", key: "tecnico", width: 24 },
      { header: "Equipamento", key: "equipamento", width: 34 },
      { header: "Data/Hora", key: "dataHora", width: 20 },
    ],
    historico.manutencao.map((item) => ({
      tecnico: textoPlanilha(item.pessoa),
      equipamento: textoPlanilha(item.equipamento),
      dataHora: dataParaExcel(item.data),
    })),
    ["dataHora"],
  );

  return workbook;
}

async function listarFila(tipo, client = pool, somenteAtivos = true) {
  const tabela = validarTipoFila(tipo);
  const filtroAtivo = somenteAtivos ? "WHERE ativo IS DISTINCT FROM FALSE" : "";
  return client.query(
    `SELECT * FROM ${tabela} ${filtroAtivo} ORDER BY posicao NULLS LAST, id`,
  );
}

async function listarFilaBloqueada(client, tabela) {
  return client.query(
    `SELECT * FROM (SELECT * FROM ${tabela} WHERE ativo IS DISTINCT FROM FALSE FOR UPDATE) fila ORDER BY posicao NULLS LAST, id`,
  );
}

async function rotacionarLinhasFila(client, tabela, linhas) {
  if (!linhas.length) return;

  const [primeiro, ...restante] = linhas;
  const posicoes = linhas.map((linha, index) => linha.posicao || index + 1);
  const rotacionada = [...restante, primeiro];

  for (let i = 0; i < rotacionada.length; i += 1) {
    await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
      posicoes[i],
      rotacionada[i].id,
    ]);
  }
}

async function rotacionarFila(tipo) {
  const tabela = validarTipoFila(tipo);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await listarFilaBloqueada(client, tabela);

    if (!r.rows.length) {
      await client.query("COMMIT");
      return;
    }

    await rotacionarLinhasFila(client, tabela, r.rows);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function traduzirErroAtendimentoDuplicado(err) {
  if (err.code === "23505" && err.constraint === "idx_atendimentos_pessoa_aberto") {
    return erroHttp("Ja existe atendimento em aberto para esta pessoa.", 409);
  }

  return err;
}

async function garantirSemAtendimentoAberto(client, pessoa) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [pessoa]);

  const r = await client.query(
    "SELECT id FROM atendimentos WHERE pessoa = $1 AND fim IS NULL FOR UPDATE",
    [pessoa],
  );

  if (r.rows.length) {
    throw erroHttp("Ja existe atendimento em aberto para esta pessoa.", 409);
  }
}

async function criarAtendimentoTreinamento(client, pessoa, cliente, tipo) {
  await garantirSemAtendimentoAberto(client, pessoa);

  const atendimento = await client.query(
    "INSERT INTO atendimentos (pessoa, cliente) VALUES ($1, $2) RETURNING *",
    [pessoa, cliente],
  );

  await client.query(
    `INSERT INTO historico_treinamento (pessoa, cliente, tipo, motivo, data_inicio)
     VALUES ($1, $2, $3, '-', NOW())`,
    [pessoa, cliente, tipo],
  );

  return atendimento.rows[0];
}

async function iniciarTreinamento(cliente, tipo) {
  const tabela = validarTipoFila("treinamento");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const fila = await listarFilaBloqueada(client, tabela);

    if (!fila.rows.length) {
      throw erroHttp("Fila de treinamento vazia.", 409);
    }

    const pessoa = fila.rows[0].nome;
    const atendimento = await criarAtendimentoTreinamento(client, pessoa, cliente, tipo);

    await rotacionarLinhasFila(client, tabela, fila.rows);
    await client.query("COMMIT");

    return atendimento;
  } catch (err) {
    await client.query("ROLLBACK");
    throw traduzirErroAtendimentoDuplicado(err);
  } finally {
    client.release();
  }
}

async function iniciarManutencao(equipamento) {
  const tabela = validarTipoFila("manutencao");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const fila = await listarFilaBloqueada(client, tabela);

    if (!fila.rows.length) {
      throw erroHttp("Fila de manutencao vazia.", 409);
    }

    const pessoa = fila.rows[0].nome;
    const manutencao = await client.query(
      "INSERT INTO historico_manutencao (pessoa, equipamento) VALUES ($1, $2) RETURNING *",
      [pessoa, equipamento],
    );

    await rotacionarLinhasFila(client, tabela, fila.rows);
    await client.query("COMMIT");

    return manutencao.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function pularFila(tipo, motivo) {
  const tabela = validarTipoFila(tipo);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const r = await listarFilaBloqueada(client, tabela);

    if (r.rows.length < 2) {
      await client.query("COMMIT");
      return;
    }

    const [primeiro, segundo] = r.rows;

    const primeiraPosicao = primeiro.posicao || 1;
    const segundaPosicao = segundo.posicao || 2;

    await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
      segundaPosicao,
      primeiro.id,
    ]);
    await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
      primeiraPosicao,
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

async function normalizarPosicoesFila(client, tabela) {
  const r = await client.query(
    `SELECT id FROM ${tabela} ORDER BY posicao NULLS LAST, id`,
  );

  for (let i = 0; i < r.rows.length; i += 1) {
    await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
      i + 1,
      r.rows[i].id,
    ]);
  }
}

async function adicionarTecnicoFila(tipo, nome) {
  const tabela = validarTipoFila(tipo);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`LOCK TABLE ${tabela} IN EXCLUSIVE MODE`);
    await normalizarPosicoesFila(client, tabela);

    const posicao = await client.query(
      `SELECT COALESCE(MAX(posicao), 0) + 1 AS proxima FROM ${tabela}`,
    );
    const r = await client.query(
      `INSERT INTO ${tabela} (nome, posicao, ativo) VALUES ($1, $2, TRUE) RETURNING *`,
      [nome, posicao.rows[0].proxima],
    );

    await client.query("COMMIT");
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function atualizarTecnicoFila(tipo, id, dados) {
  const tabela = validarTipoFila(tipo);
  const nome =
    Object.prototype.hasOwnProperty.call(dados, "nome")
      ? textoObrigatorio(dados.nome, "o nome", 100)
      : undefined;
  const ativo = booleanoOpcional(dados.ativo, "ativo");

  if (nome === undefined && ativo === undefined) {
    throw erroHttp("Informe nome ou status para atualizar.", 400);
  }

  const campos = [];
  const valores = [];

  if (nome !== undefined) {
    valores.push(nome);
    campos.push(`nome = $${valores.length}`);
  }

  if (ativo !== undefined) {
    valores.push(ativo);
    campos.push(`ativo = $${valores.length}`);
  }

  valores.push(id);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`LOCK TABLE ${tabela} IN EXCLUSIVE MODE`);

    const r = await client.query(
      `UPDATE ${tabela} SET ${campos.join(", ")} WHERE id = $${valores.length} RETURNING *`,
      valores,
    );

    if (!r.rows[0]) {
      throw erroHttp("Tecnico nao encontrado.", 404);
    }

    await normalizarPosicoesFila(client, tabela);
    await client.query("COMMIT");
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function moverTecnicoFila(tipo, id, direcao) {
  const tabela = validarTipoFila(tipo);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(`LOCK TABLE ${tabela} IN EXCLUSIVE MODE`);
    await normalizarPosicoesFila(client, tabela);

    const r = await client.query(
      `SELECT * FROM ${tabela} ORDER BY posicao NULLS LAST, id`,
    );
    const index = r.rows.findIndex((linha) => linha.id === id);

    if (index === -1) {
      throw erroHttp("Tecnico nao encontrado.", 404);
    }

    const destino = direcao === "subir" ? index - 1 : index + 1;

    if (destino >= 0 && destino < r.rows.length) {
      const atual = r.rows[index];
      const outro = r.rows[destino];

      await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
        outro.posicao,
        atual.id,
      ]);
      await client.query(`UPDATE ${tabela} SET posicao = $1 WHERE id = $2`, [
        atual.posicao,
        outro.id,
      ]);
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
// CONFIGURAÇÃO DAS FILAS
// =============================
app.get(
  "/config/filas",
  asyncRoute(async (_req, res) => {
    const [treinamento, manutencao] = await Promise.all([
      listarFila("treinamento", pool, false),
      listarFila("manutencao", pool, false),
    ]);

    res.json({
      treinamento: treinamento.rows,
      manutencao: manutencao.rows,
    });
  }),
);

app.post(
  "/config/filas/:tipo",
  asyncRoute(async (req, res) => {
    const tipo = req.params.tipo;
    validarTipoFila(tipo);

    const nome = textoObrigatorio(req.body.nome, "o nome", 100);
    const tecnico = await adicionarTecnicoFila(tipo, nome);

    res.status(201).json(tecnico);
  }),
);

app.patch(
  "/config/filas/:tipo/:id",
  asyncRoute(async (req, res) => {
    const tipo = req.params.tipo;
    validarTipoFila(tipo);

    const id = idObrigatorio(req.params.id);
    const tecnico = await atualizarTecnicoFila(tipo, id, req.body || {});

    res.json(tecnico);
  }),
);

app.post(
  "/config/filas/:tipo/:id/subir",
  asyncRoute(async (req, res) => {
    const tipo = req.params.tipo;
    validarTipoFila(tipo);

    const id = idObrigatorio(req.params.id);
    await moverTecnicoFila(tipo, id, "subir");

    res.send("ok");
  }),
);

app.post(
  "/config/filas/:tipo/:id/descer",
  asyncRoute(async (req, res) => {
    const tipo = req.params.tipo;
    validarTipoFila(tipo);

    const id = idObrigatorio(req.params.id);
    await moverTecnicoFila(tipo, id, "descer");

    res.send("ok");
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
  "/treinamento/iniciar",
  asyncRoute(async (req, res) => {
    const cliente = textoObrigatorio(req.body.cliente, "o cliente", 120);
    const tipo = textoOpcional(req.body.tipo, "Atendimento", 60);
    const atendimento = await iniciarTreinamento(cliente, tipo);

    res.json(atendimento);
  }),
);

app.post(
  "/atendimento",
  asyncRoute(async (req, res) => {
    const pessoa = textoObrigatorio(req.body.pessoa, "a pessoa", 100);
    const cliente = textoObrigatorio(req.body.cliente, "o cliente", 120);
    const tipo = textoOpcional(req.body.tipo, "Atendimento", 60);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const atendimento = await criarAtendimentoTreinamento(client, pessoa, cliente, tipo);

      await client.query("COMMIT");
      res.json(atendimento);
    } catch (err) {
      await client.query("ROLLBACK");
      throw traduzirErroAtendimentoDuplicado(err);
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
  "/manutencao/iniciar",
  asyncRoute(async (req, res) => {
    const equipamento = textoObrigatorio(req.body.equipamento, "o equipamento", 80);
    const manutencao = await iniciarManutencao(equipamento);

    res.json(manutencao);
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
    const historico = await buscarHistoricoCompleto({
      inicio: req.query.inicio,
      fim: req.query.fim,
      limite: HISTORICO_LIMITE_TELA,
    });

    res.json(historico);
  }),
);

app.get(
  "/historico/excel",
  asyncRoute(async (req, res) => {
    try {
      const historico = await buscarHistoricoCompleto({
        inicio: req.query.inicio,
        fim: req.query.fim,
        limite: HISTORICO_LIMITE_EXPORTACAO,
        incluirRanking: false,
      });

      const workbook = criarWorkbookHistorico(historico);
      const buffer = await workbook.xlsx.writeBuffer();

      res.setHeader("Content-Type", EXCEL_MIME_TYPE);
      res.setHeader("Content-Disposition", 'attachment; filename="historico-atendimentos.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (err) {
      console.error("Erro ao gerar Excel do histórico:", err.message);
      res.status(err.status || 500).json({
        erro: err.status ? err.message : "Erro ao gerar Excel do histórico.",
      });
    }
  }),
);

app.use("/api/rotas", createRoutesRouter(pool));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ erro: err.message || "Erro interno" });
});

const PORT = process.env.PORT || 3000;
initializeRoutesModule(pool)
  .then(() => {
    app.listen(PORT, () => console.log("API rodando na porta " + PORT));
  })
  .catch((err) => {
    console.error("Falha ao inicializar o modulo de rotas:", err);
    process.exitCode = 1;
  });
