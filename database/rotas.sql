-- Modulo protegido de rotas externas.
-- Este arquivo e idempotente e e aplicado pelo backend na inicializacao.

CREATE TABLE IF NOT EXISTS rotas_tecnicos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rotas_tecnicos_ativos
ON rotas_tecnicos (ativo, nome);

CREATE TABLE IF NOT EXISTS rotas_usuarios (
  id SERIAL PRIMARY KEY,
  usuario TEXT NOT NULL,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil TEXT NOT NULL CHECK (perfil IN ('supervisor', 'tecnico')),
  tecnico_id INTEGER REFERENCES rotas_tecnicos(id),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  trocar_senha BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rotas_usuarios_perfil_tecnico_ck CHECK (
    (perfil = 'supervisor' AND tecnico_id IS NULL)
    OR (perfil = 'tecnico' AND tecnico_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rotas_usuarios_usuario_unico
ON rotas_usuarios (LOWER(usuario));

CREATE UNIQUE INDEX IF NOT EXISTS idx_rotas_usuarios_tecnico_unico
ON rotas_usuarios (tecnico_id)
WHERE tecnico_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS rotas_sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES rotas_usuarios(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_uso_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rotas_sessoes_expiracao
ON rotas_sessoes (expira_em);

CREATE TABLE IF NOT EXISTS rotas_configuracao (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  empresa_nome TEXT NOT NULL DEFAULT 'Empresa',
  empresa_endereco TEXT,
  empresa_latitude DOUBLE PRECISION,
  empresa_longitude DOUBLE PRECISION,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO rotas_configuracao (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS rotas_planos (
  id SERIAL PRIMARY KEY,
  tecnico_id INTEGER NOT NULL REFERENCES rotas_tecnicos(id),
  data DATE NOT NULL,
  titulo TEXT NOT NULL DEFAULT 'Rota',
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'otimizada', 'publicada', 'concluida')),
  retornar_empresa BOOLEAN NOT NULL DEFAULT TRUE,
  origem_nome TEXT,
  origem_endereco TEXT,
  origem_latitude DOUBLE PRECISION,
  origem_longitude DOUBLE PRECISION,
  distancia_metros INTEGER,
  duracao_segundos INTEGER,
  geometria JSONB,
  provedor_rota TEXT,
  aviso_calculo TEXT,
  calculada_em TIMESTAMPTZ,
  criado_por INTEGER REFERENCES rotas_usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rotas_planos
ADD COLUMN IF NOT EXISTS titulo TEXT;

UPDATE rotas_planos
SET titulo = 'Rota #' || id
WHERE titulo IS NULL OR BTRIM(titulo) = '';

ALTER TABLE rotas_planos
ALTER COLUMN titulo SET DEFAULT 'Rota',
ALTER COLUMN titulo SET NOT NULL;

ALTER TABLE rotas_planos
DROP CONSTRAINT IF EXISTS rotas_planos_tecnico_id_data_key;

CREATE INDEX IF NOT EXISTS idx_rotas_planos_data
ON rotas_planos (data, tecnico_id);

UPDATE rotas_planos
SET retornar_empresa = TRUE
WHERE retornar_empresa IS DISTINCT FROM TRUE;

CREATE TABLE IF NOT EXISTS rotas_paradas (
  id SERIAL PRIMARY KEY,
  plano_id INTEGER NOT NULL REFERENCES rotas_planos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL CHECK (ordem > 0),
  cliente TEXT NOT NULL,
  endereco TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  duracao_atendimento_min INTEGER NOT NULL DEFAULT 30
    CHECK (duracao_atendimento_min BETWEEN 0 AND 1440),
  horario_inicio TIME,
  horario_fim TIME,
  observacoes TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'em_atendimento', 'concluida', 'nao_realizada')),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rotas_paradas_ordem_unica
    UNIQUE (plano_id, ordem) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT rotas_paradas_horario_ck CHECK (
    horario_inicio IS NULL OR horario_fim IS NULL OR horario_fim > horario_inicio
  )
);

CREATE INDEX IF NOT EXISTS idx_rotas_paradas_plano
ON rotas_paradas (plano_id, ordem);
