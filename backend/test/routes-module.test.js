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

test("schema permite varias rotas para o mesmo tecnico e data", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../database/rotas.sql"), "utf8");
  assert.match(sql, /DROP CONSTRAINT IF EXISTS rotas_planos_tecnico_id_data_key/);
  assert.doesNotMatch(sql, /UNIQUE\s*\(tecnico_id,\s*data\)/);
  assert.match(sql, /titulo TEXT NOT NULL DEFAULT 'Rota'/);
});
