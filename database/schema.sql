CREATE TABLE fila_treinamento (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  posicao INTEGER
);

CREATE INDEX idx_posicao_treinamento ON fila_treinamento (posicao);

CREATE TABLE fila_manutencao (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  posicao INTEGER
);

CREATE INDEX idx_posicao_manutencao ON fila_manutencao (posicao);

CREATE TABLE historico_treinamento (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  cliente TEXT,
  tipo TEXT,
  motivo TEXT,
  data TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  data_fim TIMESTAMP
);

CREATE INDEX idx_data_historico_treinamento ON historico_treinamento (data DESC);
CREATE INDEX idx_pessoa_historico_treinamento ON historico_treinamento (pessoa);
CREATE INDEX idx_hist_treinamento_finalizar ON historico_treinamento (pessoa, cliente, data_fim, id DESC);

CREATE TABLE historico_manutencao (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  equipamento TEXT,
  data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_data_historico_manutencao ON historico_manutencao (data DESC);

CREATE TABLE atendimento_atual (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  cliente TEXT
);
