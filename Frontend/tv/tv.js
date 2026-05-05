// =============================
// 🌐 CONFIG API
// =============================
const API = "https://fila-treinamento.onrender.com";

// =============================
// 📺 ATUALIZAR TV
// =============================
async function atualizarTV() {
  try {
    const filaTreinamento = await fetch(`${API}/fila/treinamento`).then((r) =>
      r.json(),
    );

    const filaManutencao = await fetch(`${API}/fila/manutencao`).then((r) =>
      r.json(),
    );

    const at = await fetch(`${API}/atendimento`).then((r) => r.json());

    const historico = await fetch(`${API}/historico/treinamento`).then((r) =>
      r.json(),
    );

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
  } catch (err) {
    console.error("Erro TV:", err);
  }
  const ranking = {};
  historico.forEach((h) => {
    if (!ranking[h.pessoa]) ranking[h.pessoa] = 0;
    ranking[h.pessoa]++;
  });

  const r = document.getElementById("tv-ranking");
  r.innerHTML = "";

  Object.entries(ranking).forEach(([nome, total]) => {
    r.innerHTML += `
    <tr>
      <td>${nome}</td>
      <td>${total}</td>
    </tr>
  `;
  });
}

// =============================
// 🚀 INIT
// =============================
atualizarTV();
setInterval(atualizarTV, 3000);
