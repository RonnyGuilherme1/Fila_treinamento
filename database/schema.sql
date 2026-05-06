-- =============================
-- FILAS
-- =============================

CREATE TABLE IF NOT EXISTS fila_treinamento (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  posicao INTEGER
);

CREATE INDEX IF NOT EXISTS idx_posicao_treinamento
ON fila_treinamento (posicao);

CREATE TABLE IF NOT EXISTS fila_manutencao (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  posicao INTEGER
);

CREATE INDEX IF NOT EXISTS idx_posicao_manutencao
ON fila_manutencao (posicao);

-- =============================
-- ATENDIMENTOS (ATUAL)
-- =============================

CREATE TABLE IF NOT EXISTS atendimentos (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  cliente TEXT,
  fim TIMESTAMP
);

-- =============================
-- HISTÓRICO TREINAMENTO
-- =============================

CREATE TABLE IF NOT EXISTS historico_treinamento (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  cliente TEXT,
  tipo TEXT,
  motivo TEXT,
  data_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  data_fim TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hist_treinamento_data
ON historico_treinamento (data_inicio DESC);

CREATE INDEX IF NOT EXISTS idx_hist_treinamento_pessoa
ON historico_treinamento (pessoa);

-- =============================
-- HISTÓRICO MANUTENÇÃO
-- =============================

CREATE TABLE IF NOT EXISTS historico_manutencao (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  equipamento TEXT,
  data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hist_manutencao_data
ON historico_manutencao (data DESC);
