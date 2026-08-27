const API = "/api/rotas";
const DEFAULT_CENTER = [-3.7319, -38.5267];

const state = {
  user: null,
  csrfToken: null,
  technicians: [],
  users: [],
  plan: null,
  routeMap: null,
  companyMap: null,
  routeLayers: null,
  companyMarker: null,
  temporaryStopMarker: null,
  pinMode: null,
};

function element(id) { return document.getElementById(id); }
function show(id, visible = true) { element(id)?.classList.toggle("hidden", !visible); }
function escapeHTML(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function readError(response) {
  const body = await response.json().catch(() => ({}));
  return body.erro || body.message || "Erro na comunicacao com o servidor.";
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (state.csrfToken && !["GET", "HEAD"].includes(options.method || "GET")) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  const response = await fetch(`${API}${path}`, { credentials: "include", ...options, headers });
  if (!response.ok) {
    const message = await readError(response);
    if (response.status === 401 && state.user) return forceLogout(message);
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

function forceLogout(message) {
  state.user = null;
  state.csrfToken = null;
  show("appView", false);
  show("passwordView", false);
  show("loginView", true);
  element("loginError").textContent = message || "Sessao encerrada.";
  throw new Error(message || "Sessao encerrada.");
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  element("toastRegion").appendChild(item);
  setTimeout(() => item.remove(), 3800);
}

function setBusy(button, busy, text = "Aguarde...") {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.originalText;
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function formatDistance(meters) {
  if (meters === null || meters === undefined) return "-";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function formatDuration(seconds) {
  if (!seconds) return "-";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}min` : `${minutes}min`;
}

function roleLabel(role) { return role === "supervisor" ? "ADM / Supervisor" : "Técnico"; }
function statusLabel(status) {
  return { rascunho: "Rascunho", otimizada: "Otimizada", publicada: "Publicada", concluida: "Concluída" }[status] || status;
}

function initMap(target, center = DEFAULT_CENTER) {
  const map = L.map(target, { zoomControl: true }).setView(center, 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

function initializeMaps() {
  if (!state.routeMap) {
    state.routeMap = initMap("routeMap");
    state.routeLayers = L.layerGroup().addTo(state.routeMap);
    state.routeMap.on("click", (event) => {
      if (state.pinMode !== "stop") return;
      element("stopLatitude").value = event.latlng.lat.toFixed(6);
      element("stopLongitude").value = event.latlng.lng.toFixed(6);
      if (state.temporaryStopMarker) state.temporaryStopMarker.remove();
      state.temporaryStopMarker = L.marker(event.latlng).addTo(state.routeMap);
      state.pinMode = null;
      show("mapHint", false);
      show("pinHelp", false);
      toast("Ponto da parada confirmado.");
    });
  }
}

function initializeCompanyMap() {
  if (state.companyMap) return;
  state.companyMap = initMap("companyMap");
  state.companyMap.on("click", (event) => {
    if (state.pinMode !== "company") return;
    setCompanyCoordinates(event.latlng.lat, event.latlng.lng);
    state.pinMode = null;
    show("companyPinHelp", false);
    toast("Ponto da empresa confirmado.");
  });
}

async function checkSession() {
  try {
    const user = await request("/auth/me");
    startUserSession(user);
  } catch (_error) {
    show("loginView", true);
    try {
      const setup = await request("/setup-status");
      if (!setup.pronto) {
        element("setupWarning").textContent = "O primeiro supervisor ainda não foi criado. Configure ROUTES_BOOTSTRAP_USER e ROUTES_BOOTSTRAP_PASSWORD no servidor e reinicie o serviço.";
        show("setupWarning", true);
      }
    } catch (_ignored) { /* login continua disponivel */ }
  }
}

function startUserSession(user) {
  state.user = user;
  state.csrfToken = user.csrfToken;
  show("loginView", false);
  if (user.trocarSenha) {
    show("cancelPasswordButton", false);
    show("passwordView", true);
    return;
  }
  show("passwordView", false);
  show("appView", true);
  document.querySelectorAll(".supervisor-only").forEach((item) => item.classList.toggle("hidden", user.perfil !== "supervisor"));
  element("userName").textContent = user.nome;
  element("userRole").textContent = roleLabel(user.perfil);
  element("emptyRouteText").textContent = user.perfil === "tecnico"
    ? "Consulte uma data para visualizar a rota publicada para você."
    : "Escolha um técnico e uma data para consultar ou criar o planejamento.";
  initializeMaps();
  loadInitialData().catch((error) => toast(error.message, "error"));
}

async function handleLogin(event) {
  event.preventDefault();
  const button = element("loginButton");
  element("loginError").textContent = "";
  setBusy(button, true, "Entrando...");
  try {
    const user = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ usuario: element("loginUsuario").value, senha: element("loginSenha").value }),
    });
    element("loginForm").reset();
    startUserSession(user);
  } catch (error) {
    element("loginError").textContent = error.message;
  } finally { setBusy(button, false); }
}

async function handlePasswordChange(event) {
  event.preventDefault();
  element("passwordError").textContent = "";
  if (element("novaSenha").value !== element("confirmarSenha").value) {
    element("passwordError").textContent = "As novas senhas não coincidem.";
    return;
  }
  try {
    await request("/auth/trocar-senha", {
      method: "POST",
      body: JSON.stringify({ senhaAtual: element("senhaAtual").value, novaSenha: element("novaSenha").value }),
    });
    state.user.trocarSenha = false;
    element("passwordForm").reset();
    startUserSession(state.user);
    toast("Senha alterada com sucesso.");
  } catch (error) { element("passwordError").textContent = error.message; }
}

function openPasswordChange() {
  element("passwordForm").reset();
  element("passwordError").textContent = "";
  show("appView", false);
  show("cancelPasswordButton", true);
  show("passwordView", true);
}

function cancelPasswordChange() {
  show("passwordView", false);
  show("appView", true);
}

async function logout() {
  try { await request("/auth/logout", { method: "POST" }); } catch (_error) { /* encerra localmente */ }
  window.location.reload();
}

async function loadInitialData() {
  element("routeDate").value = element("routeDate").value || localDateValue();
  await Promise.all([loadTechnicians(), loadCompanyConfig(), state.user.perfil === "supervisor" ? loadUsers() : Promise.resolve()]);
  if (state.user.perfil === "tecnico") await loadPlans();
}

function switchPanel(name, button) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${name}Panel`));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  const titles = { planejamento: "Planejamento", tecnicos: "Técnicos", usuarios: "Usuários", configuracao: "Empresa" };
  element("pageTitle").textContent = titles[name];
  if (name === "planejamento") setTimeout(() => state.routeMap?.invalidateSize(), 50);
  if (name === "configuracao") {
    initializeCompanyMap();
    setTimeout(() => { state.companyMap.invalidateSize(); centerCompanyMap(); }, 50);
  }
}

async function loadTechnicians() {
  state.technicians = await request("/tecnicos");
  const active = state.technicians.filter((item) => item.ativo);
  element("routeTechnician").innerHTML = '<option value="">Selecione</option>'
    + active.map((item) => `<option value="${item.id}">${escapeHTML(item.nome)}</option>`).join("");
  element("newUserTechnician").innerHTML = '<option value="">Selecione</option>'
    + active.map((item) => `<option value="${item.id}">${escapeHTML(item.nome)}</option>`).join("");
  if (state.user.perfil === "supervisor") renderTechnicians();
}

function renderTechnicians() {
  element("techniciansTable").innerHTML = state.technicians.length ? state.technicians.map((item) => `
    <tr><td>${escapeHTML(item.nome)}</td><td>${escapeHTML(item.telefone || "-")}</td>
      <td class="${item.ativo ? "active-text" : "inactive-text"}">${item.ativo ? "Ativo" : "Inativo"}</td>
      <td><button class="small-button ${item.ativo ? "danger-button" : ""}" onclick="toggleTechnician(${item.id}, ${!item.ativo})">${item.ativo ? "Inativar" : "Ativar"}</button></td></tr>`).join("")
    : '<tr><td colspan="4">Nenhum técnico externo cadastrado.</td></tr>';
}

async function createTechnician(event) {
  event.preventDefault();
  try {
    await request("/tecnicos", { method: "POST", body: JSON.stringify({ nome: element("technicianName").value, telefone: element("technicianPhone").value }) });
    element("technicianForm").reset();
    await loadTechnicians();
    toast("Técnico cadastrado.");
  } catch (error) { toast(error.message, "error"); }
}

async function toggleTechnician(id, active) {
  try {
    await request(`/tecnicos/${id}`, { method: "PATCH", body: JSON.stringify({ ativo: active }) });
    await Promise.all([loadTechnicians(), loadUsers()]);
    toast(active ? "Técnico ativado." : "Técnico inativado.");
  } catch (error) { toast(error.message, "error"); }
}

async function loadUsers() {
  state.users = await request("/usuarios");
  renderUsers();
}

function renderUsers() {
  element("usersTable").innerHTML = state.users.length ? state.users.map((item) => `
    <tr><td>${escapeHTML(item.nome)}</td><td>${escapeHTML(item.usuario)}</td><td>${roleLabel(item.perfil)}</td>
      <td>${escapeHTML(item.tecnico_nome || "-")}</td><td class="${item.ativo ? "active-text" : "inactive-text"}">${item.ativo ? "Ativo" : "Inativo"}</td>
      <td><div class="table-actions"><button class="small-button secondary-button" onclick="resetUserPassword(${item.id})" ${item.id === state.user.id ? "disabled title=\"Use a troca de senha do proprio acesso\"" : ""}>Nova senha</button>
      <button class="small-button ${item.ativo ? "danger-button" : ""}" onclick="toggleUser(${item.id}, ${!item.ativo})">${item.ativo ? "Inativar" : "Ativar"}</button></div></td></tr>`).join("")
    : '<tr><td colspan="6">Nenhum usuário cadastrado.</td></tr>';
}

function updateUserRoleForm() {
  const technician = element("newUserRole").value === "tecnico";
  show("userTechnicianLabel", technician);
  element("newUserTechnician").required = technician;
}

async function createUser(event) {
  event.preventDefault();
  try {
    const profile = element("newUserRole").value;
    await request("/usuarios", { method: "POST", body: JSON.stringify({
      nome: element("newUserName").value,
      usuario: element("newUserLogin").value,
      perfil: profile,
      tecnicoId: profile === "tecnico" ? Number(element("newUserTechnician").value) : null,
      senha: element("newUserPassword").value,
    }) });
    element("userForm").reset();
    updateUserRoleForm();
    await loadUsers();
    toast("Usuário criado. A senha deverá ser trocada no primeiro acesso.");
  } catch (error) { toast(error.message, "error"); }
}

async function toggleUser(id, active) {
  try {
    await request(`/usuarios/${id}`, { method: "PATCH", body: JSON.stringify({ ativo: active }) });
    await loadUsers();
    toast(active ? "Usuário ativado." : "Usuário inativado.");
  } catch (error) { toast(error.message, "error"); }
}

async function resetUserPassword(id) {
  const password = window.prompt("Digite a nova senha inicial (mínimo de 10 caracteres):");
  if (password === null) return;
  try {
    await request(`/usuarios/${id}`, { method: "PATCH", body: JSON.stringify({ novaSenha: password }) });
    await loadUsers();
    toast("Senha redefinida. O usuário deverá trocá-la no próximo acesso.");
  } catch (error) { toast(error.message, "error"); }
}

async function loadCompanyConfig() {
  const config = await request("/configuracao");
  element("companyName").value = config.empresa_nome || "Empresa";
  element("companyAddress").value = config.empresa_endereco || "";
  element("companyLatitude").value = config.empresa_latitude ?? "";
  element("companyLongitude").value = config.empresa_longitude ?? "";
  if (state.companyMap) centerCompanyMap();
}

function setCompanyCoordinates(latitude, longitude) {
  element("companyLatitude").value = Number(latitude).toFixed(6);
  element("companyLongitude").value = Number(longitude).toFixed(6);
  if (state.companyMarker) state.companyMarker.remove();
  state.companyMarker = L.marker([latitude, longitude]).addTo(state.companyMap).bindPopup("Empresa").openPopup();
  state.companyMap.setView([latitude, longitude], 16);
}

function centerCompanyMap() {
  const latitude = Number(element("companyLatitude").value);
  const longitude = Number(element("companyLongitude").value);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) setCompanyCoordinates(latitude, longitude);
}

async function saveCompany(event) {
  event.preventDefault();
  try {
    await request("/configuracao", { method: "PATCH", body: JSON.stringify({
      empresaNome: element("companyName").value,
      empresaEndereco: element("companyAddress").value,
      empresaLatitude: Number(element("companyLatitude").value),
      empresaLongitude: Number(element("companyLongitude").value),
    }) });
    toast("Configuração da empresa salva.");
  } catch (error) { toast(error.message, "error"); }
}

async function searchAddress(address, resultsId, onSelect) {
  if (!address.trim()) return toast("Informe o endereço.", "error");
  try {
    const results = await request("/geocodificar", { method: "POST", body: JSON.stringify({ endereco: address }) });
    const container = element(resultsId);
    if (!results.length) throw new Error("Nenhum endereço encontrado.");
    container.innerHTML = "";
    results.forEach((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.textContent = result.endereco;
      button.addEventListener("click", () => { onSelect(result); show(resultsId, false); });
      container.appendChild(button);
    });
    show(resultsId, true);
  } catch (error) { toast(error.message, "error"); }
}

async function loadPlans() {
  const date = element("routeDate").value;
  if (!date) return toast("Selecione uma data.", "error");
  const technicianId = state.user.perfil === "supervisor" ? element("routeTechnician").value : "";
  if (state.user.perfil === "supervisor" && !technicianId) return toast("Selecione um técnico.", "error");
  const query = new URLSearchParams({ data });
  if (technicianId) query.set("tecnicoId", technicianId);
  try {
    const plans = await request(`/planos?${query}`);
    if (!plans.length) {
      state.plan = null;
      show("routeWorkspace", false);
      show("emptyRoute", true);
      element("emptyRouteText").textContent = state.user.perfil === "tecnico"
        ? "Nenhuma rota foi criada para você nesta data."
        : "Nenhuma rota encontrada. Use “Criar rota do dia”.";
      return;
    }
    await openPlan(plans[0].id);
  } catch (error) { toast(error.message, "error"); }
}

async function createPlan() {
  const technicianId = Number(element("routeTechnician").value);
  const date = element("routeDate").value;
  if (!technicianId || !date) return toast("Selecione o técnico e a data.", "error");
  try {
    const plan = await request("/planos", { method: "POST", body: JSON.stringify({ tecnicoId: technicianId, data: date, retornarEmpresa: true }) });
    await openPlan(plan.id);
    toast("Rota do dia criada.");
  } catch (error) { toast(error.message, "error"); }
}

async function openPlan(id) {
  state.plan = await request(`/planos/${id}`);
  renderPlan();
  show("emptyRoute", false);
  show("routeWorkspace", true);
  setTimeout(() => state.routeMap.invalidateSize(), 50);
}

function renderPlan() {
  const plan = state.plan;
  element("routeDateLabel").textContent = formatDate(plan.data);
  element("routeTechnicianName").textContent = plan.tecnico_nome;
  element("routeStatus").textContent = statusLabel(plan.status);
  element("summaryStops").textContent = plan.paradas.length;
  element("summaryDistance").textContent = formatDistance(plan.distancia_metros);
  element("summaryDuration").textContent = formatDuration(plan.duracao_segundos);
  element("publishButton").disabled = !plan.geometria || plan.status === "publicada" || plan.status === "concluida";
  element("optimizeButton").disabled = !plan.paradas.length || plan.status === "concluida";
  if (plan.aviso_calculo) { element("routeWarning").textContent = plan.aviso_calculo; show("routeWarning", true); }
  else show("routeWarning", false);
  renderStops();
  renderRouteMap();
  renderGoogleRouteLink();
}

function stopStatusLabel(status) {
  return { pendente: "Pendente", em_atendimento: "Em atendimento", concluida: "Concluída", nao_realizada: "Não realizada" }[status] || status;
}

function renderStops() {
  const stops = state.plan.paradas;
  if (!stops.length) {
    element("stopsList").innerHTML = '<div class="empty-state"><p>Nenhuma parada adicionada.</p></div>';
    return;
  }
  element("stopsList").innerHTML = stops.map((stop, index) => {
    const time = stop.horario_inicio ? `${String(stop.horario_inicio).slice(0, 5)}${stop.horario_fim ? `–${String(stop.horario_fim).slice(0, 5)}` : ""}` : "Sem horário";
    const supervisorActions = state.user.perfil === "supervisor" ? `
      <button class="secondary-button" onclick="moveStop(${stop.id}, -1)" ${index === 0 ? "disabled" : ""}>↑</button>
      <button class="secondary-button" onclick="moveStop(${stop.id}, 1)" ${index === stops.length - 1 ? "disabled" : ""}>↓</button>
      <button class="secondary-button" onclick="editStop(${stop.id})">Editar</button>
      <button class="danger-button" onclick="removeStop(${stop.id})">Excluir</button>` : "";
    const statusActions = state.plan.status === "publicada" && stop.status !== "concluida" ? `
      <button class="secondary-button" onclick="updateStopStatus(${stop.id}, 'em_atendimento')">Iniciar</button>
      <button onclick="updateStopStatus(${stop.id}, 'concluida')">Concluir</button>
      <button class="danger-button" onclick="updateStopStatus(${stop.id}, 'nao_realizada')">Não realizada</button>` : "";
    return `<article class="stop-card ${stop.status === "concluida" ? "done" : ""}">
      <div class="stop-head"><span class="stop-number">${index + 1}</span><div><h3>${escapeHTML(stop.cliente)}</h3><p>${escapeHTML(stop.endereco)}</p></div></div>
      <div class="stop-meta"><span>${time}</span><span>${stop.duracao_atendimento_min} min</span><span>${stopStatusLabel(stop.status)}</span></div>
      <div class="stop-actions"><a href="${googleNavigationUrl(stop)}" target="_blank" rel="noopener">Navegar</a>${supervisorActions}${statusActions}</div>
    </article>`;
  }).join("");
}

function renderRouteMap() {
  state.routeLayers.clearLayers();
  const plan = state.plan;
  const points = [];
  const origin = [plan.origem_latitude, plan.origem_longitude];
  if (origin.every(Number.isFinite)) {
    L.marker(origin).bindPopup(`<strong>${escapeHTML(plan.origem_nome || "Empresa")}</strong><br>${escapeHTML(plan.origem_endereco || "")}`).addTo(state.routeLayers);
    points.push(origin);
  }
  plan.paradas.forEach((stop, index) => {
    const point = [stop.latitude, stop.longitude];
    const icon = L.divIcon({ className: "numbered-marker", html: String(index + 1), iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker(point, { icon }).bindPopup(`<strong>${index + 1}. ${escapeHTML(stop.cliente)}</strong><br>${escapeHTML(stop.endereco)}`).addTo(state.routeLayers);
    points.push(point);
  });
  if (plan.geometria) {
    L.geoJSON(plan.geometria, { style: { color: plan.provedor_rota === "estimativa-linear" ? "#64748b" : "#2563eb", weight: 5, opacity: 0.82, dashArray: plan.provedor_rota === "estimativa-linear" ? "8 7" : null } }).addTo(state.routeLayers);
  } else if (points.length > 1) {
    L.polyline(points, { color: "#94a3b8", weight: 3, dashArray: "7 7" }).addTo(state.routeLayers);
  }
  if (points.length) state.routeMap.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 15 });
}

function googleNavigationUrl(stop) {
  const params = new URLSearchParams({ api: "1", destination: `${stop.latitude},${stop.longitude}`, travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${params}`;
}

function renderGoogleRouteLink() {
  const plan = state.plan;
  if (!plan.paradas.length) return show("openFullRoute", false);
  const origin = `${plan.origem_latitude},${plan.origem_longitude}`;
  const last = plan.paradas[plan.paradas.length - 1];
  const destination = plan.retornar_empresa ? origin : `${last.latitude},${last.longitude}`;
  const waypointStops = plan.retornar_empresa ? plan.paradas : plan.paradas.slice(0, -1);
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "driving" });
  if (waypointStops.length) params.set("waypoints", waypointStops.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"));
  element("openFullRoute").href = `https://www.google.com/maps/dir/?${params}`;
  show("openFullRoute", true);
}

function openStopForm(stop = null) {
  element("stopForm").reset();
  element("editingStopId").value = stop?.id || "";
  element("stopFormTitle").textContent = stop ? "Editar parada" : "Nova parada";
  element("stopClient").value = stop?.cliente || "";
  element("stopAddress").value = stop?.endereco || "";
  element("stopLatitude").value = stop?.latitude ?? "";
  element("stopLongitude").value = stop?.longitude ?? "";
  element("stopStart").value = stop?.horario_inicio ? String(stop.horario_inicio).slice(0, 5) : "";
  element("stopEnd").value = stop?.horario_fim ? String(stop.horario_fim).slice(0, 5) : "";
  element("stopDuration").value = stop?.duracao_atendimento_min ?? 30;
  element("stopNotes").value = stop?.observacoes || "";
  show("stopForm", true);
  show("stopSearchResults", false);
}

function cancelStopForm() {
  state.pinMode = null;
  if (state.temporaryStopMarker) { state.temporaryStopMarker.remove(); state.temporaryStopMarker = null; }
  show("stopForm", false); show("mapHint", false); show("pinHelp", false);
}

async function saveStop(event) {
  event.preventDefault();
  const stopId = element("editingStopId").value;
  const payload = {
    cliente: element("stopClient").value,
    endereco: element("stopAddress").value,
    latitude: Number(element("stopLatitude").value),
    longitude: Number(element("stopLongitude").value),
    horarioInicio: element("stopStart").value || null,
    horarioFim: element("stopEnd").value || null,
    duracaoAtendimentoMin: Number(element("stopDuration").value),
    observacoes: element("stopNotes").value,
  };
  try {
    await request(stopId ? `/planos/${state.plan.id}/paradas/${stopId}` : `/planos/${state.plan.id}/paradas`, {
      method: stopId ? "PATCH" : "POST", body: JSON.stringify(payload),
    });
    cancelStopForm();
    await openPlan(state.plan.id);
    toast(stopId ? "Parada atualizada." : "Parada adicionada.");
  } catch (error) { toast(error.message, "error"); }
}

function editStop(id) { openStopForm(state.plan.paradas.find((stop) => stop.id === id)); }

async function removeStop(id) {
  if (!window.confirm("Excluir esta parada da rota?")) return;
  try {
    await request(`/planos/${state.plan.id}/paradas/${id}`, { method: "DELETE" });
    await openPlan(state.plan.id); toast("Parada removida.");
  } catch (error) { toast(error.message, "error"); }
}

async function moveStop(id, direction) {
  const ids = state.plan.paradas.map((stop) => stop.id);
  const index = ids.indexOf(id);
  const target = index + direction;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  try {
    state.plan = await request(`/planos/${state.plan.id}/reordenar`, { method: "POST", body: JSON.stringify({ paradaIds: ids }) });
    renderPlan();
  } catch (error) { toast(error.message, "error"); }
}

async function optimizePlan() {
  const button = element("optimizeButton"); setBusy(button, true, "Calculando...");
  try {
    state.plan = await request(`/planos/${state.plan.id}/otimizar`, { method: "POST", body: "{}" });
    renderPlan(); toast(state.plan.provedor_rota === "estimativa-linear" ? "Estimativa gerada. Configure o serviço viário para uma rota pelas ruas." : "Rota otimizada pelas ruas.");
  } catch (error) { toast(error.message, "error"); } finally { setBusy(button, false); }
}

async function publishPlan() {
  try {
    await request(`/planos/${state.plan.id}`, { method: "PATCH", body: JSON.stringify({ status: "publicada" }) });
    await openPlan(state.plan.id); toast("Rota publicada para o técnico.");
  } catch (error) { toast(error.message, "error"); }
}

async function updateStopStatus(id, status) {
  try {
    await request(`/planos/${state.plan.id}/paradas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await openPlan(state.plan.id); toast("Status atualizado.");
  } catch (error) { toast(error.message, "error"); }
}

function bindEvents() {
  element("loginForm").addEventListener("submit", handleLogin);
  element("passwordForm").addEventListener("submit", handlePasswordChange);
  element("logoutButton").addEventListener("click", logout);
  element("changePasswordButton").addEventListener("click", openPasswordChange);
  element("cancelPasswordButton").addEventListener("click", cancelPasswordChange);
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel, button)));
  element("loadRoutesButton").addEventListener("click", loadPlans);
  element("createRouteButton").addEventListener("click", createPlan);
  element("newStopButton").addEventListener("click", () => openStopForm());
  element("cancelStopButton").addEventListener("click", cancelStopForm);
  element("stopForm").addEventListener("submit", saveStop);
  element("optimizeButton").addEventListener("click", optimizePlan);
  element("publishButton").addEventListener("click", publishPlan);
  element("technicianForm").addEventListener("submit", createTechnician);
  element("userForm").addEventListener("submit", createUser);
  element("newUserRole").addEventListener("change", updateUserRoleForm);
  element("companyForm").addEventListener("submit", saveCompany);
  element("markStopMap").addEventListener("click", () => { state.pinMode = "stop"; show("pinHelp", true); show("mapHint", true); toast("Clique no mapa no local exato da parada."); });
  element("markCompanyMap").addEventListener("click", () => { state.pinMode = "company"; show("companyPinHelp", true); toast("Clique no mapa no local da empresa."); });
  element("searchStopAddress").addEventListener("click", () => searchAddress(element("stopAddress").value, "stopSearchResults", (result) => {
    element("stopAddress").value = result.endereco; element("stopLatitude").value = result.latitude; element("stopLongitude").value = result.longitude;
    state.routeMap.setView([result.latitude, result.longitude], 16);
    if (state.temporaryStopMarker) state.temporaryStopMarker.remove();
    state.temporaryStopMarker = L.marker([result.latitude, result.longitude]).addTo(state.routeMap);
  }));
  element("searchCompanyAddress").addEventListener("click", () => searchAddress(element("companyAddress").value, "companySearchResults", (result) => {
    element("companyAddress").value = result.endereco; setCompanyCoordinates(result.latitude, result.longitude);
  }));
}

window.toggleTechnician = toggleTechnician;
window.toggleUser = toggleUser;
window.resetUserPassword = resetUserPassword;
window.moveStop = moveStop;
window.editStop = editStop;
window.removeStop = removeStop;
window.updateStopStatus = updateStopStatus;

bindEvents();
updateUserRoleForm();
checkSession();
