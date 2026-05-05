function atualizarTV() {
  const filaTreinamento =
    JSON.parse(localStorage.getItem("filaTreinamento")) || [];
  const filaManutencao =
    JSON.parse(localStorage.getItem("filaManutencao")) || [];
  const historicoTreinamento =
    JSON.parse(localStorage.getItem("historicoTreinamento")) || [];
  const at = JSON.parse(localStorage.getItem("atendimentoAtual"));

  document.getElementById("tv-atual").innerText = at
    ? `${at.pessoa} → ${at.cliente}`
    : "-";

  const ft = document.getElementById("tv-fila-treinamento");
  ft.innerHTML = "";
  filaTreinamento.forEach((p, i) => {
    ft.innerHTML += `<li><span>${i + 1}º</span><span>${p}</span></li>`;
  });

  const fm = document.getElementById("tv-fila-manutencao");
  fm.innerHTML = "";
  filaManutencao.forEach((p, i) => {
    fm.innerHTML += `<li><span>${i + 1}º</span><span>${p}</span></li>`;
  });

  // RANKING
  const ranking = {};
  historicoTreinamento.forEach((h) => {
    if (!ranking[h.pessoa]) ranking[h.pessoa] = 0;
    ranking[h.pessoa]++;
  });

  const tr = document.getElementById("tv-ranking");
  tr.innerHTML = "";

  Object.entries(ranking).forEach(([nome, total]) => {
    tr.innerHTML += `
      <tr>
        <td>${nome}</td>
        <td>${total}</td>
      </tr>
    `;
  });
}

setInterval(atualizarTV, 1000);
atualizarTV();
