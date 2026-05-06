const API = "https://fila-treinamento.onrender.com";

async function atualizarTV() {
  const data = await fetch(`${API}/dashboard`).then((r) => r.json());

  const { fila, filaManut, atendimentos, ranking } = data;

  // ===== ATENDIMENTOS COM CARDS BONITOS =====
  const tvAtualBox = document.getElementById("tv-atual");
  if (tvAtualBox) {
    if (atendimentos.length) {
      tvAtualBox.innerHTML = atendimentos
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
  <div class="tv-atendimento-card" style="border-left: 6px solid ${cor}">
    <div class="tv-atendimento-header">
      <div class="tv-atendimento-titulo">
        <h3>${a.pessoa}</h3>
        <p class="tv-atendimento-cliente">${a.cliente || "-"} - ${tipo}</p>
      </div>
    </div>
  </div>
`;
        })
        .join("");
    } else {
      tvAtualBox.innerHTML = '<p class="tv-sem-atendimento">-</p>';
    }
  }

  // ===== FILA TREINAMENTO =====
  document.getElementById("tv-fila-treinamento").innerHTML = fila
    .map((p, i) => `<li>${i + 1}º ${p.nome}</li>`)
    .join("");

  // ===== FILA MANUTENÇÃO =====
  document.getElementById("tv-fila-manutencao").innerHTML = filaManut
    .map((p, i) => `<li>${i + 1}º ${p.nome}</li>`)
    .join("");

  // ===== RANKING =====
  document.getElementById("tv-ranking").innerHTML = ranking
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

setInterval(atualizarTV, 30000);
atualizarTV();
