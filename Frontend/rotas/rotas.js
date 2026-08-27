const API = "/api/rotas";
const DEFAULT_CENTER = [-8.2835, -35.9761];

const state = {
  user: null,
  csrfToken: null,
  technicians: [],
  users: [],
  plans: [],
  plan: null,
  companyConfig: null,
  lastPlanQuery: null,
  routeMap: null,
  companyMap: null,
  routeLayers: null,
  companyMarker: null,
  temporaryStopMarker: null,
  pinMode: null,
  capabilities: { buscaAutomatica: false, calculoViario: false },
};

let activeRequests = 0;
let loadingTimer = null;

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
  activeRequests += 1;
  if (activeRequests === 1) {
    loadingTimer = setTimeout(() => show("globalLoading", true), 120);
  }
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (state.csrfToken && !["GET", "HEAD"].includes(options.method || "GET")) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  try {
    let response;
    try {
      response = await fetch(`${API}${path}`, { credentials: "include", ...options, headers });
    } catch (_error) {
      throw new Error("Não foi possível acessar o servidor de rotas. Abra o módulo pelo endereço do backend.");
    }
    if (!response.ok) {
      const message = await readError(response);
      if (response.status === 401 && state.user) return forceLogout(message);
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
      show("globalLoading", false);
    }
  }
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
  if (typeof L === "undefined") {
    throw new Error("A biblioteca do mapa não foi carregada. Atualize a página.");
  }
  const map = L.map(target, { zoomControl: true }).setView(center, 12);
  let tileErrors = 0;
  let usingFallback = false;
  const primaryTiles = L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  primaryTiles.on("tileerror", () => {
    tileErrors += 1;
    if (tileErrors < 4 || usingFallback) return;
    usingFallback = true;
    map.removeLayer(primaryTiles);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    toast("A camada principal do mapa falhou; uma camada alternativa foi carregada.", "error");
  });
  primaryTiles.addTo(map);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(element(target));
    map._conectaResizeObserver = observer;
  }
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
    toast("Ponto da base confirmado.");
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
  await Promise.all([
    loadCapabilities(),
    loadTechnicians(),
    loadCompanyConfig(),
    state.user.perfil === "supervisor" ? loadUsers() : Promise.resolve(),
  ]);
  if (state.user.perfil === "tecnico") await loadPlans();
}

async function loadCapabilities() {
  state.capabilities = await request("/capacidades");
  const geocodingAvailable = state.capabilities.buscaAutomatica === true;
  element("searchCompanyAddress").disabled = !geocodingAvailable;
  element("searchStopAddress").disabled = !geocodingAvailable;
  show("companyGeocodeHelp", !geocodingAvailable);
  show("stopGeocodeHelp", !geocodingAvailable);
}

