const API =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "https://fila-treinamento.onrender.com";

function formatarData(dataStr) {
  if (!dataStr) return "-";

  const data = new Date(dataStr);

  return data.toLocaleString("pt-BR");
}

function formatarDuracao(inicio, fim) {
  if (!inicio || !fim) return "-";

  const diff = new Date(fim) - new Date(inicio);

  const segundos = Math.floor(diff / 1000);
  const minutos = Math.floor(segundos / 60);

  return `${minutos}m ${segundos % 60}s`;
}

function limparFiltro() {
  document.getElementById("dataInicio").value = "";
  document.getElementById("dataFim").value = "";

  carregarHistorico();
}

async function carregarHistorico() {
  const inicio = document.getElementById("dataInicio")?.value || "";
  const fim = document.getElementById("dataFim")?.value || "";

  let url = `${API}/historico/completo`;

  // Adicionar filtro na URL
  if (inicio && fim) {
    url += `?inicio=${inicio}&fim=${fim}`;
  }

  const data = await fetch(url).then((r) => r.json());

  // =============================
  // TREINAMENTOS
  // =============================
  document.getElementById("tbTreinamentos").innerHTML = data.treinamentos.length
    ? data.treinamentos
        .map(
          (h) => `
            <tr>
              <td>${h.pessoa || "-"}</td>
              <td>${h.cliente || "-"}</td>
              <td>${h.tipo || "-"}</td>
              <td>${formatarData(h.data_inicio)}</td>
              <td>${formatarDuracao(h.data_inicio, h.data_fim)}</td>
            </tr>
          `,
        )
        .join("")
    : `
        <tr>
          <td colspan="5">Nenhum treinamento encontrado.</td>
        </tr>
      `;

  // =============================
  // PULADAS
  // =============================
  document.getElementById("tbPuladas").innerHTML = data.puladas.length
    ? data.puladas
        .map(
          (h) => `
          <tr>
            <td>${h.pessoa || "-"}</td>
            <td>${h.motivo || "-"}</td>
            <td>${formatarData(h.data_inicio)}</td>
          </tr>
        `,
        )
        .join("")
    : `
      <tr>
        <td colspan="3">Nenhuma chamada pulada encontrada.</td>
      </tr>
    `;
}
function baixarCSV(tipo) {
  let tabela;

  if (tipo === "treinamentos") {
    tabela = document.getElementById("tbTreinamentos");
  } else {
    tabela = document.getElementById("tbPuladas");
  }

  let csv = [];

  tabela.querySelectorAll("tr").forEach((row) => {
    const cols = row.querySelectorAll("td");

    const linha = [...cols].map((c) => c.innerText).join(";");

    csv.push(linha);
  });

  const blob = new Blob([csv.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });

  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);

  link.download = `${tipo}.csv`;

  link.click();
}

carregarHistorico();
