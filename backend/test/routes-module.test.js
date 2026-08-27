const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  hashPassword,
  verifyPassword,
  normalizeUsername,
} = require("../routes-module/auth");
const {
  contextualizeAddress,
  geocodeAddress,
  optimizeRoute,
  rankGeocodingFeatures,
} = require("../routes-module/routing");
const { createRoutesRouter } = require("../routes-module");

async function invokeStopStatus(pool, body) {
  const router = createRoutesRouter(pool);
  const routeLayer = router.stack.find((layer) => layer.route?.path === "/planos/:planId/paradas/:stopId/status");
  const handler = routeLayer.route.stack.at(-1).handle;
  return new Promise((resolve, reject) => {
    const req = {
      params: { planId: "10", stopId: "20" },
      body,
      routeUser: { id: 7, perfil: "supervisor", csrf_token: "teste" },
    };
    const res = { json: resolve };
    Promise.resolve(handler(req, res, reject)).catch(reject);
  });
}

function isoDateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("senha e armazenada com scrypt e validada sem texto puro", async () => {
  const password = "Senha-Forte-123";
  const stored = await hashPassword(password);
  assert.match(stored, /^scrypt\$/);
  assert.equal(stored.includes(password), false);
  assert.equal(await verifyPassword(password, stored), true);
  assert.equal(await verifyPassword("senha-incorreta", stored), false);
});

test("usuario e normalizado e caracteres perigosos sao recusados", () => {
  assert.equal(normalizeUsername("  Tecnico.01  "), "tecnico.01");
  assert.throws(() => normalizeUsername("tecnico<script>"), /apenas letras/);
});

test("fallback de rota ordena pontos e identifica que nao usa ruas", async () => {
  const previousKey = process.env.ORS_API_KEY;
  delete process.env.ORS_API_KEY;
  try {
    const result = await optimizeRoute({
      origin: { latitude: -3.73, longitude: -38.52 },
      stops: [
        { id: 2, latitude: -3.80, longitude: -38.60 },
        { id: 1, latitude: -3.731, longitude: -38.521 },
      ],
      returnToOrigin: true,
    });
    assert.deepEqual(result.orderedStopIds, [1, 2]);
    assert.equal(result.provider, "estimativa-linear");
    assert.equal(result.geometry.type, "LineString");
    assert.equal(result.geometry.coordinates.length, 4);
    assert.match(result.warning, /linha reta/);
  } finally {
    if (previousKey === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = previousKey;
  }
});

test("busca de endereco sem ORS e tratada como configuracao ausente", async () => {
  const previousKey = process.env.ORS_API_KEY;
  delete process.env.ORS_API_KEY;
  try {
    await assert.rejects(
      geocodeAddress("Rua de teste, Caruaru - PE"),
      (error) => error.status === 409 && /nao configurada/.test(error.message),
    );
  } finally {
    if (previousKey === undefined) delete process.env.ORS_API_KEY;
    else process.env.ORS_API_KEY = previousKey;
  }
});

test("busca curta recebe contexto de Pernambuco sem alterar endereco ja completo", () => {
  const reference = { latitude: -8.2835, longitude: -35.9761 };
  assert.equal(
    contextualizeAddress("Rua Visconde de Inhauma, 100", reference),
    "Rua Visconde de Inhauma, 100, Pernambuco, Brasil",
  );
  assert.equal(
    contextualizeAddress("Avenida Boa Viagem, Recife - PE", reference),
    "Avenida Boa Viagem, Recife - PE",
  );
});

test("resultado de Caruaru e Pernambuco tem prioridade na busca", () => {
  const feature = (label, longitude, latitude, properties) => ({
    geometry: { coordinates: [longitude, latitude] },
    properties: { label, confidence: 0.8, layer: "address", ...properties },
  });
  const results = rankGeocodingFeatures([
    feature("Rua Central, Sao Paulo", -46.63, -23.55, { locality: "Sao Paulo", region_a: "SP" }),
    feature("Rua Central, Caruaru", -35.97, -8.28, { locality: "Caruaru", region_a: "PE" }),
  ], "Rua Central", { latitude: -8.2835, longitude: -35.9761 });
  assert.equal(results[0].cidade, "Caruaru");
  assert.equal(results[0].estado, "PE");
});

test("cidade informada em Pernambuco supera apenas a proximidade da base", () => {
  const feature = (label, longitude, latitude, locality) => ({
    geometry: { coordinates: [longitude, latitude] },
    properties: { label, confidence: 0.8, layer: "address", locality, region_a: "PE" },
  });
  const results = rankGeocodingFeatures([
    feature("Rua Central, Caruaru", -35.97, -8.28, "Caruaru"),
    feature("Rua Central, Petrolina", -40.50, -9.39, "Petrolina"),
  ], "Rua Central, Petrolina - PE", { latitude: -8.2835, longitude: -35.9761 });
  assert.equal(results[0].cidade, "Petrolina");
});

test("schema permite varias rotas para o mesmo tecnico e data", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../database/rotas.sql"), "utf8");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS rotas_planos_tecnico_id_data_key/);
  assert.doesNotMatch(sql, /UNIQUE\s*\(tecnico_id,\s*data\)/);
  assert.match(sql, /titulo TEXT NOT NULL DEFAULT 'Rota'/);
});