function switchPanel(name, button) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${name}Panel`));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  const titles = { planejamento: "Planejamento", tecnicos: "Técnicos", usuarios: "Usuários", configuracao: "Base da empresa" };
  element("pageTitle").textContent = titles[name];
  if (name === "planejamento") setTimeout(() => state.routeMap?.invalidateSize(), 50);
  if (name === "configuracao") {
    setTimeout(() => {
      try {
        initializeCompanyMap();
        state.companyMap.invalidateSize({ pan: false });
        centerCompanyMap();
      } catch (error) {
        toast(error.message, "error");
      }
    }, 80);
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
      <td><button class="small-button ${item.ativo ? "danger-button" : ""}" data-action="toggle-technician" data-id="${item.id}" data-active="${!item.ativo}">${item.ativo ? "Inativar" : "Ativar"}</button></td></tr>`).join("")
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
      <td><div class="table-actions"><button class="small-button secondary-button" data-action="reset-user-password" data-id="${item.id}" ${item.id === state.user.id ? "disabled title=\"Use a troca de senha do proprio acesso\"" : ""}>Nova senha</button>
      <button class="small-button ${item.ativo ? "danger-button" : ""}" data-action="toggle-user" data-id="${item.id}" data-active="${!item.ativo}">${item.ativo ? "Inativar" : "Ativar"}</button></div></td></tr>`).join("")
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
  state.companyConfig = config;
  element("companyName").value = config.empresa_nome || "Empresa";
  element("companyAddress").value = config.empresa_endereco || "";
  element("companyLatitude").value = config.empresa_latitude ?? "";
  element("companyLongitude").value = config.empresa_longitude ?? "";
  if (state.companyMap) centerCompanyMap();
}

function setCompanyCoordinates(latitude, longitude) {
  if (!state.companyMap) initializeCompanyMap();
  element("companyLatitude").value = Number(latitude).toFixed(6);
  element("companyLongitude").value = Number(longitude).toFixed(6);
  if (state.companyMarker) state.companyMarker.remove();
  state.companyMarker = L.marker([latitude, longitude]).addTo(state.companyMap).bindPopup("Base da empresa").openPopup();
  state.companyMap.setView([latitude, longitude], 16);
}

function centerCompanyMap() {
  const latitude = Number(element("companyLatitude").value);
  const longitude = Number(element("companyLongitude").value);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0)) {
    setCompanyCoordinates(latitude, longitude);
  } else {
    state.companyMap?.setView(DEFAULT_CENTER, 12);
  }
}

async function saveCompany(event) {
  event.preventDefault();
  try {
    const latitude = Number(element("companyLatitude").value);
    const longitude = Number(element("companyLongitude").value);
    if (latitude === 0 && longitude === 0) {
      toast("Marque o ponto real da base no mapa antes de salvar.", "error");
      return;
    }
    await request("/configuracao", { method: "PATCH", body: JSON.stringify({
      empresaNome: element("companyName").value,
      empresaEndereco: element("companyAddress").value,
      empresaLatitude: latitude,
      empresaLongitude: longitude,
    }) });
    toast("Base da empresa salva. Todas as rotas sairão e retornarão para este ponto.");
  } catch (error) { toast(error.message, "error"); }
}

async function searchAddress(address, resultsId, onSelect) {
  if (!address.trim()) return toast("Informe o endereço.", "error");
  const searchButton = resultsId === "companySearchResults" ? element("searchCompanyAddress") : element("searchStopAddress");
  setBusy(searchButton, true, "Buscando...");
  try {
    const results = await request("/geocodificar", { method: "POST", body: JSON.stringify({
      endereco: address,
      referenciaLatitude: state.companyConfig?.empresa_latitude ?? DEFAULT_CENTER[0],
      referenciaLongitude: state.companyConfig?.empresa_longitude ?? DEFAULT_CENTER[1],
    }) });
    const container = element(resultsId);
    if (!results.length) throw new Error("Nenhum endereço encontrado.");
    container.innerHTML = "";
    results.forEach((result) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const title = document.createElement("strong");
      title.textContent = result.endereco;
      button.appendChild(title);
      if (result.cidade || result.estado || result.cep) {
        const details = document.createElement("span");
        details.textContent = [result.cidade, result.estado, result.cep].filter(Boolean).join(" • ");
        button.appendChild(details);
      }
      button.addEventListener("click", () => { onSelect(result); show(resultsId, false); });
      container.appendChild(button);
    });
    show(resultsId, true);
  } catch (error) { toast(error.message, "error"); } finally { setBusy(searchButton, false); }
}

function planTotalDuration(plan) {
  return Number(plan.duracao_segundos || 0) + Number(plan.duracao_clientes_min || 0) * 60;
}

function renderPlanCards() {
  const container = element("routeCards");
  container.innerHTML = state.plans.map((plan) => {
    const stops = Array.isArray(plan.paradas) ? plan.paradas : [];
    const destinations = stops.slice(0, 4).map((stop) => `
      <li><span>${escapeHTML(stop.cliente)} — ${escapeHTML(stop.endereco)}</span><strong>${Number(stop.duracao_atendimento_min || 0)} min</strong></li>`).join("");
    const remaining = stops.length > 4 ? `<li><span>+ ${stops.length - 4} cliente(s)</span><strong>ver detalhes</strong></li>` : "";
    const deleteButton = state.user.perfil === "supervisor"
      ? `<button type="button" class="danger-button delete-card-button" data-action="delete-plan" data-id="${plan.id}" title="Excluir rota">Excluir</button>` : "";
    return `<article class="route-card">
      <div class="route-card-header"><div><p class="eyebrow">${formatDate(plan.data)}</p><h3>${escapeHTML(plan.titulo || `Rota #${plan.id}`)}</h3><p>${escapeHTML(plan.tecnico_nome)}</p></div><span class="status-pill">${statusLabel(plan.status)}</span></div>
      <div class="route-card-metrics">
        <div><span>Paradas</span><strong>${Number(plan.total_paradas || 0)}</strong></div>
        <div><span>Distância</span><strong>${formatDistance(plan.distancia_metros)}</strong></div>
        <div><span>Tempo total</span><strong>${formatDuration(planTotalDuration(plan))}</strong></div>
      </div>
      <ul class="route-destinations">${destinations || '<li><span>Nenhum cliente adicionado</span><strong>-</strong></li>'}${remaining}</ul>
      <div class="route-card-actions"><button type="button" data-action="open-plan" data-id="${plan.id}">Detalhes e mapa</button>${deleteButton}</div>
    </article>`;
  }).join("");
}

function showPlanDashboard() {
  state.plan = null;
  show("routeWorkspace", false);
  show("emptyRoute", false);
  show("routesDashboard", true);
  const date = state.lastPlanQuery?.allDates ? "todas as datas" : formatDate(state.lastPlanQuery?.date);
  const technician = state.user.perfil === "supervisor"
    ? state.technicians.find((item) => String(item.id) === String(state.lastPlanQuery?.technicianId))?.nome
    : state.user.tecnicoNome || state.user.nome;
  element("routesDashboardTitle").textContent = `${technician || "Técnico"} • ${date}`;
  element("routesDashboardCount").textContent = `${state.plans.length} ${state.plans.length === 1 ? "rota" : "rotas"}`;
  renderPlanCards();
}

async function loadPlans(options = {}) {
  const allDates = options.allDates === true;
  const date = element("routeDate").value;
  if (!allDates && !date) return toast("Selecione uma data.", "error");
  const technicianId = state.user.perfil === "supervisor" ? element("routeTechnician").value : "";
  if (state.user.perfil === "supervisor" && !technicianId) return toast("Selecione um técnico.", "error");
  const query = new URLSearchParams();
  if (!allDates) query.set("data", date);
  if (technicianId) query.set("tecnicoId", technicianId);
  const button = element("loadRoutesButton");
  setBusy(button, true, "Consultando...");
  try {
    state.plans = await request(`/planos?${query}`);
    state.lastPlanQuery = { allDates, date, technicianId };
    if (!state.plans.length) {
      state.plan = null;
      show("routeWorkspace", false);
      show("routesDashboard", false);
      show("emptyRoute", true);
      element("emptyRouteText").textContent = state.user.perfil === "tecnico"
        ? "Nenhuma rota foi criada para você nesta data."
        : "Nenhuma rota encontrada. Use “Criar rota do dia”.";
      return;
    }
    showPlanDashboard();
  } catch (error) { toast(error.message, "error"); } finally { setBusy(button, false); }
}

async function createPlan() {
  const technicianId = Number(element("routeTechnician").value);
  const date = element("routeDate").value;
  if (!technicianId || !date) return toast("Selecione o técnico e a data.", "error");
  const button = element("createRouteButton");
  setBusy(button, true, "Criando...");
  try {
    const plan = await request("/planos", { method: "POST", body: JSON.stringify({
      tecnicoId: technicianId,
      data: date,
      titulo: element("routeName").value,
    }) });
    element("routeName").value = "";
    state.lastPlanQuery = { allDates: false, date, technicianId: String(technicianId) };
    state.plan = {
      ...plan,
      tecnico_nome: state.technicians.find((item) => item.id === technicianId)?.nome || "Técnico",
      paradas: [],
    };
    showPlanDetail();
    toast("Rota do dia criada.");
  } catch (error) { toast(error.message, "error"); } finally { setBusy(button, false); }
}

async function openPlan(id) {
  try {
    state.plan = await request(`/planos/${id}`);
    showPlanDetail();
  } catch (error) {
    toast(error.message, "error");
  }
}

function showPlanDetail() {
  renderPlan();
  show("emptyRoute", false);
  show("routesDashboard", false);
  show("routeWorkspace", true);
  setTimeout(() => state.routeMap.invalidateSize(), 50);
}

async function backToRoutes() {
  if (state.lastPlanQuery) await loadPlans({ allDates: state.lastPlanQuery.allDates });
  else showPlanDashboard();
}

async function deletePlan(id) {
  const plan = state.plans.find((item) => item.id === id) || (state.plan?.id === id ? state.plan : null);
  if (!window.confirm(`Excluir ${plan?.titulo || "esta rota"} e todas as suas paradas?`)) return;
  try {
    await request(`/planos/${id}`, { method: "DELETE" });
    state.plans = state.plans.filter((item) => item.id !== id);
    if (state.plan?.id === id) state.plan = null;
    toast("Rota excluída.");
    if (state.plans.length) showPlanDashboard();
    else await loadPlans({ allDates: state.lastPlanQuery?.allDates === true });
  } catch (error) { toast(error.message, "error"); }
}

function renderPlan() {
  const plan = state.plan;
  element("routeDateLabel").textContent = formatDate(plan.data);
  element("routeTitle").textContent = plan.titulo || `Rota #${plan.id}`;
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

