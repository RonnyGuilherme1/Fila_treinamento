const API = "https://fila-treinamento.onrender.com";

async function atualizarTV() {
  const data = await fetch(`${API}/dashboard`).then((r) => r.json());

  const { fila, filaManut, atendimentos, historico } = data;

  document.getElementById("tv-atual").innerText = atendimentos[0]
    ? `${atendimentos[0].pessoa} → ${atendimentos[0].cliente}`
    : "-";

  document.getElementById("tv-fila-treinamento").innerHTML = fila
    .map((p, i) => `<li>${i + 1}º ${p.nome}</li>`)
    .join("");

  document.getElementById("tv-fila-manutencao").innerHTML = filaManut
    .map((p, i) => `<li>${i + 1}º ${p.nome}</li>`)
    .join("");
}

setInterval(atualizarTV, 3000);
atualizarTV();