test("schema registra o historico e migra copias antigas para a mesma visita", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../database/rotas.sql"), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS motivo_status TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reagendada_para DATE/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reagendada_de_id INTEGER/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS relato_conclusao TEXT/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS reagendada_de_data DATE/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS historico_reagendamentos JSONB/);
  assert.match(sql, /ALTER COLUMN historico_reagendamentos SET NOT NULL/);
  assert.match(sql, /FOREIGN KEY \(reagendada_de_id\) REFERENCES rotas_paradas\(id\) ON DELETE SET NULL/);
  assert.match(sql, /JOIN rotas_paradas origem ON origem.id = destino.reagendada_de_id/);
  assert.match(sql, /DELETE FROM rotas_paradas WHERE id = item.destino_id/);
  assert.match(sql, /WHERE id = item.origem_id/);
});

test("nao realizada move a mesma parada e remove a rota anterior vazia", async () => {
  const queries = [];
  const planDate = isoDateOffset(1);
  const rescheduleDate = isoDateOffset(2);
  const plan = {
    id: 10, tecnico_id: 3, data: planDate, status: "publicada",
    origem_nome: "Empresa", origem_endereco: "Base", origem_latitude: -8.28,
    origem_longitude: -35.97, tecnico_nome: "Tecnico",
  };
  const source = {
    id: 20, plano_id: 10, cliente: "Cliente A", endereco: "Rua A",
    latitude: -8.3, longitude: -36, duracao_atendimento_min: 30,
    horario_inicio: null, horario_fim: null, observacoes: "Levar equipamento",
  };
  const connection = {
    async query(sql) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("FROM rotas_paradas WHERE id = $1") && sql.includes("FOR UPDATE")) return { rows: [source] };
      if (sql.includes("FROM rotas_planos") && sql.includes("titulo = 'Reagendamentos'")) return { rows: [] };
      if (sql.includes("INSERT INTO rotas_planos")) return { rows: [{ ...plan, id: 30, data: rescheduleDate, status: "rascunho", titulo: "Reagendamentos" }] };
      if (sql.includes("COALESCE(MAX(ordem)")) return { rows: [{ proxima: 1 }] };
      if (sql.includes("SET CONSTRAINTS")) return { rows: [] };
      if (sql.includes("SET plano_id = $1") && sql.includes("historico_reagendamentos")) {
        return { rows: [{ ...source, plano_id: 30, status: "pendente", motivo_status: "Cliente pediu outra data", reagendada_de_data: planDate, reagendada_para: rescheduleDate }] };
      }
      if (sql.includes("SELECT id, status FROM rotas_paradas WHERE plano_id")) return { rows: [] };
      if (sql.includes("DELETE FROM rotas_planos")) return { rows: [] };
      if (sql.includes("UPDATE rotas_planos SET")) return { rows: [] };
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM rotas_planos p")) return { rows: [plan] };
      throw new Error(`Consulta inesperada no pool: ${sql}`);
    },
    async connect() { return connection; },
  };

  const response = await invokeStopStatus(pool, {
    status: "nao_realizada",
    motivo: "Cliente pediu outra data",
    reagendarPara: rescheduleDate,
  });
  assert.equal(response.parada.id, 20);
  assert.equal(response.parada.plano_id, 30);
  assert.equal(response.parada.status, "pendente");
  assert.deepEqual(response.reagendamento, {
    planoId: 30, paradaId: 20, titulo: "Reagendamentos", data: rescheduleDate,
  });
  assert.equal(response.rotaOrigemRemovida, true);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO rotas_paradas")), false);
  assert.equal(queries.some((sql) => sql.includes("DELETE FROM rotas_planos")), true);
  assert.ok(queries.includes("COMMIT"));
});

