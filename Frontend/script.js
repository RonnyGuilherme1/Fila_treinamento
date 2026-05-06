const API =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://fila-treinamento.onrender.com";

// =============================
// FORMATADOR DE DATA
// =============================
function formatarData(dataStr) {
  if (!dataStr) return "-";
  const data = new Date(dataStr);
  const dia = String(data.getDate()).padStart(2, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const ano = data.getFullYear();
  const hora = String(data.getHours()).padStart(2, "0");
  const minuto = String(data.getMinutes()).padStart(2, "0");
  const segundo = String(data.getSeconds()).padStart(2, "0");
  return `${dia}/${mes}/${ano} ${hora}:${minuto}:${segundo}`;
}

// =============================
// ESTADO GLOBAL (MODAL)
// =============================
let atendimentoSelecionado = null;
let pessoaSendoPulada = null;

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
  const cliente = document.getElementById("clienteTreinamento").value.trim();
  const tipo = document.getElementById("tipoTreinamento").value;
  if (!cliente) return alert("Informe o cliente");

  const fila = await fetch(`${API}/fila/treinamento`).then((r) => r.json());
  if (!fila.length) return alert("Fila vazia");

  const pessoa = fila[0].nome;

  await fetch(`${API}/atendimento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, cliente, tipo }),
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

// Permitir fechar modal ao pressionar ESC
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    fecharModal();
    fecharModalPular();
  }
});

// =============================
// MODAL - CONFIRMAR FINALIZAÇÃO
// =============================
async function confirmarFinalizacao() {
  if (!atendimentoSelecionado) return;

  const id = atendimentoSelecionado.id;

  fecharModal();

  await fetch(`${API}/atendimento/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  atualizar(); // Atualizar imediatamente
}

// =============================
// PULAR TREINAMENTO - ABRIR MODAL
// =============================
async function pularTreinamento() {
  const fila = await fetch(`${API}/fila/treinamento`).then((r) => r.json());
  if (!fila.length) return alert("Fila vazia");

  pessoaSendoPulada = fila[0].nome;
  document.getElementById("inputMotivoPular").value = "";
  document.getElementById("modalPular").classList.remove("hidden");
}

// =============================
// MODAL PULAR - CONFIRMAR
// =============================
async function confirmarPular() {
  const motivo = document.getElementById("inputMotivoPular").value.trim();

  if (!motivo) return alert("Informe o motivo");

  fecharModalPular();

  await fetch(`${API}/fila/treinamento/pular`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ motivo }),
  });

  atualizar();
}

// =============================
// MODAL PULAR - FECHAR
// =============================
function fecharModalPular() {
  document.getElementById("modalPular").classList.add("hidden");
  pessoaSendoPulada = null;
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
    const filaHover = document.getElementById("filaTreinamentoHover");
    const filaHtml = fila
      .map((p, i) => `<li>${i + 1}º - ${p.nome}</li>`)
      .join("");

    if (filaBox) filaBox.innerHTML = filaHtml;
    if (filaHover) filaHover.innerHTML = filaHtml;

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
            <td>${formatarData(h.data_inicio)}</td>
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
            <td>${formatarData(h.data)}</td>
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
// QUEUE CARD TOGGLE
// =============================
function initQueueCard() {
  const queueCard = document.querySelector(".queue-card");
  if (!queueCard) return;

  queueCard.addEventListener("click", () => {
    queueCard.classList.toggle("expanded");
  });
}

// =============================
// INIT
// =============================
atualizar();
initQueueCard();
setInterval(atualizar, 60000);
