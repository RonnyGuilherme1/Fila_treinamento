# Rotas externas

O modulo fica em `/rotas/rotas.html`. As telas atuais continuam abertas; somente
Rotas externas exige login.

## Primeiro acesso em producao

Antes do primeiro deploy, configure no servico do backend:

- `ROUTES_BOOTSTRAP_USER`: usuario do primeiro ADM/Supervisor;
- `ROUTES_BOOTSTRAP_PASSWORD`: senha inicial com pelo menos 10 caracteres;
- `ROUTES_BOOTSTRAP_NAME`: nome exibido, opcional;
- `ROUTES_SESSION_HOURS`: duracao da sessao entre 1 e 168 horas, opcional;
- `NODE_ENV=production`: ativa o atributo `Secure` no cookie de sessao.

Na inicializacao, o backend aplica `database/rotas.sql` e cria o primeiro
supervisor apenas quando ainda nao existe nenhum. Depois do primeiro acesso e da
troca obrigatoria de senha, `ROUTES_BOOTSTRAP_PASSWORD` pode ser removida do
ambiente e o servico pode ser reiniciado.

O modulo protegido deve ser aberto pelo mesmo dominio do backend (ou por um
proxy reverso no mesmo dominio), pois a sessao usa cookie HttpOnly e SameSite.

## Mapa e calculo viario

Sem configuracao externa, o mapa e o planejamento funcionam e a opcao Otimizar
gera somente uma estimativa por proximidade e linha reta. A interface identifica
essa limitacao; ela nao deve ser tratada como navegacao real.

Para localizar enderecos e calcular a sequencia e o trajeto pelas ruas, configure:

- `ORS_API_KEY`: chave da API openrouteservice/HeiGIT;
- `ORS_BASE_URL`: URL alternativa apenas para uma instancia propria, opcional. Sem essa variavel, o modulo usa os endpoints atuais de `api.heigit.org`;
- `ROUTES_REQUIRE_ROAD_ROUTING=true`: opcional; impede fallback linear quando o
  provedor viario falhar.

As chaves permanecem apenas no backend. O mapa do piloto utiliza Leaflet e os
tiles publicos do OpenStreetMap com atribuicao visivel. Para volume de producao,
troque os tiles publicos por um provedor gerenciado compatível com OpenStreetMap.

## Perfis

- `supervisor`: gerencia tecnicos, usuarios, empresa, paradas e publicacao;
- `tecnico`: consulta somente as rotas vinculadas ao proprio cadastro e atualiza
  o status das visitas.

Usuarios tecnicos precisam estar ligados a um tecnico ativo. Toda alteracao feita
por cookie de sessao exige tambem o token CSRF entregue apos o login.

## Validacao local

No diretorio `backend`:

```powershell
npm.cmd test
npm.cmd start
```

Para iniciar o servidor, `DATABASE_URL` precisa apontar para um PostgreSQL no
qual o usuario tenha permissao para criar as tabelas do modulo.
