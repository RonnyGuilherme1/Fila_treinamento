const API = (() => {
  if (window.FILA_API_URL) return window.FILA_API_URL.replace(/\/$/, "");

  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";

  if (local) return "http://localhost:3000";

  return "https://fila-treinamento.onrender.com";
})();

function escapeHTML(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function lerMensagemErro(res, fallback) {
  const texto = await res.text().catch(() => "");
  if (!texto) return fallback;

  try {
    const erro = JSON.parse(texto);
    return erro.erro || erro.error || erro.message || fallback;
  } catch (_err) {
    return texto;
  }
}

async function requestJSON(endpoint) {
  const res = await fetch(`${API}${endpoint}`);

  if (!res.ok) {
    const mensagem = await lerMensagemErro(res, "Erro ao carregar painel.");
    throw new Error(mensagem);
  }

  return res.json();
}

function corPorTipo(tipo = "") {
  if (tipo.includes("2°") || tipo.includes("2º")) return "#2563eb";
  if (tipo.includes("3°") || tipo.includes("3º")) return "#ea580c";
  if (tipo.includes("Dúvida") || tipo.includes("Dúvidas")) return "#7c3aed";
  return "#16a34a";
}

function renderFila(lista) {
  return lista.length
    ? lista.map((p, i) => `<li><strong>${i + 1}º</strong><span>${escapeHTML(p.nome)}</span></li>`).join("")
    : `<li class="tv-empty">Sem itens na fila</li>`;
}

async function atualizarTV() {
  try {
    const data = await requestJSON("/dashboard");
    const { fila = [], filaManut = [], atendimentos = [], ranking = [] } = data;

    const tvAtualBox = document.getElementById("tv-atual");
    if (tvAtualBox) {
      tvAtualBox.innerHTML = atendimentos.length
        ? atendimentos
            .map((a) => {
              const tipo = a.tipo || "Treinamento";
              const cor = corPorTipo(tipo);

              return `
                <div class="tv-atendimento-card" style="border-left-color: ${cor}">
                  <div class="tv-atendimento-titulo">
                    <h3>${escapeHTML(a.pessoa)}</h3>
                    <p>${escapeHTML(a.cliente || "-")}</p>
                    <span>${escapeHTML(tipo)}</span>
                  </div>
                </div>
              `;
            })
            .join("")
        : '<p class="tv-sem-atendimento">Nenhum atendimento em andamento</p>';
    }

    document.getElementById("tv-fila-treinamento").innerHTML = renderFila(fila);
    document.getElementById("tv-fila-manutencao").innerHTML = renderFila(filaManut);

    document.getElementById("tv-ranking").innerHTML = ranking.length
      ? ranking
          .map(
            (r, index) => `
              <tr>
                <td><strong>${index + 1}</strong> ${escapeHTML(r.pessoa)}</td>
                <td>${escapeHTML(r.total)}</td>
              </tr>
            `,
          )
          .join("")
      : `<tr><td colspan="2">Sem ranking</td></tr>`;
  } catch (err) {
    console.error(err);
    document.getElementById("tv-atual").innerHTML = '<p class="tv-sem-atendimento">Falha ao carregar painel</p>';
  }
}

setInterval(atualizarTV, 30000);
atualizarTV();
