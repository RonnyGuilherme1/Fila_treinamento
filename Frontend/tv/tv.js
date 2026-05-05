const API = "https://fila-treinamento.onrender.com";

async function atualizarTV() {
  try {
    const [filaTreinamento, filaManutencao, at, historico] = await Promise.all([
      fetch(`${API}/fila/treinamento`).then((r) => r.json()),
      fetch(`${API}/fila/manutencao`).then((r) => r.json()),
      fetch(`${API}/atendimento`).then((r) => r.json()),
      fetch(`${API}/historico/treinamento`).then((r) => r.json()),
    ]);

    // =============================
    // ATUAL
    // =============================
    document.getElementById("tv-atual").innerText = at
      ? `${at.pessoa} → ${at.cliente}`
      : "-";

    // =============================
    // FILA TREINAMENTO
    // =============================
    const ft = document.getElementById("tv-fila-treinamento");
    ft.innerHTML = "";

    filaTreinamento.forEach((p, i) => {
      ft.innerHTML += `<li><span>${i + 1}º</span> <span>${p.nome}</span></li>`;
    });

    // =============================
    // FILA MANUTENÇÃO
    // =============================
    const fm = document.getElementById("tv-fila-manutencao");
    fm.innerHTML = "";

    filaManutencao.forEach((p, i) => {
      fm.innerHTML += `<li><span>${i + 1}º</span> <span>${p.nome}</span></li>`;
    });

    // =============================
    // RANKING
    // =============================
    const ranking = {};

    (historico || []).forEach((h) => {
      if (!h.pessoa) return;
      ranking[h.pessoa] = (ranking[h.pessoa] || 0) + 1;
    });

    const r = document.getElementById("tv-ranking");
    r.innerHTML = "";

    Object.entries(ranking)
      .sort((a, b) => b[1] - a[1]) // maior primeiro
      .forEach(([nome, total]) => {
        r.innerHTML += `
          <tr>
            <td>${nome}</td>
            <td>${total}</td>
          </tr>
        `;
      });
  } catch (err) {
    console.error("Erro TV:", err);
  }
}

// INIT
atualizarTV();
setInterval(atualizarTV, 3000);
