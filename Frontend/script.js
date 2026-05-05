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
  document.querySelectorAll(".aba").forEach((sec) => {
    sec.classList.remove("ativa");
  });

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

  // cria atendimento
  await fetch(`${API}/atendimento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, cliente }),
  });

  // rotaciona fila
  await fetch(`${API}/fila/treinamento/rotacionar`, {
    method: "POST",
  });

  atualizar();
}

// =============================
// ⏹ FINALIZAR
// =============================
async function finalizarAtendimento() {
  await fetch(`${API}/atendimento`, { method: "DELETE" });
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

  // move para segunda posição
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
// 📥 CARREGAR DADOS
// =============================
async function carregarDados() {
  const fila = await fetch(`${API}/fila/treinamento`).then((r) => r.json());
  const historico = await fetch(`${API}/historico/treinamento`).then((r) =>
    r.json(),
  );
  const atual = await fetch(`${API}/atendimento`).then((r) => r.json());

  const filaManut = await fetch(`${API}/fila/manutencao`).then((r) => r.json());
  const histManut = await fetch(`${API}/historico/manutencao`).then((r) =>
    r.json(),
  );

  return { fila, historico, atual, filaManut, histManut };
}

// =============================
// 🔄 RENDER
// =============================
async function atualizar() {
  const { fila, historico, atual, filaManut, histManut } =
    await carregarDados();

  // ATUAL
  document.getElementById("atendendoAgora").innerText = atual
    ? `${atual.pessoa} → ${atual.cliente}`
    : "-";

  // PRÓXIMO
  document.getElementById("proximoTreinamento").innerText =
    fila[0]?.nome || "-";

  document.getElementById("totalTreinamento").innerText = fila.length;

  // FILA TREINAMENTO
  const f = document.getElementById("filaTreinamento");
  f.innerHTML = "";
  fila.forEach((p, i) => {
    f.innerHTML += `<li>${i + 1}º - ${p.nome}</li>`;
  });

  // HISTÓRICO TREINAMENTO
  const h = document.getElementById("historicoTreinamento");
  h.innerHTML = "";

  historico.forEach((item) => {
    h.innerHTML += `
      <tr>
        <td>${item.pessoa}</td>
        <td>${item.cliente}</td>
        <td>${item.tipo}</td>
        <td>${item.motivo}</td>
        <td>${new Date(item.data).toLocaleString()}</td>
      </tr>
    `;
  });

  // RANKING
  const ranking = {};
  historico.forEach((h) => {
    if (!ranking[h.pessoa]) ranking[h.pessoa] = 0;
    ranking[h.pessoa]++;
  });

  const r = document.getElementById("ranking");
  r.innerHTML = "";

  Object.entries(ranking).forEach(([nome, total]) => {
    r.innerHTML += `
      <tr>
        <td>${nome}</td>
        <td>${total}</td>
      </tr>
    `;
  });

  // FILA MANUTENÇÃO
  const fm = document.getElementById("filaManutencao");
  if (fm) {
    fm.innerHTML = "";
    filaManut.forEach((p, i) => {
      fm.innerHTML += `<li>${i + 1}º - ${p.nome}</li>`;
    });
  }

  // HISTÓRICO MANUTENÇÃO
  const hm = document.getElementById("historicoManutencao");
  if (hm) {
    hm.innerHTML = "";

    histManut.forEach((item) => {
      hm.innerHTML += `
        <tr>
          <td>${item.pessoa}</td>
          <td>${item.equipamento}</td>
          <td>${new Date(item.data).toLocaleString()}</td>
        </tr>
      `;
    });
  }
}

// =============================
// 🚀 INIT
// =============================
atualizar();
setInterval(atualizar, 3000);
