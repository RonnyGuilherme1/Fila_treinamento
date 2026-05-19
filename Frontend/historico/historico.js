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
  const inicio = document.getElementById("dataInicio")?.value || "";
  const fim = document.getElementById("dataFim")?.value || "";

  let url = "/historico/completo";
  if (inicio && fim) url += `?inicio=${inicio}&fim=${fim}`;

  try {
    const data = await requestJSON(url);

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

function baixarCSV(tipo) {
  const ids = {
    treinamentos: "tbTreinamentos",
    puladas: "tbPuladas",
    manutencao: "tbManutencao",
  };

  const tabela = document.getElementById(ids[tipo]);
  if (!tabela) return;

  const linhas = [];

  tabela.querySelectorAll("tr").forEach((row) => {
    const cols = row.querySelectorAll("td");
    if (!cols.length) return;

    const linha = [...cols]
      .map((c) => `"${c.innerText.replaceAll('"', '""')}"`)
      .join(";");

    linhas.push(linha);
  });

  const blob = new Blob([linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.download = `${tipo}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

carregarHistorico();