function invalidateLocalPlan() {
  state.plan.status = "rascunho";
  state.plan.distancia_metros = null;
  state.plan.duracao_segundos = null;
  state.plan.geometria = null;
  state.plan.provedor_rota = null;
  state.plan.aviso_calculo = null;
  state.plan.calculada_em = null;
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
      <button class="secondary-button" data-action="move-stop" data-id="${stop.id}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
      <button class="secondary-button" data-action="move-stop" data-id="${stop.id}" data-direction="1" ${index === stops.length - 1 ? "disabled" : ""}>↓</button>
      <button class="secondary-button" data-action="edit-stop" data-id="${stop.id}">Editar</button>
      <button class="danger-button" data-action="remove-stop" data-id="${stop.id}">Excluir</button>` : "";
    const statusActions = state.plan.status === "publicada" && stop.status !== "concluida" ? `
      <button class="secondary-button" data-action="update-stop-status" data-id="${stop.id}" data-status="em_atendimento">Iniciar</button>
      <button data-action="update-stop-status" data-id="${stop.id}" data-status="concluida">Concluir</button>
      <button class="danger-button" data-action="update-stop-status" data-id="${stop.id}" data-status="nao_realizada">Não realizada</button>` : "";
    return `<article class="stop-card ${stop.status === "concluida" ? "done" : ""}">
      <div class="stop-head"><span class="stop-number">${index + 1}</span><div><h3>${escapeHTML(stop.cliente)}</h3><p>${escapeHTML(stop.endereco)}</p></div></div>
      <div class="stop-meta"><span>${time}</span><span>${stop.duracao_atendimento_min} min</span><span>${stopStatusLabel(stop.status)}</span></div>
      <div class="stop-actions"><a href="${googleNavigationUrl(stop)}" target="_blank" rel="noopener">Navegar</a>${supervisorActions}${statusActions}</div>
    </article>`;
  }).join("");
}

function renderRouteMap() {
  if (!state.routeMap || !state.routeLayers) return;
  state.routeLayers.clearLayers();
  const plan = state.plan;
  const points = [];
  const origin = [plan.origem_latitude, plan.origem_longitude];
  if (origin.every(Number.isFinite)) {
    L.marker(origin).bindPopup(`<strong>Base: ${escapeHTML(plan.origem_nome || "Empresa")}</strong><br>${escapeHTML(plan.origem_endereco || "")}<br>Saída e retorno`).addTo(state.routeLayers);
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
    L.polyline([...points, origin], { color: "#94a3b8", weight: 3, dashArray: "7 7" }).addTo(state.routeLayers);
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
  const params = new URLSearchParams({ api: "1", origin, destination: origin, travelmode: "driving" });
  params.set("waypoints", plan.paradas.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"));
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
  const button = event.submitter;
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
  setBusy(button, true, "Salvando...");
  try {
    const savedStop = await request(stopId ? `/planos/${state.plan.id}/paradas/${stopId}` : `/planos/${state.plan.id}/paradas`, {
      method: stopId ? "PATCH" : "POST", body: JSON.stringify(payload),
    });
    if (stopId) {
      state.plan.paradas = state.plan.paradas.map((stop) => stop.id === savedStop.id ? savedStop : stop);
    } else {
      state.plan.paradas.push(savedStop);
    }
    invalidateLocalPlan();
    cancelStopForm();
    renderPlan();
    toast(stopId ? "Parada atualizada." : "Parada adicionada.");
  } catch (error) { toast(error.message, "error"); } finally { setBusy(button, false); }
}

function editStop(id) { openStopForm(state.plan.paradas.find((stop) => stop.id === id)); }

async function removeStop(id) {
  if (!window.confirm("Excluir esta parada da rota?")) return;
  try {
    await request(`/planos/${state.plan.id}/paradas/${id}`, { method: "DELETE" });
    state.plan.paradas = state.plan.paradas
      .filter((stop) => stop.id !== id)
      .map((stop, index) => ({ ...stop, ordem: index + 1 }));
    invalidateLocalPlan();
    renderPlan();
    toast("Parada removida.");
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
  } catch (error) { toast(error.message, "error"); } finally { setBusy(button, false); if (state.plan) renderPlan(); }
}

async function publishPlan() {
  const button = element("publishButton");
  setBusy(button, true, "Publicando...");
  try {
    const updated = await request(`/planos/${state.plan.id}`, { method: "PATCH", body: JSON.stringify({ status: "publicada" }) });
    state.plan = { ...state.plan, ...updated };
    renderPlan();
    toast("Rota publicada para o técnico.");
  } catch (error) { toast(error.message, "error"); } finally { setBusy(button, false); if (state.plan) renderPlan(); }
}

async function updateStopStatus(id, status) {
  try {
    const updatedStop = await request(`/planos/${state.plan.id}/paradas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    state.plan.paradas = state.plan.paradas.map((stop) => stop.id === id ? updatedStop : stop);
    if (state.plan.paradas.every((stop) => ["concluida", "nao_realizada"].includes(stop.status))) {
      state.plan.status = "concluida";
    }
    renderPlan();
    toast("Status atualizado.");
  } catch (error) { toast(error.message, "error"); }
}

function handleDelegatedAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const id = Number(button.dataset.id);
  const actions = {
    "toggle-technician": () => toggleTechnician(id, button.dataset.active === "true"),
    "reset-user-password": () => resetUserPassword(id),
    "toggle-user": () => toggleUser(id, button.dataset.active === "true"),
    "open-plan": () => openPlan(id),
    "delete-plan": () => deletePlan(id),
    "move-stop": () => moveStop(id, Number(button.dataset.direction)),
    "edit-stop": () => editStop(id),
    "remove-stop": () => removeStop(id),
    "update-stop-status": () => updateStopStatus(id, button.dataset.status),
  };
  actions[button.dataset.action]?.();
}

function bindEvents() {
  element("loginForm").addEventListener("submit", handleLogin);
  element("passwordForm").addEventListener("submit", handlePasswordChange);
  element("logoutButton").addEventListener("click", logout);
  element("changePasswordButton").addEventListener("click", openPasswordChange);
  element("cancelPasswordButton").addEventListener("click", cancelPasswordChange);
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel, button)));
  element("loadRoutesButton").addEventListener("click", () => loadPlans());
  element("showAllRoutesButton").addEventListener("click", () => loadPlans({ allDates: true }));
  element("routeTechnician").addEventListener("change", () => {
    if (element("routeTechnician").value) loadPlans({ allDates: true });
    else {
      state.plans = [];
      show("routesDashboard", false);
      show("routeWorkspace", false);
      show("emptyRoute", true);
      element("emptyRouteText").textContent = "Selecione um técnico para visualizar as rotas.";
    }
  });
  element("createRouteButton").addEventListener("click", createPlan);
  element("backToRoutesButton").addEventListener("click", backToRoutes);
  element("deleteRouteButton").addEventListener("click", () => deletePlan(state.plan.id));
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
  element("markCompanyMap").addEventListener("click", () => { state.pinMode = "company"; show("companyPinHelp", true); toast("Clique no mapa no local da base da empresa."); });
  element("searchStopAddress").addEventListener("click", () => searchAddress(element("stopAddress").value, "stopSearchResults", (result) => {
    element("stopAddress").value = result.endereco; element("stopLatitude").value = result.latitude; element("stopLongitude").value = result.longitude;
    state.routeMap.setView([result.latitude, result.longitude], 16);
    if (state.temporaryStopMarker) state.temporaryStopMarker.remove();
    state.temporaryStopMarker = L.marker([result.latitude, result.longitude]).addTo(state.routeMap);
  }));
  element("searchCompanyAddress").addEventListener("click", () => searchAddress(element("companyAddress").value, "companySearchResults", (result) => {
    element("companyAddress").value = result.endereco; setCompanyCoordinates(result.latitude, result.longitude);
  }));
  document.addEventListener("click", handleDelegatedAction);
}

bindEvents();
updateUserRoleForm();
checkSession();
