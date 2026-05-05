// =============================
// 🌐 CONFIG API
// =============================
const API =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://fila-treinamento.onrender.com";

// =============================
// 🔄 TROCA DE ABAS
// =============================
function trocarAba(nome) {
  document
    .querySelectorAll(".aba")
    .forEach((sec) => sec.classList.remove("ativa"));

  document.getElementById(nome).classList.add("ativa");

  document.getElementById("titulo").innerText =
    nome === "treinamento" ? "Treinamento" : "Manutenção";
}

// =============================
// ▶️ INICIAR TREINAMENTO
// =============================
async function chamarTreinamento() {
  const cliente = document.getElementById("clienteTreinamento").value;
  if (!cliente) return alert("Informe o cliente");

  const fila = await fetch(`${API}/fila/treinamento`).then((r) => r.json());
  if (!fila.length) return alert("Fila vazia");

  const pessoa = fila[0].nome;

  await fetch(`${API}/atendimento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, cliente }),
  });

  await fetch(`${API}/fila/treinamento/rotacionar`, {
    method: "POST",
  });

  atualizar();
}

// =============================
// 🛑 FINALIZAR ATENDIMENTO ESPECÍFICO
// =============================
async function finalizarAtendimento(id) {
  await fetch(`${API}/atendimento/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  atualizar();
}

// =============================
// ⏭️ PULAR
// =============================
async function pularTreinamento() {
  const motivo = prompt("Motivo:");
  if (!motivo) return;

  const fila = await fetch(`${API}/fila/treinamento`).then((r) => r.json());
  const pessoa = fila[0].nome;

  await fetch(`${API}/pular`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, motivo }),
  });

  await fetch(`${API}/fila/treinamento/rotacionar`, {
    method: "POST",
  });

  atualizar();
}

// =============================
// 🛠️ MANUTENÇÃO
// =============================
async function chamarManutencao() {
  const equipamento = document.getElementById("equipamento").value;
  if (!equipamento) return alert("Informe o equipamento");

  const fila = await fetch(`${API}/fila/manutencao`).then((r) => r.json());
  const pessoa = fila[0].nome;

  await fetch(`${API}/manutencao`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, equipamento }),
  });

  await fetch(`${API}/fila/manutencao/rotacionar`, {
    method: "POST",
  });

  atualizar();
}

// =============================
// 🚀 ATUALIZAÇÃO PRINCIPAL
// =============================
async function atualizar() {
  const data = await fetch(`${API}/dashboard`).then((r) => r.json());

  const { fila, filaManut, historico, historicoManut } = data;

  const atendimentos = await fetch(`${API}/atendimento`).then((r) => r.json());

  // =============================
  // ATENDIMENTOS MULTI
  // =============================
  const box = document.getElementById("atendendoAgora");

  box.innerHTML = atendimentos.length
    ? atendimentos
        .map(
          (a) => `
          <div class="at-item" onclick="finalizarAtendimento(${a.id})">
            ${a.pessoa} → ${a.cliente}
          </div>
        `,
        )
        .join("")
    : "-";

  // =============================
  // FILA TREINAMENTO
  // =============================
  document.getElementById("proximoTreinamento").innerText =
    fila[0]?.nome || "-";

  document.getElementById("totalTreinamento").innerText = fila.length;

  document.getElementById("filaTreinamento").innerHTML = fila
    .map((p, i) => `<li>${i + 1}º - ${p.nome}</li>`)
    .join("");

  // =============================
  // HISTÓRICO TREINAMENTO (INÍCIO/FIM)
  // =============================
  const h = document.getElementById("historicoTreinamento");

  h.innerHTML = historico
    .map((item) => {
      const inicio = new Date(item.data_inicio || item.data);
      const fim = item.data_fim ? new Date(item.data_fim) : null;

      return `
        <tr>
          <td>${item.pessoa}</td>
          <td>${item.cliente}</td>
          <td>${inicio.toLocaleString()}</td>
          <td>${fim ? fim.toLocaleString() : "Em andamento"}</td>
        </tr>
      `;
    })
    .join("");

  // =============================
  // RANKING (ORDENADO)
  // =============================
  const ranking = {};

  historico.forEach((h) => {
    if (!h.pessoa) return;
    ranking[h.pessoa] = (ranking[h.pessoa] || 0) + 1;
  });

  document.getElementById("ranking").innerHTML = Object.entries(ranking)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([nome, total]) => `
        <tr>
          <td>${nome}</td>
          <td>${total}</td>
        </tr>
      `,
    )
    .join("");

  // =============================
  // MANUTENÇÃO
  // =============================
  document.getElementById("filaManutencao").innerHTML = filaManut
    .map((p, i) => `<li>${i + 1}º - ${p.nome}</li>`)
    .join("");

  document.getElementById("historicoManutencao").innerHTML = historicoManut
    .map(
      (item) => `
        <tr>
          <td>${item.pessoa}</td>
          <td>${item.equipamento}</td>
          <td>${new Date(item.data).toLocaleString()}</td>
        </tr>
      `,
    )
    .join("");
}

// =============================
// 🚀 INIT
// =============================
atualizar();
setInterval(atualizar, 3000);
