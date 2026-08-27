const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hashPassword,
  verifyPassword,
  normalizeUsername,
} = require("../routes-module/auth");
const { optimizeRoute } = require("../routes-module/routing");

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
