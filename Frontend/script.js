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
// FORMATADOR DE DURAÇÃO
// =============================
function formatarDuracao(inicio, fim) {
  if (!inicio || !fim) return "-";
  const diff = new Date(fim) - new Date(inicio);
  const segundos = Math.floor(diff / 1000);
  const minutos = Math.floor(segundos / 60);
  const horas = Math.floor(minutos / 60);
  const segRest = segundos % 60;
  const minRest = minutos % 60;
  if (horas > 0) {
    return `${horas}h ${minRest}m ${segRest}s`;
  } else if (minutos > 0) {
    return `${minutos}m ${segRest}s`;
  } else {
    return `${segundos}s`;
  }
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
// TOAST NOTIFICATION
// =============================
function mostrarToast(mensagem) {
  const toast = document.createElement("div");
  toast.className = "toast-notification";
  toast.innerHTML = `
    <div class="toast-content">
      <span>✓</span>
      <p>${mensagem}</p>
    </div>
  `;
  document.body.appendChild(toast);

  // Animar entrada
  setTimeout(() => toast.classList.add("show"), 10);

  // Remover após 4 segundos
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
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

  // Mostrar mensagem de sucesso
  mostrarToast("Iniciar a atividade na central de funcionário");

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
  // Se for um evento, pegar o elemento mais próximo com data-at
  if (el.preventDefault) {
    el.preventDefault();
    el.stopPropagation();
    el = el.target.closest(".atendimento-card");
  }

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

  const res = await fetch(`${API}/atendimento/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  if (!res.ok) {
    const erro = await res.text();
    console.error("Erro ao finalizar:", erro);
    alert("Erro ao finalizar atendimento");
    return;
  }

  atualizar();
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
      if (atendimentos.length) {
        box.innerHTML = atendimentos
          .map((a) => {
            // Definir cores por tipo de treinamento
            let cor = "#00c853"; // Verde padrão
            let tipo = a.tipo || "Treinamento";

            // Verificar tipo e aplicar cor
            if (tipo.includes("2°") || tipo.includes("2º")) {
              cor = "#1976d2"; // Azul
            } else if (tipo.includes("3°") || tipo.includes("3º")) {
              cor = "#f57c00"; // Laranja
            } else if (tipo.includes("Dúvida") || tipo.includes("Dúvidas")) {
              cor = "#7b1fa2"; // Roxo
            }

            return `
  <div class="atendimento-card" style="border-left: 6px solid ${cor}" data-at='${encodeURIComponent(JSON.stringify(a))}' onclick="abrirModal(this)">
    <div class="atendimento-header">
      <div class="atendimento-titulo">
        <h3>${a.pessoa}</h3>
        <p class="atendimento-cliente">${a.cliente || "-"} - ${tipo}</p>
      </div>
      <button class="atendimento-btn-finalizar" onclick="abrirModal(event)">Finalizar</button>
    </div>
  </div>
`;
          })
          .join("");
      } else {
        box.innerHTML = '<p class="sem-atendimento">-</p>';
      }
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
            <td>${formatarData(h.data)}</td>
            <td>${formatarDuracao(h.data_inicio, h.data_fim)}</td>
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
function toggleFila() {
  const queueCard = document.querySelector(".queue-card");
  if (!queueCard) return;
  queueCard.classList.toggle("expanded");
}

function initQueueCard() {
  const queueCard = document.querySelector(".queue-card");
  if (!queueCard) return;

  queueCard.addEventListener("click", (event) => {
    if (event.target.closest(".queue-toggle")) return;
    queueCard.classList.toggle("expanded");
  });
}

// =============================
// INIT
// =============================
atualizar();
initQueueCard();
setInterval(atualizar, 60000);
