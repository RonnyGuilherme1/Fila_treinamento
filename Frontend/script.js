const API =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://fila-treinamento.onrender.com";

// =============================
// ESTADO GLOBAL (MODAL)
// =============================
let atendimentoSelecionado = null;

// =============================
// ABA
// =============================
function trocarAba(nome) {
  document.querySelectorAll(".aba").forEach((s) => s.classList.remove("ativa"));
  document.getElementById(nome).classList.add("ativa");

  document.getElementById("titulo").innerText =
    nome === "treinamento" ? "Treinamento" : "Manutenção";
}

// =============================
// TREINAMENTO INICIAR
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

  await fetch(`${API}/fila/treinamento/rotacionar`, { method: "POST" });

  atualizar();
}

// =============================
// MANUTENÇÃO INICIAR
// =============================
async function chamarManutencao() {
  const equipamento = document.getElementById("equipamento").value;
  if (!equipamento) return alert("Informe o equipamento");

  const fila = await fetch(`${API}/fila/manutencao`).then((r) => r.json());
  if (!fila.length) return alert("Fila vazia");

  const pessoa = fila[0].nome;

  await fetch(`${API}/manutencao`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, equipamento }),
  });

  await fetch(`${API}/fila/manutencao/rotacionar`, { method: "POST" });

  atualizar();
}

// =============================
// MODAL - ABRIR
// =============================
function abrirModal(el) {
  const atendimento = JSON.parse(decodeURIComponent(el.dataset.at));

  atendimentoSelecionado = atendimento;

  document.getElementById("modalTexto").innerText =
    `${atendimento.pessoa} → ${atendimento.cliente}`;

  document.getElementById("modalFinalizar").classList.remove("hidden");
}

// =============================
// MODAL - FECHAR
// =============================
function fecharModal() {
  document.getElementById("modalFinalizar").classList.add("hidden");
  atendimentoSelecionado = null;
}

// =============================
// MODAL - CONFIRMAR FINALIZAÇÃO
// =============================
async function confirmarFinalizacao() {
  if (!atendimentoSelecionado) return;

  await fetch(`${API}/atendimento/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: atendimentoSelecionado.id }),
  });

  fecharModal();
  setTimeout(atualizar, 300);
}

// =============================
// PULAR TREINAMENTO
// =============================
async function pularTreinamento() {
  await fetch(`${API}/fila/treinamento/rotacionar`, { method: "POST" });
  atualizar();
}

// =============================
// ATUALIZAR GERAL
// =============================
async function atualizar() {
  try {
    const data = await fetch(`${API}/dashboard`).then((r) => r.json());

    const {
      fila = [],
      filaManut = [],
      atendimentos = [],
      historico = [],
      historicoManut = [],
      ranking = [],
    } = data;

    // =============================
    // ATENDIMENTO ATUAL
    // =============================
    const box = document.getElementById("atendendoAgora");

    if (box) {
      box.innerHTML = atendimentos.length
        ? atendimentos
            .map(
              (a) => `
  <div class="at-item" data-at='${encodeURIComponent(JSON.stringify(a))}' onclick="abrirModal(this)">
    ${a.pessoa} → ${a.cliente}
  </div>
`,
            )
            .join("")
        : "-";
    }

    // =============================
    // FILA TREINAMENTO
    // =============================
    const filaBox = document.getElementById("filaTreinamento");
    if (filaBox) {
      filaBox.innerHTML = fila
        .map((p, i) => `<li>${i + 1}º - ${p.nome}</li>`)
        .join("");
    }

    const prox = document.getElementById("proximoTreinamento");
    if (prox) prox.innerText = fila[0]?.nome || "-";

    const total = document.getElementById("totalTreinamento");
    if (total) total.innerText = fila.length;

    // =============================
    // FILA MANUTENÇÃO
    // =============================
    const filaMan = document.getElementById("filaManutencao");
    if (filaMan) {
      filaMan.innerHTML = filaManut
        .map((p, i) => `<li>${i + 1}º - ${p.nome}</li>`)
        .join("");
    }

    // =============================
    // HISTÓRICO TREINAMENTO
    // =============================
    const hist = document.getElementById("historicoTreinamento");
    if (hist) {
      hist.innerHTML = historico
        .map(
          (h) => `
          <tr>
            <td>${h.pessoa}</td>
            <td>${h.cliente}</td>
            <td>${h.tipo}</td>
            <td>${h.motivo}</td>
            <td>${h.data_inicio || "-"}</td>
          </tr>
        `,
        )
        .join("");
    }

    // =============================
    // HISTÓRICO MANUTENÇÃO
    // =============================
    const histMan = document.getElementById("historicoManutencao");
    if (histMan) {
      histMan.innerHTML = historicoManut
        .map(
          (h) => `
          <tr>
            <td>${h.pessoa}</td>
            <td>${h.equipamento}</td>
            <td>${h.data || "-"}</td>
          </tr>
        `,
        )
        .join("");
    }

    // =============================
    // RANKING
    // =============================
    const rank = document.getElementById("ranking");
    if (rank) {
      rank.innerHTML = ranking
        .map(
          (r) => `
          <tr>
            <td>${r.pessoa}</td>
            <td>${r.total}</td>
          </tr>
        `,
        )
        .join("");
    }
  } catch (err) {
    console.error("Erro atualizar:", err);
  }
}

// =============================
// INIT
// =============================
atualizar();
setInterval(atualizar, 3000);
