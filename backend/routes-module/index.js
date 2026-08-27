const express = require("express");
const { ensureRoutesSchema } = require("./schema");
const {
  createAuth,
  bootstrapSupervisor,
  hashPassword,
  normalizeUsername,
  requiredText,
  httpError,
} = require("./auth");
const { optimizeRoute, geocodeAddress } = require("./routing");

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function positiveId(value, field = "ID") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw httpError(`${field} invalido.`);
  return id;
}

function optionalBoolean(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw httpError(`${field} deve ser verdadeiro ou falso.`);
  return value;
}

function optionalText(value, max = 200) {
  if (value === undefined || value === null) return null;
  return String(value).trim().slice(0, max) || null;
}

function validDate(value, field = "a data") {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(`Informe ${field} no formato AAAA-MM-DD.`);
  const parsed = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw httpError("Data invalida.");
  }
  return text;
}

function validCoordinate(value, type) {
  const number = Number(value);
  const limit = type === "latitude" ? 90 : 180;
  if (!Number.isFinite(number) || Math.abs(number) > limit) throw httpError(`${type} invalida.`);
  return number;
}

function validTime(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw httpError(`${field} deve usar HH:MM.`);
  return text;
}

function validServiceDuration(value) {
  if (value === undefined || value === "") return 30;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1440) {
    throw httpError("Duracao do atendimento invalida.");
  }
  return number;
}

function translateDatabaseError(error) {
  if (error.code === "23505") {
    if (error.constraint === "idx_rotas_usuarios_usuario_unico") {
      return httpError("Este usuario ja esta cadastrado.", 409);
    }
    if (error.constraint === "idx_rotas_usuarios_tecnico_unico") {
      return httpError("Este tecnico ja possui um usuario de acesso.", 409);
    }
    return httpError("Registro duplicado.", 409);
  }
  if (error.code === "23503") return httpError("O registro informado nao existe ou esta em uso.", 409);
  return error;
}

async function getPlan(pool, planId, user, { lock = false } = {}) {
  const params = [planId];
  let access = "";
  if (user.perfil === "tecnico") {
    params.push(user.tecnico_id);
    access = `AND p.tecnico_id = $${params.length} AND p.status IN ('publicada', 'concluida')`;
  }
  const result = await pool.query(
    `SELECT p.*, t.nome AS tecnico_nome
     FROM rotas_planos p
     JOIN rotas_tecnicos t ON t.id = p.tecnico_id
     WHERE p.id = $1 ${access}
     ${lock ? "FOR UPDATE" : ""}`,
    params,
  );
  if (!result.rows.length) throw httpError("Rota nao encontrada.", 404);
  return result.rows[0];
}

async function getPlanDetails(pool, planId, user) {
  const plan = await getPlan(pool, planId, user);
  const stops = await pool.query(
    "SELECT * FROM rotas_paradas WHERE plano_id = $1 ORDER BY ordem, id",
    [planId],
  );
  return { ...plan, paradas: stops.rows };
}

function invalidateRouteSql() {
  return `status = 'rascunho', distancia_metros = NULL, duracao_segundos = NULL,
          geometria = NULL, provedor_rota = NULL, aviso_calculo = NULL,
          calculada_em = NULL, atualizado_em = NOW()`;
}

