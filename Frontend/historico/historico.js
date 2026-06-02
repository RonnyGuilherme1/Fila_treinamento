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

  return lista
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

  return lista
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

  return lista
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

async function carregarHistorico() {
  try {
    const data = await requestJSON(montarEndpointHistorico("/historico/completo"));

    const treinamentos = data.treinamentos || [];
    const puladas = data.puladas || [];
    const manutencao = data.manutencao || [];
    const ranking = data.ranking || [];

    document.getElementById("tbTreinamentos").innerHTML = renderTreinamentos(treinamentos);
    document.getElementById("tbPuladas").innerHTML = renderPuladas(puladas);
    document.getElementById("tbManutencao").innerHTML = renderManutencao(manutencao);

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

  const tabela = document.getElementById(config.id);
  if (!tabela) return;

  const linhas = [config.cabecalhos.map(escaparCSV).join(";")];

  tabela.querySelectorAll("tr").forEach((row) => {
    const cols = row.querySelectorAll("td");
    if (cols.length !== config.cabecalhos.length || row.querySelector(".empty-cell")) return;

    const linha = [...cols]
      .map((c) => escaparCSV(c.innerText))
      .join(";");

    linhas.push(linha);
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

carregarHistorico();
