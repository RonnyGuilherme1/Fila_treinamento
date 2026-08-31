const API = (() => {
  if (window.FILA_API_URL) return window.FILA_API_URL.replace(/\/$/, "");

  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";

  if (local) return "http://localhost:3000";

  return "https://fila-treinamento.onrender.com";
})();

const PAGE_SIZE = 10;
const historicoState = {
  treinamentos: [],
  puladas: [],
  manutencao: [],
  ranking: [],
  paginas: {
    treinamentos: 1,
    puladas: 1,
    manutencao: 1,
  },
};

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
    const mensagem = await lerMensagemErro(res, "Erro ao carregar histórico.");
    throw new Error(mensagem);
  }

  return res.json();
}

function montarEndpointHistorico(endpoint) {
  const inicio = document.getElementById("dataInicio")?.value || "";
  const fim = document.getElementById("dataFim")?.value || "";
  const params = new URLSearchParams();

  if (inicio && fim) {
    params.set("inicio", inicio);
    params.set("fim", fim);
  }

  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
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

  if (horas > 0) return `${horas}h ${minutos % 60}m`;
  return `${minutos}m ${segundos % 60}s`;
}

function limparFiltro() {
  document.getElementById("dataInicio").value = "";
  document.getElementById("dataFim").value = "";
  carregarHistorico();
}

function setTexto(id, valor) {
  const el = document.getElementById(id);
  if (el) el.innerText = valor;
}

function renderTreinamentos(lista) {
  if (!lista.length) return `<tr><td colspan="5" class="empty-cell">Nenhum treinamento encontrado.</td></tr>`;

  return lista.slice(0, PAGE_SIZE)
    .map(
      (h) => `
        <tr>
          <td>${escapeHTML(h.pessoa || "-")}</td>
          <td>${escapeHTML(h.cliente || "-")}</td>
          <td>${escapeHTML(h.tipo || "-")}</td>
          <td>${formatarData(h.data_inicio)}</td>
          <td>${formatarDuracao(h.data_inicio, h.data_fim)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderPuladas(lista) {
  if (!lista.length) return `<tr><td colspan="3" class="empty-cell">Nenhuma chamada pulada encontrada.</td></tr>`;

  return lista.slice(0, PAGE_SIZE)
    .map(
      (h) => `
        <tr>
          <td>${escapeHTML(h.pessoa || "-")}</td>
          <td>${escapeHTML(h.motivo || "-")}</td>
          <td>${formatarData(h.data_inicio)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderManutencao(lista) {
  if (!lista.length) return `<tr><td colspan="3" class="empty-cell">Nenhuma manutenção encontrada.</td></tr>`;

  return lista.slice(0, PAGE_SIZE)
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

function totalPaginas(tipo) {
  return Math.max(1, Math.ceil((historicoState[tipo] || []).length / PAGE_SIZE));
}

function renderPagina(tipo) {
  const paginaAtual = Math.min(historicoState.paginas[tipo] || 1, totalPaginas(tipo));
  historicoState.paginas[tipo] = paginaAtual;
  const inicio = (paginaAtual - 1) * PAGE_SIZE;
  const pagina = (historicoState[tipo] || []).slice(inicio, inicio + PAGE_SIZE);
  const renderizadores = {
    treinamentos: renderTreinamentos,
    puladas: renderPuladas,
    manutencao: renderManutencao,
  };
  const tbody = document.getElementById(`tb${tipo.charAt(0).toUpperCase()}${tipo.slice(1)}`);
  if (tbody) tbody.innerHTML = renderizadores[tipo](pagina);

  const total = (historicoState[tipo] || []).length;
  const fim = Math.min(inicio + PAGE_SIZE, total);
  const indicador = document.getElementById(`pagina${tipo.charAt(0).toUpperCase()}${tipo.slice(1)}`);
  if (indicador) indicador.textContent = total ? `${inicio + 1}–${fim} de ${total}` : "0–0 de 0";

  const paginacao = document.querySelector(`[data-pagination="${tipo}"]`);
  paginacao?.querySelector('[data-page-action="prev"]')?.toggleAttribute("disabled", paginaAtual <= 1);
  paginacao?.querySelector('[data-page-action="next"]')?.toggleAttribute("disabled", paginaAtual >= totalPaginas(tipo));
}

function mudarPagina(tipo, delta) {
  const proxima = (historicoState.paginas[tipo] || 1) + delta;
  if (proxima < 1 || proxima > totalPaginas(tipo)) return;
  historicoState.paginas[tipo] = proxima;
  renderPagina(tipo);
}

async function carregarHistorico() {
  try {
    const data = await requestJSON(montarEndpointHistorico("/historico/completo"));

    const treinamentos = data.treinamentos || [];
    const puladas = data.puladas || [];
    const manutencao = data.manutencao || [];
    const ranking = data.ranking || [];

    historicoState.treinamentos = treinamentos;
    historicoState.puladas = puladas;
    historicoState.manutencao = manutencao;
    historicoState.ranking = ranking;
    historicoState.paginas.treinamentos = 1;
    historicoState.paginas.puladas = 1;
    historicoState.paginas.manutencao = 1;

    renderPagina("treinamentos");
    renderPagina("puladas");
    renderPagina("manutencao");

    setTexto("totalTreinamentos", treinamentos.length);
    setTexto("totalPuladas", puladas.length);
    setTexto("totalManutencao", manutencao.length);
    setTexto("totalRanking", ranking.length);
  } catch (err) {
    console.error(err);
    document.getElementById("tbTreinamentos").innerHTML = `<tr><td colspan="5" class="empty-cell">${escapeHTML(err.message)}</td></tr>`;
  }
}

function baixarExcel() {
  const endpoint = montarEndpointHistorico("/historico/excel");
  const link = document.createElement("a");

  link.href = `${API}${endpoint}`;
  link.download = "historico-atendimentos.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function escaparCSV(valor) {
  return `"${String(valor ?? "").replaceAll('"', '""')}"`;
}

function baixarCSV(tipo) {
  const configuracoes = {
    treinamentos: {
      id: "tbTreinamentos",
      cabecalhos: ["Técnico", "Cliente", "Tipo", "Data/Hora", "Duração"],
    },
    puladas: {
      id: "tbPuladas",
      cabecalhos: ["Técnico", "Motivo", "Data/Hora"],
    },
    manutencao: {
      id: "tbManutencao",
      cabecalhos: ["Técnico", "Equipamento", "Data/Hora"],
    },
  };
  const config = configuracoes[tipo];

  if (!config) return;

  const linhas = [config.cabecalhos.map(escaparCSV).join(";")];
  const registros = historicoState[tipo] || [];

  registros.forEach((item) => {
    const valores = tipo === "treinamentos"
      ? [item.pessoa, item.cliente, item.tipo, formatarData(item.data_inicio), formatarDuracao(item.data_inicio, item.data_fim)]
      : tipo === "puladas"
        ? [item.pessoa, item.motivo, formatarData(item.data_inicio)]
        : [item.pessoa, item.equipamento, formatarData(item.data)];
    linhas.push(valores.map(escaparCSV).join(";"));
  });

  const blob = new Blob([`\ufeff${linhas.join("\r\n")}`], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = `${tipo}.csv`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

document.querySelectorAll("[data-page-action]").forEach((button) => {
  button.addEventListener("click", () => {
    mudarPagina(button.dataset.pageType, button.dataset.pageAction === "next" ? 1 : -1);
  });
});

carregarHistorico();
