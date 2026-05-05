const API =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://fila-treinamento.onrender.com";

function trocarAba(nome) {
  document.querySelectorAll(".aba").forEach((s) => s.classList.remove("ativa"));
  document.getElementById(nome).classList.add("ativa");
}

async function chamarTreinamento() {
  const cliente = document.getElementById("clienteTreinamento").value;
  if (!cliente) return;

  const fila = await fetch(`${API}/fila/treinamento`).then((r) => r.json());
  if (!fila.length) return;

  const pessoa = fila[0].nome;

  await fetch(`${API}/atendimento`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pessoa, cliente }),
  });

  await fetch(`${API}/fila/treinamento/rotacionar`, { method: "POST" });

  atualizar();
}

async function finalizarAtendimento(id) {
  await fetch(`${API}/atendimento/finalizar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  atualizar();
}

async function atualizar() {
  try {
    const data = await fetch(`${API}/dashboard`).then((r) => r.json());

    const {
      fila = [],
      filaManut = [],
      atendimentos = [],
      historico = [],
      historicoManut = [],
    } = data;

    // ATENDIMENTOS
    const box = document.getElementById("atendendoAgora");

    box.innerHTML = atendimentos.length
      ? atendimentos
          .map(
            (a) => `
          <div onclick="finalizarAtendimento(${a.id})">
            ${a.pessoa} → ${a.cliente}
          </div>
        `,
          )
          .join("")
      : "-";

    // FILA
    document.getElementById("filaTreinamento").innerHTML = fila
      .map((p, i) => `<li>${i + 1}º - ${p.nome}</li>`)
      .join("");

    document.getElementById("proximoTreinamento").innerText =
      fila[0]?.nome || "-";

    document.getElementById("totalTreinamento").innerText = fila.length;
  } catch (e) {
    console.error(e);
  }
}

atualizar();
setInterval(atualizar, 3000);
