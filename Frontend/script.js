const API = (() => {
  if (window.FILA_API_URL) return window.FILA_API_URL.replace(/\/$/, "");

  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";

  if (local) return "http://localhost:3000";
  if (window.location.protocol === "file:") return "https://fila-treinamento.onrender.com";

  return window.location.origin;
})();

const TIPO_CORES = {
  primeiro: "#16a34a",
  segundo: "#2563eb",
  terceiro: "#ea580c",
  duvidas: "#7c3aed",
};

// =============================
// HELPERS
// =============================
function escapeHTML(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function requestJSON(endpoint, options = {}) {
  const res = await fetch(`${API}${endpoint}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  if (!res.ok) {
    let mensagem = "Erro na comunicação com o servidor.";
    try {
      const erro = await res.json();
      mensagem = erro.erro || erro.error || mensagem;
    } catch (_err) {
      mensagem = (await res.text()) || mensagem;
    }
    throw new Error(mensagem);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
}

function formatarData(dataStr) {
  if (!dataStr) return "-";

  const data = new Date(dataStr);
  if (Number.isNaN(data.getTime())) return "-";

  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatarDuracao(inicio, fim) {
  if (!inicio || !fim) return "-";

  const diff = new Date(fim) - new Date(inicio);
  if (Number.isNaN(diff) || diff < 0) return "-";

  const segundos = Math.floor(diff / 1000);
  const minutos = Math.floor(segundos / 60);
  const horas = Math.floor(minutos / 60);
  const segRest = segundos % 60;
  const minRest = minutos % 60;

  if (horas > 0) return `${horas}h ${minRest}m`;
  if (minutos > 0) return `${minutos}m ${segRest}s`;
  return `${segundos}s`;
}

function corPorTipo(tipo = "") {
  if (tipo.includes("2°") || tipo.includes("2º")) return TIPO_CORES.segundo;
  if (tipo.includes("3°") || tipo.includes("3º")) return TIPO_CORES.terceiro;
  if (tipo.includes("Dúvida") || tipo.includes("Dúvidas")) return TIPO_CORES.duvidas;
  return TIPO_CORES.primeiro;
}

function limparCampo(id) {
  const campo = document.getElementById(id);
  if (campo) campo.value = "";
}

// =============================
// ESTADO GLOBAL
// =============================
let atendimentoSelecionado = null;

// =============================
// ABA
// =============================
function trocarAba(nome) {
  document.querySelectorAll(".aba").forEach((s) => s.classList.remove("ativa"));
  document.getElementById(nome)?.classList.add("ativa");

  document.querySelectorAll(".nav-button[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === nome);
  });

  const titulo = document.getElementById("titulo");
  if (titulo) titulo.innerText = nome === "treinamento" ? "Treinamento" : "Manutenção";
}

// =============================
// TOAST
// =============================
function mostrarToast(mensagem, tipo = "success") {
  const toast = document.createElement("div");
  toast.className = `toast-notification ${tipo}`;

  const content = document.createElement("div");
  content.className = "toast-content";

  const icon = document.createElement("span");
  icon.textContent = tipo === "error" ? "!" : "✓";

  const text = document.createElement("p");
  text.textContent = mensagem;

  content.append(icon, text);
  toast.appendChild(content);
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// =============================
// TREINAMENTO
// =============================
async function chamarTreinamento() {
  try {
    const cliente = document.getElementById("clienteTreinamento").value.trim();
    const tipo = document.getElementById("tipoTreinamento").value;

    if (!cliente) return mostrarToast("Informe o cliente.", "error");
    if (cliente.length > 120) return mostrarToast("Cliente deve ter no máximo 120 caracteres.", "error");

    const fila = await requestJSON("/fila/treinamento");
    if (!fila.length) return mostrarToast("Fila de treinamento vazia.", "error");

    const pessoa = fila[0].nome;

    await requestJSON("/atendimento", {
      method: "POST",
      body: JSON.stringify({ pessoa, cliente, tipo }),
    });

    await requestJSON("/fila/treinamento/rotacionar", { method: "POST" });

    limparCampo("clienteTreinamento");
    mostrarToast("Atendimento iniciado.");
    atualizar();
  } catch (err) {
    console.error(err);
    mostrarToast(err.message, "error");
  }
}

// =============================
// MANUTENÇÃO
// =============================
async function chamarManutencao() {
  try {
    const equipamento = document.getElementById("equipamento").value.trim();

    if (!equipamento) return mostrarToast("Informe o equipamento.", "error");
    if (equipamento.length > 80) return mostrarToast("Equipamento deve ter no máximo 80 caracteres.", "error");

    const fila = await requestJSON("/fila/manutencao");
    if (!fila.length) return mostrarToast("Fila de manutenção vazia.", "error");

    const pessoa = fila[0].nome;

    await requestJSON("/manutencao", {
      method: "POST",
      body: JSON.stringify({ pessoa, equipamento }),
    });

    await requestJSON("/fila/manutencao/rotacionar", { method: "POST" });

    limparCampo("equipamento");
    mostrarToast("Manutenção registrada.");
    atualizar();
  } catch (err) {
    console.error(err);
    mostrarToast(err.message, "error");
  }
}

// =============================
// MODAL FINALIZAR
// =============================
function abrirModal(el) {
  if (el?.preventDefault) {
    el.preventDefault();
    el.stopPropagation();
    el = el.target.closest(".atendimento-card");
  }

  if (!el?.dataset?.at) return;

  const atendimento = JSON.parse(decodeURIComponent(el.dataset.at));
  atendimentoSelecionado = atendimento;

  document.getElementById("modalTexto").innerText = `${atendimento.pessoa} → ${atendimento.cliente}`;
  document.getElementById("modalFinalizar").classList.remove("hidden");
}

function fecharModal() {
  document.getElementById("modalFinalizar").classList.add("hidden");
  atendimentoSelecionado = null;
}

async function confirmarFinalizacao() {
  if (!atendimentoSelecionado) return;

  try {
    const id = atendimentoSelecionado.id;
    fecharModal();

    await requestJSON("/atendimento/finalizar", {
      method: "POST",
      body: JSON.stringify({ id }),
    });

    mostrarToast("Atendimento finalizado.");
    atualizar();
  } catch (err) {
    console.error(err);
    mostrarToast(err.message, "error");
  }
}

// =============================
// MODAL PULAR
// =============================
async function pularTreinamento() {
  try {
    const fila = await requestJSON("/fila/treinamento");
    if (!fila.length) return mostrarToast("Fila de treinamento vazia.", "error");

    document.getElementById("inputMotivoPular").value = "";
    document.getElementById("modalPular").dataset.tipo = "treinamento";
    document.getElementById("modalPular").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    mostrarToast(err.message, "error");
  }
}

async function pularManutencao() {
  try {
    const fila = await requestJSON("/fila/manutencao");
    if (!fila.length) return mostrarToast("Fila de manutenção vazia.", "error");

    document.getElementById("inputMotivoPular").value = "";
    document.getElementById("modalPular").dataset.tipo = "manutencao";
    document.getElementById("modalPular").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    mostrarToast(err.message, "error");
  }
}

async function confirmarPular() {
  const motivo = document.getElementById("inputMotivoPular").value.trim();

  if (!motivo) return mostrarToast("Informe o motivo.", "error");
  if (motivo.length > 150) return mostrarToast("Motivo deve ter no máximo 150 caracteres.", "error");

  const tipo = document.getElementById("modalPular").dataset.tipo;
  const rota = tipo === "manutencao" ? "/fila/manutencao/pular" : "/fila/treinamento/pular";

  try {
    fecharModalPular();

    await requestJSON(rota, {
      method: "POST",
      body: JSON.stringify({ motivo }),
    });

    mostrarToast("Vez pulada com sucesso.");
    atualizar();
  } catch (err) {
    console.error(err);
    mostrarToast(err.message, "error");
  }
}

function fecharModalPular() {
  document.getElementById("modalPular").classList.add("hidden");
}

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    fecharModal();
    fecharModalPular();
  }
});

// =============================
// RENDER
// =============================
function renderLista(lista) {
  return lista.length
    ? lista.map((p, i) => `<li><strong>${i + 1}º</strong><span>${escapeHTML(p.nome)}</span></li>`).join("")
    : `<li class="empty-list">Nenhum item na fila</li>`;
}

function renderAtendimentos(atendimentos) {
  if (!atendimentos.length) return '<p class="sem-atendimento">Nenhum atendimento em andamento.</p>';

  return atendimentos
    .map((a) => {
      const tipo = a.tipo || "Treinamento";
      const cor = corPorTipo(tipo);
      const encoded = encodeURIComponent(JSON.stringify(a));

      return `
        <div class="atendimento-card" style="border-left-color: ${cor}" data-at='${encoded}' onclick="abrirModal(this)">
          <div class="atendimento-header">
            <div class="atendimento-titulo">
              <h3>${escapeHTML(a.pessoa)}</h3>
              <p class="atendimento-cliente">${escapeHTML(a.cliente || "-")}</p>
              <p class="atendimento-tipo-label">${escapeHTML(tipo)}</p>
            </div>
            <button class="atendimento-btn-finalizar" onclick="abrirModal(event)">Finalizar</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderHistoricoTreinamento(historico) {
  if (!historico.length) {
    return `<tr><td colspan="6" class="empty-cell">Nenhum histórico encontrado.</td></tr>`;
  }

  return historico
    .map(
      (h) => `
        <tr>
          <td>${escapeHTML(h.pessoa || "-")}</td>
          <td>${escapeHTML(h.cliente || "-")}</td>
          <td>${escapeHTML(h.tipo || "-")}</td>
          <td>${escapeHTML(h.motivo || "-")}</td>
          <td>${formatarData(h.data_inicio)}</td>
          <td>${formatarDuracao(h.data_inicio, h.data_fim)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderHistoricoManutencao(historico) {
  if (!historico.length) {
    return `<tr><td colspan="3" class="empty-cell">Nenhum histórico encontrado.</td></tr>`;
  }

  return historico
    .map(
      (h) => `
        <tr>
          <td>${escapeHTML(h.pessoa || "-")}</td>
          <td>${escapeHTML(h.equipamento || "-")}</td>
          <td>${formatarData(h.data)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderRanking(ranking) {
  if (!ranking.length) {
    return `<tr><td colspan="2" class="empty-cell">Sem dados para ranking.</td></tr>`;
  }

  return ranking
    .map(
      (r, index) => `
        <tr>
          <td><span class="rank-position">${index + 1}</span>${escapeHTML(r.pessoa)}</td>
          <td>${escapeHTML(r.total)}</td>
        </tr>
      `,
    )
    .join("");
}

async function atualizar() {
  try {
    const data = await requestJSON("/dashboard");

    const {
      fila = [],
      filaManut = [],
      atendimentos = [],
      historico = [],
      historicoManut = [],
      ranking = [],
    } = data;

    const box = document.getElementById("atendendoAgora");
    if (box) box.innerHTML = renderAtendimentos(atendimentos);

    const filaHover = document.getElementById("filaTreinamentoHover");
    if (filaHover) filaHover.innerHTML = renderLista(fila);

    const prox = document.getElementById("proximoTreinamento");
    if (prox) prox.innerText = fila[0]?.nome || "-";

    const total = document.getElementById("totalTreinamento");
    if (total) total.innerText = fila.length;

    const filaMan = document.getElementById("filaManutencao");
    if (filaMan) filaMan.innerHTML = renderLista(filaManut);

    const proxMan = document.getElementById("proximoManutencao");
    if (proxMan) proxMan.innerText = filaManut[0]?.nome || "-";

    const totalMan = document.getElementById("totalManutencao");
    if (totalMan) totalMan.innerText = filaManut.length;

    const hist = document.getElementById("historicoTreinamento");
    if (hist) hist.innerHTML = renderHistoricoTreinamento(historico);

    const histMan = document.getElementById("historicoManutencao");
    if (histMan) histMan.innerHTML = renderHistoricoManutencao(historicoManut);

    const rank = document.getElementById("ranking");
    if (rank) rank.innerHTML = renderRanking(ranking);
  } catch (err) {
    console.error("Erro atualizar:", err);
    mostrarToast(err.message, "error");
  }
}

function initQueueCard() {
  document.querySelectorAll(".queue-card").forEach((queueCard) => {
    queueCard.addEventListener("click", () => {
      queueCard.classList.toggle("expanded");
    });
  });
}

atualizar();
initQueueCard();
setInterval(atualizar, 60000);