test("reagendamento mantem a rota anterior quando ainda existem outras visitas", async () => {
  const queries = [];
  const planDate = isoDateOffset(1);
  const rescheduleDate = isoDateOffset(2);
  const plan = {
    id: 10, tecnico_id: 3, data: planDate, status: "publicada", tecnico_nome: "Tecnico",
    origem_nome: "Empresa", origem_endereco: "Base", origem_latitude: -8.28, origem_longitude: -35.97,
  };
  const connection = {
    async query(sql) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql.includes("pg_advisory_xact_lock") || sql.includes("SET CONSTRAINTS")) return { rows: [] };
      if (sql.includes("FROM rotas_paradas WHERE id = $1") && sql.includes("FOR UPDATE")) return { rows: [{ id: 20, plano_id: 10 }] };
      if (sql.includes("FROM rotas_planos") && sql.includes("titulo = 'Reagendamentos'")) {
        return { rows: [{ ...plan, id: 30, data: rescheduleDate, status: "rascunho", titulo: "Reagendamentos" }] };
      }
      if (sql.includes("COALESCE(MAX(ordem)")) return { rows: [{ proxima: 2 }] };
      if (sql.includes("SET plano_id = $1") && sql.includes("historico_reagendamentos")) {
        return { rows: [{ id: 20, plano_id: 30, ordem: 2, status: "pendente", reagendada_de_data: planDate, reagendada_para: rescheduleDate }] };
      }
      if (sql.includes("SELECT id, status FROM rotas_paradas WHERE plano_id")) return { rows: [{ id: 21, status: "pendente" }] };
      if (sql.includes("UPDATE rotas_paradas SET ordem")) return { rows: [] };
      if (sql.includes("UPDATE rotas_planos")) return { rows: [] };
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM rotas_planos p")) return { rows: [plan] };
      throw new Error(`Consulta inesperada no pool: ${sql}`);
    },
    async connect() { return connection; },
  };

  const response = await invokeStopStatus(pool, {
    status: "nao_realizada", motivo: "Cliente pediu", reagendarPara: rescheduleDate,
  });
  assert.equal(response.parada.id, 20);
  assert.equal(response.parada.plano_id, 30);
  assert.equal(response.rotaOrigemRemovida, false);
  assert.equal(response.rotaOrigemStatus, "publicada");
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO rotas_paradas")), false);
  assert.equal(queries.some((sql) => sql.includes("DELETE FROM rotas_planos")), false);
  assert.ok(queries.includes("COMMIT"));
});

test("conclusao exige e registra o relato sem criar reagendamento", async () => {
  const queries = [];
  const plan = { id: 10, tecnico_id: 3, data: isoDateOffset(0), status: "publicada", tecnico_nome: "Tecnico" };
  const source = { id: 20, plano_id: 10, cliente: "Cliente A", status: "em_atendimento" };
  const connection = {
    async query(sql) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("FROM rotas_paradas WHERE id = $1") && sql.includes("FOR UPDATE")) return { rows: [source] };
      if (sql.includes("UPDATE rotas_paradas") && sql.includes("relato_conclusao")) {
        return { rows: [{ ...source, status: "concluida", relato_conclusao: "Servico validado", reagendada_para: null }] };
      }
      if (sql.includes("COUNT(*)::int AS total")) return { rows: [{ total: 1 }] };
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM rotas_planos p")) return { rows: [plan] };
      throw new Error(`Consulta inesperada no pool: ${sql}`);
    },
    async connect() { return connection; },
  };

  const response = await invokeStopStatus(pool, { status: "concluida", motivo: "Servico validado" });
  assert.equal(response.parada.relato_conclusao, "Servico validado");
  assert.equal(response.reagendamento, null);
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO rotas_planos")), false);
});
