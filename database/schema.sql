CREATE TABLE fila_treinamento (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  posicao INTEGER
);

CREATE TABLE fila_manutencao (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  posicao INTEGER
);

CREATE TABLE historico_treinamento (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  cliente TEXT,
  tipo TEXT,
  motivo TEXT,
  data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE historico_manutencao (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  equipamento TEXT,
  data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE atendimento_atual (
  id SERIAL PRIMARY KEY,
  pessoa TEXT,
  cliente TEXT
);
