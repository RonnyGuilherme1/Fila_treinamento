const API = "https://fila-treinamento.onrender.com";

async function atualizarTV() {
  try {
    const data = await fetch(`${API}/dashboard`).then((r) => r.json());

    const { fila, filaManut, atual, historico } = data;

    // =============================
    // ATUAL
    // =============================
    document.getElementById("tv-atual").innerText = atual
      ? `${atual.pessoa} → ${atual.cliente}`
      : "-";

    // =============================
    // FILA TREINAMENTO
    // =============================
    const ft = document.getElementById("tv-fila-treinamento");
    ft.innerHTML = "";

    (fila || []).forEach((p, i) => {
      ft.innerHTML += `<li><span>${i + 1}º</span> <span>${p.nome}</span></li>`;
    });

    // =============================
    // FILA MANUTENÇÃO
    // =============================
    const fm = document.getElementById("tv-fila-manutencao");
    fm.innerHTML = "";

    (filaManut || []).forEach((p, i) => {
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

    r.innerHTML = Object.entries(ranking)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([nome, total], index) => `
      <tr>
        <td>${index === 0 ? "🏆 " : ""}${nome}</td>
        <td>${total}</td>
      </tr>
    `,
      )
      .join("");
  } catch (err) {
    console.error("Erro TV:", err);
  }
}

atualizarTV();
setInterval(atualizarTV, 3000);