function createRoutesRouter(pool) {
  const router = express.Router();
  const auth = createAuth(pool);

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/setup-status", asyncRoute(async (_req, res) => {
    const result = await pool.query("SELECT EXISTS (SELECT 1 FROM rotas_usuarios WHERE perfil = 'supervisor') AS pronto");
    res.json({ pronto: result.rows[0].pronto });
  }));
  router.post("/auth/login", auth.login);
  router.use(auth.authenticate);
  router.get("/auth/me", (req, res) => res.json(auth.publicUser(req.routeUser, req.routeUser.csrf_token)));
  router.post("/auth/logout", auth.requireCsrf, auth.logout);
  router.post("/auth/trocar-senha", auth.requireCsrf, auth.changePassword);

  router.use((req, _res, next) => {
    if (req.routeUser.trocar_senha) return next(httpError("Troque a senha inicial para continuar.", 403));
    next();
  });

  router.get("/capacidades", (_req, res) => {
    res.json({
      buscaAutomatica: Boolean(process.env.ORS_API_KEY),
      calculoViario: Boolean(process.env.ORS_API_KEY),
    });
  });

  router.get("/tecnicos", asyncRoute(async (req, res) => {
    const params = [];
    let where = "";
    if (req.routeUser.perfil === "tecnico") {
      params.push(req.routeUser.tecnico_id);
      where = "WHERE id = $1";
    }
    const result = await pool.query(
      `SELECT id, nome, telefone, ativo, criado_em, atualizado_em
       FROM rotas_tecnicos ${where} ORDER BY ativo DESC, nome`,
      params,
    );
    res.json(result.rows);
  }));

  router.post("/tecnicos", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const name = requiredText(req.body?.nome, "o nome do tecnico", 120);
    const phone = optionalText(req.body?.telefone, 40);
    const result = await pool.query(
      `INSERT INTO rotas_tecnicos (nome, telefone) VALUES ($1, $2)
       RETURNING id, nome, telefone, ativo, criado_em, atualizado_em`,
      [name, phone],
    );
    res.status(201).json(result.rows[0]);
  }));

  router.patch("/tecnicos/:id", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id);
    const current = await pool.query("SELECT * FROM rotas_tecnicos WHERE id = $1", [id]);
    if (!current.rows.length) throw httpError("Tecnico nao encontrado.", 404);
    const name = req.body?.nome === undefined ? current.rows[0].nome : requiredText(req.body.nome, "o nome", 120);
    const phone = req.body?.telefone === undefined ? current.rows[0].telefone : optionalText(req.body.telefone, 40);
    const active = optionalBoolean(req.body?.ativo, "ativo") ?? current.rows[0].ativo;
    const result = await pool.query(
      `UPDATE rotas_tecnicos SET nome = $1, telefone = $2, ativo = $3, atualizado_em = NOW()
       WHERE id = $4 RETURNING id, nome, telefone, ativo, criado_em, atualizado_em`,
      [name, phone, active, id],
    );
    if (!active) await pool.query("DELETE FROM rotas_sessoes WHERE usuario_id IN (SELECT id FROM rotas_usuarios WHERE tecnico_id = $1)", [id]);
    res.json(result.rows[0]);
  }));

  router.get("/usuarios", auth.requireSupervisor, asyncRoute(async (_req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.usuario, u.nome, u.perfil, u.tecnico_id, u.ativo, u.trocar_senha,
              u.criado_em, t.nome AS tecnico_nome
       FROM rotas_usuarios u LEFT JOIN rotas_tecnicos t ON t.id = u.tecnico_id
       ORDER BY u.ativo DESC, u.nome`,
    );
    res.json(result.rows);
  }));

  router.post("/usuarios", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    try {
      const username = normalizeUsername(req.body?.usuario);
      const name = requiredText(req.body?.nome, "o nome", 120);
      const profile = req.body?.perfil;
      if (!['supervisor', 'tecnico'].includes(profile)) throw httpError("Perfil invalido.");
      const technicianId = profile === "tecnico" ? positiveId(req.body?.tecnicoId, "Tecnico") : null;
      if (technicianId) {
        const technician = await pool.query("SELECT id FROM rotas_tecnicos WHERE id = $1 AND ativo = TRUE", [technicianId]);
        if (!technician.rows.length) throw httpError("Tecnico inexistente ou inativo.", 409);
      }
      const passwordHash = await hashPassword(req.body?.senha);
      const result = await pool.query(
        `INSERT INTO rotas_usuarios (usuario, nome, senha_hash, perfil, tecnico_id, trocar_senha)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id, usuario, nome, perfil, tecnico_id, ativo, trocar_senha, criado_em`,
        [username, name, passwordHash, profile, technicianId],
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }));

  router.patch("/usuarios/:id", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const current = await pool.query("SELECT * FROM rotas_usuarios WHERE id = $1", [id]);
      if (!current.rows.length) throw httpError("Usuario nao encontrado.", 404);
      const name = req.body?.nome === undefined ? current.rows[0].nome : requiredText(req.body.nome, "o nome", 120);
      const active = optionalBoolean(req.body?.ativo, "ativo") ?? current.rows[0].ativo;
      if (id === req.routeUser.id && !active) throw httpError("Voce nao pode inativar o proprio usuario.", 409);
      let passwordHash = current.rows[0].senha_hash;
      let forceChange = current.rows[0].trocar_senha;
      if (req.body?.novaSenha !== undefined) {
        if (id === req.routeUser.id) {
          throw httpError("Use a opcao de troca de senha para alterar a propria senha.", 409);
        }
        passwordHash = await hashPassword(req.body.novaSenha);
        forceChange = true;
      }
      const result = await pool.query(
        `UPDATE rotas_usuarios
         SET nome = $1, ativo = $2, senha_hash = $3, trocar_senha = $4, atualizado_em = NOW()
         WHERE id = $5
         RETURNING id, usuario, nome, perfil, tecnico_id, ativo, trocar_senha, criado_em`,
        [name, active, passwordHash, forceChange, id],
      );
      if (!active || req.body?.novaSenha !== undefined) {
        await pool.query("DELETE FROM rotas_sessoes WHERE usuario_id = $1 AND token_hash <> $2", [id, req.routeUser.token_hash]);
      }
      res.json(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }));

  router.get("/configuracao", asyncRoute(async (_req, res) => {
    const result = await pool.query("SELECT * FROM rotas_configuracao WHERE id = 1");
    res.json(result.rows[0]);
  }));

  router.patch("/configuracao", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const name = requiredText(req.body?.empresaNome, "o nome da empresa", 120);
    const address = requiredText(req.body?.empresaEndereco, "o endereco da empresa", 300);
    const latitude = validCoordinate(req.body?.empresaLatitude, "latitude");
    const longitude = validCoordinate(req.body?.empresaLongitude, "longitude");
    if (latitude === 0 && longitude === 0) {
      throw httpError("Marque o ponto real da base da empresa no mapa antes de salvar.", 400);
    }
    const result = await pool.query(
      `UPDATE rotas_configuracao
       SET empresa_nome = $1, empresa_endereco = $2, empresa_latitude = $3,
           empresa_longitude = $4, atualizado_em = NOW()
       WHERE id = 1 RETURNING *`,
      [name, address, latitude, longitude],
    );
    res.json(result.rows[0]);
  }));

  router.post("/geocodificar", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const address = requiredText(req.body?.endereco, "o endereco", 300);
    const reference = {
      latitude: req.body?.referenciaLatitude === undefined
        ? undefined : validCoordinate(req.body.referenciaLatitude, "latitude"),
      longitude: req.body?.referenciaLongitude === undefined
        ? undefined : validCoordinate(req.body.referenciaLongitude, "longitude"),
    };
    res.json(await geocodeAddress(address, reference));
  }));

  router.get("/planos", asyncRoute(async (req, res) => {
    const params = [];
    const filters = [];
    if (req.query.data) {
      params.push(validDate(req.query.data));
      filters.push(`p.data = $${params.length}`);
    }
    if (req.routeUser.perfil === "tecnico") {
      params.push(req.routeUser.tecnico_id);
      filters.push(`p.tecnico_id = $${params.length}`);
      filters.push("p.status IN ('publicada', 'concluida')");
    } else if (req.query.tecnicoId) {
      params.push(positiveId(req.query.tecnicoId, "Tecnico"));
      filters.push(`p.tecnico_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(
       `SELECT p.*, t.nome AS tecnico_nome,
              COUNT(rp.id)::int AS total_paradas,
              (COUNT(rp.id) FILTER (WHERE rp.reagendada_para IS NOT NULL))::int AS total_reagendadas,
              (COUNT(rp.id) FILTER (WHERE rp.reagendada_de_data IS NOT NULL))::int AS total_recebidas_reagendamento,
              COALESCE(SUM(rp.duracao_atendimento_min), 0)::int AS duracao_clientes_min,
              COALESCE(
                JSONB_AGG(
                  JSONB_BUILD_OBJECT(
                    'id', rp.id,
                    'ordem', rp.ordem,
                    'cliente', rp.cliente,
                    'endereco', rp.endereco,
                    'duracao_atendimento_min', rp.duracao_atendimento_min,
                     'horario_inicio', rp.horario_inicio,
                     'horario_fim', rp.horario_fim,
                     'status', rp.status,
                     'motivo_status', rp.motivo_status,
                     'relato_conclusao', rp.relato_conclusao,
                     'reagendada_para', rp.reagendada_para,
                     'reagendada_de_data', rp.reagendada_de_data,
                     'historico_reagendamentos', rp.historico_reagendamentos,
                     'reagendada_de_id', rp.reagendada_de_id
                  ) ORDER BY rp.ordem, rp.id
                ) FILTER (WHERE rp.id IS NOT NULL),
                '[]'::jsonb
              ) AS paradas
       FROM rotas_planos p
       JOIN rotas_tecnicos t ON t.id = p.tecnico_id
       LEFT JOIN rotas_paradas rp ON rp.plano_id = p.id
       ${where}
       GROUP BY p.id, t.id
       ORDER BY p.data DESC, p.criado_em DESC
       LIMIT 200`,
      params,
    );
    res.json(result.rows);
  }));

  router.post("/planos", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    try {
      const technicianId = positiveId(req.body?.tecnicoId, "Tecnico");
      const date = validDate(req.body?.data);
      let title = optionalText(req.body?.titulo, 120);
      const [technician, config] = await Promise.all([
        pool.query("SELECT id FROM rotas_tecnicos WHERE id = $1 AND ativo = TRUE", [technicianId]),
        pool.query("SELECT * FROM rotas_configuracao WHERE id = 1"),
      ]);
      if (!technician.rows.length) throw httpError("Tecnico inexistente ou inativo.", 409);
      const settings = config.rows[0];
      if (!settings.empresa_endereco || settings.empresa_latitude === null || settings.empresa_longitude === null
        || (settings.empresa_latitude === 0 && settings.empresa_longitude === 0)) {
        throw httpError("Configure o endereco e o ponto da base da empresa antes de criar rotas.", 409);
      }
      if (!title) {
        const total = await pool.query(
          "SELECT COUNT(*)::int AS total FROM rotas_planos WHERE tecnico_id = $1 AND data = $2",
          [technicianId, date],
        );
        title = `Rota ${total.rows[0].total + 1}`;
      }
      const result = await pool.query(
        `INSERT INTO rotas_planos
         (tecnico_id, data, titulo, retornar_empresa, origem_nome, origem_endereco,
          origem_latitude, origem_longitude, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [technicianId, date, title, true, settings.empresa_nome, settings.empresa_endereco,
          settings.empresa_latitude, settings.empresa_longitude, req.routeUser.id],
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      throw translateDatabaseError(error);
    }
  }));

  router.get("/planos/:id", asyncRoute(async (req, res) => {
    res.json(await getPlanDetails(pool, positiveId(req.params.id), req.routeUser));
  }));

  router.patch("/planos/:id", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id);
    const plan = await getPlan(pool, id, req.routeUser);
    const status = req.body?.status ?? plan.status;
    const title = req.body?.titulo === undefined ? plan.titulo : requiredText(req.body.titulo, "o nome da rota", 120);
    if (!['rascunho', 'otimizada', 'publicada', 'concluida'].includes(status)) throw httpError("Status invalido.");
    if (status === "publicada" && !plan.geometria) throw httpError("Otimize a rota antes de publicar.", 409);
    const result = await pool.query(
      `UPDATE rotas_planos SET status = $1, titulo = $2, retornar_empresa = TRUE, atualizado_em = NOW()
       WHERE id = $3 RETURNING *`,
      [status, title, id],
    );
    res.json(result.rows[0]);
  }));

  router.delete("/planos/:id", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const id = positiveId(req.params.id);
    await getPlan(pool, id, req.routeUser);
    const reschedules = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM rotas_paradas rp
         WHERE rp.plano_id = $1
           AND (rp.reagendada_de_id IS NOT NULL
             OR JSONB_ARRAY_LENGTH(COALESCE(rp.historico_reagendamentos, '[]'::jsonb)) > 0
             OR EXISTS (
             SELECT 1 FROM rotas_paradas destino WHERE destino.reagendada_de_id = rp.id
           ))
       ) AS possui`,
      [id],
    );
    if (reschedules.rows[0].possui) {
      throw httpError("Esta rota possui historico de reagendamento e nao pode ser excluida.", 409);
    }
    await pool.query("DELETE FROM rotas_planos WHERE id = $1", [id]);
    res.status(204).end();
  }));

  router.post("/planos/:id/paradas", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const planId = positiveId(req.params.id);
    await getPlan(pool, planId, req.routeUser);
    const client = requiredText(req.body?.cliente, "o cliente", 160);
    const address = requiredText(req.body?.endereco, "o endereco", 300);
    const latitude = validCoordinate(req.body?.latitude, "latitude");
    const longitude = validCoordinate(req.body?.longitude, "longitude");
    const serviceDuration = validServiceDuration(req.body?.duracaoAtendimentoMin);
    const startTime = validTime(req.body?.horarioInicio, "Horario inicial");
    const endTime = validTime(req.body?.horarioFim, "Horario final");
    if (startTime && endTime && endTime <= startTime) throw httpError("Horario final deve ser posterior ao inicial.");
    const notes = optionalText(req.body?.observacoes, 500);
    const result = await pool.query(
      `INSERT INTO rotas_paradas
       (plano_id, ordem, cliente, endereco, latitude, longitude,
        duracao_atendimento_min, horario_inicio, horario_fim, observacoes)
       VALUES ($1, (SELECT COALESCE(MAX(ordem), 0) + 1 FROM rotas_paradas WHERE plano_id = $1),
               $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [planId, client, address, latitude, longitude, serviceDuration, startTime, endTime, notes],
    );
    await pool.query(`UPDATE rotas_planos SET ${invalidateRouteSql()} WHERE id = $1`, [planId]);
    res.status(201).json(result.rows[0]);
  }));

  router.patch("/planos/:planId/paradas/:stopId", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const planId = positiveId(req.params.planId);
    const stopId = positiveId(req.params.stopId);
    await getPlan(pool, planId, req.routeUser);
    const current = await pool.query("SELECT * FROM rotas_paradas WHERE id = $1 AND plano_id = $2", [stopId, planId]);
    if (!current.rows.length) throw httpError("Parada nao encontrada.", 404);
    const stop = current.rows[0];
    const client = req.body?.cliente === undefined ? stop.cliente : requiredText(req.body.cliente, "o cliente", 160);
    const address = req.body?.endereco === undefined ? stop.endereco : requiredText(req.body.endereco, "o endereco", 300);
    const latitude = req.body?.latitude === undefined ? stop.latitude : validCoordinate(req.body.latitude, "latitude");
    const longitude = req.body?.longitude === undefined ? stop.longitude : validCoordinate(req.body.longitude, "longitude");
    const serviceDuration = req.body?.duracaoAtendimentoMin === undefined ? stop.duracao_atendimento_min : validServiceDuration(req.body.duracaoAtendimentoMin);
    const startTime = req.body?.horarioInicio === undefined ? stop.horario_inicio : validTime(req.body.horarioInicio, "Horario inicial");
    const endTime = req.body?.horarioFim === undefined ? stop.horario_fim : validTime(req.body.horarioFim, "Horario final");
    const notes = req.body?.observacoes === undefined ? stop.observacoes : optionalText(req.body.observacoes, 500);
    if (startTime && endTime && String(endTime) <= String(startTime)) throw httpError("Horario final deve ser posterior ao inicial.");
    const result = await pool.query(
      `UPDATE rotas_paradas
       SET cliente = $1, endereco = $2, latitude = $3, longitude = $4,
           duracao_atendimento_min = $5, horario_inicio = $6, horario_fim = $7,
           observacoes = $8, atualizado_em = NOW()
       WHERE id = $9 AND plano_id = $10 RETURNING *`,
      [client, address, latitude, longitude, serviceDuration, startTime, endTime, notes, stopId, planId],
    );
    await pool.query(`UPDATE rotas_planos SET ${invalidateRouteSql()} WHERE id = $1`, [planId]);
    res.json(result.rows[0]);
  }));

  router.delete("/planos/:planId/paradas/:stopId", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const planId = positiveId(req.params.planId);
    const stopId = positiveId(req.params.stopId);
    await getPlan(pool, planId, req.routeUser);
    const reschedules = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM rotas_paradas rp
         WHERE rp.id = $1 AND rp.plano_id = $2
           AND (rp.reagendada_de_id IS NOT NULL
             OR JSONB_ARRAY_LENGTH(COALESCE(rp.historico_reagendamentos, '[]'::jsonb)) > 0
             OR EXISTS (
             SELECT 1 FROM rotas_paradas destino WHERE destino.reagendada_de_id = rp.id
           ))
       ) AS possui`,
      [stopId, planId],
    );
    if (reschedules.rows[0].possui) {
      throw httpError("Esta parada possui historico de reagendamento e nao pode ser excluida.", 409);
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const removed = await client.query("DELETE FROM rotas_paradas WHERE id = $1 AND plano_id = $2 RETURNING id", [stopId, planId]);
      if (!removed.rows.length) throw httpError("Parada nao encontrada.", 404);
      const remaining = await client.query("SELECT id FROM rotas_paradas WHERE plano_id = $1 ORDER BY ordem, id", [planId]);
      await client.query("SET CONSTRAINTS rotas_paradas_ordem_unica DEFERRED");
      for (let index = 0; index < remaining.rows.length; index += 1) {
        await client.query("UPDATE rotas_paradas SET ordem = $1 WHERE id = $2", [index + 1, remaining.rows[index].id]);
      }
      await client.query(`UPDATE rotas_planos SET ${invalidateRouteSql()} WHERE id = $1`, [planId]);
      await client.query("COMMIT");
      res.status(204).end();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post("/planos/:id/reordenar", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const planId = positiveId(req.params.id);
    await getPlan(pool, planId, req.routeUser);
    const ids = Array.isArray(req.body?.paradaIds) ? req.body.paradaIds.map((id) => positiveId(id, "Parada")) : [];
    const current = await pool.query("SELECT id FROM rotas_paradas WHERE plano_id = $1 ORDER BY ordem", [planId]);
    const currentIds = current.rows.map((row) => row.id);
    if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
      throw httpError("A nova ordem deve conter todas as paradas uma unica vez.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS rotas_paradas_ordem_unica DEFERRED");
      for (let index = 0; index < ids.length; index += 1) {
        await client.query("UPDATE rotas_paradas SET ordem = $1, atualizado_em = NOW() WHERE id = $2 AND plano_id = $3", [index + 1, ids[index], planId]);
      }
      await client.query(`UPDATE rotas_planos SET ${invalidateRouteSql()} WHERE id = $1`, [planId]);
      await client.query("COMMIT");
      res.json(await getPlanDetails(pool, planId, req.routeUser));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  router.post("/planos/:id/otimizar", auth.requireSupervisor, auth.requireCsrf, asyncRoute(async (req, res) => {
    const planId = positiveId(req.params.id);
    const plan = await getPlan(pool, planId, req.routeUser);
    const stopsResult = await pool.query("SELECT * FROM rotas_paradas WHERE plano_id = $1 ORDER BY ordem, id", [planId]);
    const result = await optimizeRoute({
      origin: { latitude: plan.origem_latitude, longitude: plan.origem_longitude },
      stops: stopsResult.rows,
      returnToOrigin: true,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET CONSTRAINTS rotas_paradas_ordem_unica DEFERRED");
      for (let index = 0; index < result.orderedStopIds.length; index += 1) {
        await client.query("UPDATE rotas_paradas SET ordem = $1, atualizado_em = NOW() WHERE id = $2 AND plano_id = $3", [index + 1, result.orderedStopIds[index], planId]);
      }
      await client.query(
        `UPDATE rotas_planos
         SET status = 'otimizada', distancia_metros = $1, duracao_segundos = $2,
             geometria = $3::jsonb, provedor_rota = $4, aviso_calculo = $5,
             calculada_em = NOW(), atualizado_em = NOW()
         WHERE id = $6`,
        [result.distanceMeters, result.durationSeconds, JSON.stringify(result.geometry), result.provider, result.warning, planId],
      );
      await client.query("COMMIT");
      res.json(await getPlanDetails(pool, planId, req.routeUser));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  router.patch("/planos/:planId/paradas/:stopId/status", auth.requireCsrf, asyncRoute(async (req, res) => {
    const planId = positiveId(req.params.planId);
    const stopId = positiveId(req.params.stopId);
    const status = req.body?.status;
    if (!['pendente', 'em_atendimento', 'concluida', 'nao_realizada'].includes(status)) throw httpError("Status invalido.");
    const plan = await getPlan(pool, planId, req.routeUser);
    if (plan.status === 'concluida') throw httpError("Esta rota ja foi concluida e nao aceita novas alteracoes.", 409);
    const motive = ['concluida', 'nao_realizada'].includes(status)
      ? requiredText(req.body?.motivo, status === 'concluida' ? "uma observacao da conclusao" : "o motivo da nao realizacao", 500)
      : null;
    const rescheduleDate = status === 'nao_realizada'
      ? validDate(req.body?.reagendarPara, "a nova data")
      : null;
    const planDate = plan.data instanceof Date ? plan.data.toISOString().slice(0, 10) : String(plan.data).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    if (rescheduleDate && (rescheduleDate <= planDate || rescheduleDate < today)) {
      throw httpError("A nova data deve ser futura em relacao a rota e nao pode estar no passado.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sourceResult = await client.query(
        "SELECT * FROM rotas_paradas WHERE id = $1 AND plano_id = $2 FOR UPDATE",
        [stopId, planId],
      );
      if (!sourceResult.rows.length) throw httpError("Parada nao encontrada.", 404);

      let rescheduled = null;
      let updatedStop = null;
      let sourceRouteRemoved = false;
      let sourceRouteStatus = plan.status;
      if (status === 'nao_realizada') {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rotas-reagendamento:${plan.tecnico_id}:${rescheduleDate}`]);
        let targetResult = await client.query(
          `SELECT * FROM rotas_planos
           WHERE tecnico_id = $1 AND data = $2 AND status = 'rascunho' AND titulo = 'Reagendamentos'
           ORDER BY criado_em DESC LIMIT 1 FOR UPDATE`,
          [plan.tecnico_id, rescheduleDate],
        );
        if (!targetResult.rows.length) {
          targetResult = await client.query(
            `INSERT INTO rotas_planos
             (tecnico_id, data, titulo, retornar_empresa, origem_nome, origem_endereco,
              origem_latitude, origem_longitude, criado_por)
             VALUES ($1, $2, 'Reagendamentos', TRUE, $3, $4, $5, $6, $7)
             RETURNING *`,
            [plan.tecnico_id, rescheduleDate, plan.origem_nome, plan.origem_endereco,
              plan.origem_latitude, plan.origem_longitude, req.routeUser.id],
          );
        }
        const target = targetResult.rows[0];
        const orderResult = await client.query(
          "SELECT COALESCE(MAX(ordem), 0)::int + 1 AS proxima FROM rotas_paradas WHERE plano_id = $1",
          [target.id],
        );
        await client.query("SET CONSTRAINTS rotas_paradas_ordem_unica DEFERRED");
        const moved = await client.query(
          `UPDATE rotas_paradas
           SET plano_id = $1, ordem = $2, status = 'pendente',
               motivo_status = $3, relato_conclusao = NULL,
               reagendada_de_data = $4, reagendada_para = $5,
               historico_reagendamentos = COALESCE(historico_reagendamentos, '[]'::jsonb)
                 || JSONB_BUILD_ARRAY(JSONB_BUILD_OBJECT(
                   'dataAnterior', $4::date,
                   'novaData', $5::date,
                   'motivo', $3::text,
                   'registradoEm', NOW(),
                   'usuarioId', $6::int
                 )),
               atualizado_em = NOW()
           WHERE id = $7 AND plano_id = $8
           RETURNING *`,
          [target.id, orderResult.rows[0].proxima, motive, planDate, rescheduleDate,
            req.routeUser.id, stopId, planId],
        );
        if (!moved.rows.length) throw httpError("Parada nao encontrada.", 404);
        updatedStop = moved.rows[0];

        const remaining = await client.query(
          "SELECT id, status FROM rotas_paradas WHERE plano_id = $1 ORDER BY ordem, id",
          [planId],
        );
        for (let index = 0; index < remaining.rows.length; index += 1) {
          await client.query(
            "UPDATE rotas_paradas SET ordem = $1, atualizado_em = NOW() WHERE id = $2 AND plano_id = $3",
            [index + 1, remaining.rows[index].id, planId],
          );
        }
        if (!remaining.rows.length) {
          await client.query("DELETE FROM rotas_planos WHERE id = $1", [planId]);
          sourceRouteRemoved = true;
          sourceRouteStatus = null;
        } else {
          const allFinished = remaining.rows.every((item) => ['concluida', 'nao_realizada'].includes(item.status));
          sourceRouteStatus = allFinished ? 'concluida' : plan.status;
          await client.query(
            `UPDATE rotas_planos
             SET status = $1, distancia_metros = NULL, duracao_segundos = NULL,
                 geometria = NULL, provedor_rota = NULL,
                 aviso_calculo = 'Rota alterada por reagendamento. O ADM pode otimizar novamente.',
                 calculada_em = NULL, atualizado_em = NOW()
             WHERE id = $2`,
            [sourceRouteStatus, planId],
          );
        }
        await client.query(`UPDATE rotas_planos SET ${invalidateRouteSql()} WHERE id = $1`, [target.id]);
        rescheduled = {
          planoId: target.id,
          paradaId: stopId,
          titulo: target.titulo,
          data: rescheduleDate,
        };
      } else {
        const updatedResult = status === 'concluida'
          ? await client.query(
            `UPDATE rotas_paradas
             SET status = $1, relato_conclusao = $2, atualizado_em = NOW()
             WHERE id = $3 AND plano_id = $4 RETURNING *`,
            [status, motive, stopId, planId],
          )
          : await client.query(
            `UPDATE rotas_paradas SET status = $1, atualizado_em = NOW()
             WHERE id = $2 AND plano_id = $3 RETURNING *`,
            [status, stopId, planId],
          );
        updatedStop = updatedResult.rows[0];
        const pending = await client.query(
          "SELECT COUNT(*)::int AS total FROM rotas_paradas WHERE plano_id = $1 AND status NOT IN ('concluida', 'nao_realizada')",
          [planId],
        );
        if (pending.rows[0].total === 0) {
          await client.query("UPDATE rotas_planos SET status = 'concluida', atualizado_em = NOW() WHERE id = $1 AND status = 'publicada'", [planId]);
          sourceRouteStatus = 'concluida';
        }
      }
      await client.query("COMMIT");
      res.json({
        parada: updatedStop,
        reagendamento: rescheduled,
        rotaOrigemRemovida: sourceRouteRemoved,
        rotaOrigemStatus: sourceRouteStatus,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw translateDatabaseError(error);
    } finally {
      client.release();
    }
  }));

  router.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error("Erro no modulo de rotas:", error);
    res.status(status).json({
      erro: status >= 500 ? "Erro interno no modulo de rotas." : error.message,
    });
  });

  return router;
}

async function initializeRoutesModule(pool) {
  await ensureRoutesSchema(pool);
  return bootstrapSupervisor(pool);
}

module.exports = { createRoutesRouter, initializeRoutesModule };
