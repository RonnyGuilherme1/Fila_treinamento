const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "rotas_session";
const SESSION_HOURS = Math.max(1, Math.min(Number(process.env.ROUTES_SESSION_HOURS) || 12, 168));
const PASSWORD_MIN_LENGTH = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();
let dummyPasswordHash;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requiredText(value, field, max = 120) {
  const text = String(value || "").trim();
  if (!text) throw httpError(`Informe ${field}.`);
  if (text.length > max) throw httpError(`${field} deve ter no maximo ${max} caracteres.`);
  return text;
}

function normalizeUsername(value) {
  const username = requiredText(value, "o usuario", 80).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw httpError("Usuario deve conter apenas letras sem acento, numeros, ponto, traco ou sublinhado.");
  }
  return username;
}

function validatePassword(password) {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH || value.length > 200) {
    throw httpError(`A senha deve ter entre ${PASSWORD_MIN_LENGTH} e 200 caracteres.`);
  }
  return value;
}

async function hashPassword(password) {
  const value = validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password, stored) {
  try {
    const [algorithm, n, r, p, saltValue, hashValue] = String(stored || "").split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(hashValue, "base64url");
    const actual = await scrypt(String(password || ""), Buffer.from(saltValue, "base64url"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_error) {
    return false;
  }
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index <= 0) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_error) {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = SESSION_HOURS * 60 * 60;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function publicUser(row, csrfToken) {
  return {
    id: row.id,
    usuario: row.usuario,
    nome: row.nome,
    perfil: row.perfil,
    tecnicoId: row.tecnico_id || null,
    tecnicoNome: row.tecnico_nome || null,
    trocarSenha: row.trocar_senha === true,
    csrfToken,
  };
}

async function createSession(pool, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO rotas_sessoes (token_hash, usuario_id, csrf_token, expira_em)
     VALUES ($1, $2, $3, $4)`,
    [sessionHash(token), userId, csrfToken, expiresAt],
  );
  return { token, csrfToken };
}

function loginKey(req, username) {
  return `${req.ip || req.socket.remoteAddress || "unknown"}|${username}`;
}

function checkLoginRate(key) {
  const now = Date.now();
  const state = loginFailures.get(key);
  if (!state || now - state.startedAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return;
  }
  if (state.count >= LOGIN_MAX_FAILURES) {
    throw httpError("Muitas tentativas de login. Aguarde 15 minutos.", 429);
  }
}

function registerLoginFailure(key) {
  const now = Date.now();
  if (loginFailures.size > 5000) {
    for (const [entryKey, entry] of loginFailures) {
      if (now - entry.startedAt > LOGIN_WINDOW_MS) loginFailures.delete(entryKey);
    }
    if (loginFailures.size > 5000) loginFailures.clear();
  }
  const state = loginFailures.get(key);
  if (!state || now - state.startedAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, startedAt: now });
  } else {
    state.count += 1;
  }
}

function safeTokenEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAuth(pool) {
  async function authenticate(req, _res, next) {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (!token) throw httpError("Faca login para acessar Rotas externas.", 401);

      const result = await pool.query(
        `SELECT u.id, u.usuario, u.nome, u.perfil, u.tecnico_id, u.trocar_senha,
                t.nome AS tecnico_nome, s.csrf_token, s.token_hash
         FROM rotas_sessoes s
         JOIN rotas_usuarios u ON u.id = s.usuario_id
         LEFT JOIN rotas_tecnicos t ON t.id = u.tecnico_id
         WHERE s.token_hash = $1
           AND s.expira_em > NOW()
           AND u.ativo = TRUE
           AND (u.perfil <> 'tecnico' OR t.ativo = TRUE)`,
        [sessionHash(token)],
      );

      if (!result.rows.length) throw httpError("Sessao expirada. Faca login novamente.", 401);
      req.routeUser = result.rows[0];
      await pool.query("UPDATE rotas_sessoes SET ultimo_uso_em = NOW() WHERE token_hash = $1", [result.rows[0].token_hash]);
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireSupervisor(req, _res, next) {
    if (req.routeUser?.perfil !== "supervisor") {
      return next(httpError("Acesso permitido apenas para ADM/Supervisor.", 403));
    }
    next();
  }

  function requireCsrf(req, _res, next) {
    if (!safeTokenEqual(req.headers["x-csrf-token"], req.routeUser?.csrf_token)) {
      return next(httpError("Sessao invalida. Atualize a pagina e tente novamente.", 403));
    }
    next();
  }

  async function login(req, res, next) {
    try {
      const username = normalizeUsername(req.body?.usuario);
      const key = loginKey(req, username);
      checkLoginRate(key);

      const result = await pool.query(
        `SELECT u.*, t.nome AS tecnico_nome, t.ativo AS tecnico_ativo
         FROM rotas_usuarios u
         LEFT JOIN rotas_tecnicos t ON t.id = u.tecnico_id
         WHERE LOWER(u.usuario) = $1`,
        [username],
      );
      const user = result.rows[0];
      if (!dummyPasswordHash) dummyPasswordHash = await hashPassword("credencial-invalida-interna");
      const passwordValid = await verifyPassword(req.body?.senha, user?.senha_hash || dummyPasswordHash);
      const valid = user && user.ativo && (user.perfil !== "tecnico" || user.tecnico_ativo)
        && passwordValid;

      if (!valid) {
        registerLoginFailure(key);
        throw httpError("Usuario ou senha invalidos.", 401);
      }

      loginFailures.delete(key);
      const session = await createSession(pool, user.id);
      res.setHeader("Set-Cookie", sessionCookie(session.token));
      res.json(publicUser(user, session.csrfToken));
    } catch (error) {
      next(error);
    }
  }

  async function logout(req, res, next) {
    try {
      await pool.query("DELETE FROM rotas_sessoes WHERE token_hash = $1", [req.routeUser.token_hash]);
      res.setHeader("Set-Cookie", clearSessionCookie());
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  async function changePassword(req, res, next) {
    try {
      const current = await pool.query("SELECT senha_hash FROM rotas_usuarios WHERE id = $1", [req.routeUser.id]);
      if (!await verifyPassword(req.body?.senhaAtual, current.rows[0]?.senha_hash)) {
        throw httpError("Senha atual incorreta.", 400);
      }
      const passwordHash = await hashPassword(req.body?.novaSenha);
      await pool.query(
        `UPDATE rotas_usuarios SET senha_hash = $1, trocar_senha = FALSE, atualizado_em = NOW()
         WHERE id = $2`,
        [passwordHash, req.routeUser.id],
      );
      await pool.query("DELETE FROM rotas_sessoes WHERE usuario_id = $1 AND token_hash <> $2", [req.routeUser.id, req.routeUser.token_hash]);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  return {
    authenticate,
    requireSupervisor,
    requireCsrf,
    login,
    logout,
    changePassword,
    publicUser,
  };
}

async function bootstrapSupervisor(pool) {
  const count = await pool.query("SELECT COUNT(*)::int AS total FROM rotas_usuarios WHERE perfil = 'supervisor'");
  if (count.rows[0].total > 0) return { created: false, ready: true };

  const usernameValue = process.env.ROUTES_BOOTSTRAP_USER;
  const passwordValue = process.env.ROUTES_BOOTSTRAP_PASSWORD;
  if (!usernameValue || !passwordValue) {
    console.warn("Rotas externas: configure ROUTES_BOOTSTRAP_USER e ROUTES_BOOTSTRAP_PASSWORD para criar o primeiro supervisor.");
    return { created: false, ready: false };
  }

  const username = normalizeUsername(usernameValue);
  const name = String(process.env.ROUTES_BOOTSTRAP_NAME || "Administrador de rotas").trim().slice(0, 120);
  const passwordHash = await hashPassword(passwordValue);
  await pool.query(
    `INSERT INTO rotas_usuarios (usuario, nome, senha_hash, perfil, trocar_senha)
     VALUES ($1, $2, $3, 'supervisor', TRUE)`,
    [username, name, passwordHash],
  );
  console.log(`Rotas externas: supervisor inicial '${username}' criado.`);
  return { created: true, ready: true };
}

module.exports = {
  createAuth,
  bootstrapSupervisor,
  hashPassword,
  verifyPassword,
  normalizeUsername,
  requiredText,
  validatePassword,
  httpError,
};
