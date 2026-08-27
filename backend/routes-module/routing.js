const { httpError } = require("./auth");

const ORS_CUSTOM_BASE_URL = process.env.ORS_BASE_URL
  ? String(process.env.ORS_BASE_URL).replace(/\/$/, "")
  : null;
const ORS_ENDPOINTS = ORS_CUSTOM_BASE_URL
  ? {
    optimization: `${ORS_CUSTOM_BASE_URL}/optimization`,
    directions: `${ORS_CUSTOM_BASE_URL}/v2/directions/driving-car/geojson`,
    geocode: `${ORS_CUSTOM_BASE_URL}/geocode/search`,
  }
  : {
    optimization: "https://api.heigit.org/vroom/v0",
    directions: "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
    geocode: "https://api.heigit.org/pelias/v1/search",
  };

function haversineMeters(a, b) {
  const radius = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const deltaLat = toRad(b.latitude - a.latitude);
  const deltaLng = toRad(b.longitude - a.longitude);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function nearestNeighbor(origin, stops) {
  const remaining = [...stops];
  const ordered = [];
  let current = origin;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((stop, index) => {
      const distance = haversineMeters(current, stop);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push(next);
    current = next;
  }

  return ordered;
}

function fallbackRoute(origin, stops, returnToOrigin, reason) {
  const orderedStops = nearestNeighbor(origin, stops);
  const points = [origin, ...orderedStops];
  if (returnToOrigin) points.push(origin);

  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += haversineMeters(points[index - 1], points[index]);
  }

  return {
    orderedStopIds: orderedStops.map((stop) => stop.id),
    distanceMeters: Math.round(distance),
    durationSeconds: null,
    geometry: {
      type: "LineString",
      coordinates: points.map((point) => [point.longitude, point.latitude]),
    },
    provider: "estimativa-linear",
    warning: `Estimativa por proximidade e linha reta, nao navegacao por ruas.${reason ? ` ${reason}` : " Configure ORS_API_KEY para calculo viario real."}`,
  };
}

async function orsRoute(origin, stops, returnToOrigin, apiKey) {
  const timeSeconds = (value, fallback) => {
    if (!value) return fallback;
    const [hours, minutes, seconds = 0] = String(value).split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  };
  const optimizationPayload = {
    jobs: stops.map((stop) => ({
      id: stop.id,
      location: [stop.longitude, stop.latitude],
      service: Math.max(0, Number(stop.duracao_atendimento_min) || 0) * 60,
      ...((stop.horario_inicio || stop.horario_fim) ? {
        time_windows: [[
          timeSeconds(stop.horario_inicio, 0),
          timeSeconds(stop.horario_fim, 86399),
        ]],
      } : {}),
    })),
    vehicles: [{
      id: 1,
      profile: "driving-car",
      start: [origin.longitude, origin.latitude],
      ...(returnToOrigin ? { end: [origin.longitude, origin.latitude] } : {}),
    }],
  };

  const optimized = await fetchJson(ORS_ENDPOINTS.optimization, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(optimizationPayload),
  }, 30000);

  const steps = optimized.routes?.[0]?.steps || [];
  const orderedIds = steps.filter((step) => step.type === "job").map((step) => Number(step.job));
  if (orderedIds.length !== stops.length) throw new Error("O otimizador nao devolveu todas as paradas.");

  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const orderedStops = orderedIds.map((id) => byId.get(id));
  const coordinates = [
    [origin.longitude, origin.latitude],
    ...orderedStops.map((stop) => [stop.longitude, stop.latitude]),
    ...(returnToOrigin ? [[origin.longitude, origin.latitude]] : []),
  ];

  const directions = await fetchJson(ORS_ENDPOINTS.directions, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates, instructions: false }),
  }, 30000);
  const feature = directions.features?.[0];
  if (!feature?.geometry) throw new Error("O provedor nao devolveu o desenho da rota.");

  return {
    orderedStopIds: orderedIds,
    distanceMeters: Math.round(feature.properties?.summary?.distance || optimized.routes?.[0]?.distance || 0),
    durationSeconds: Math.round(feature.properties?.summary?.duration || optimized.routes?.[0]?.duration || 0),
    geometry: feature.geometry,
    provider: "openrouteservice",
    warning: null,
  };
}

async function optimizeRoute({ origin, stops, returnToOrigin }) {
  if (!origin || !Number.isFinite(origin.latitude) || !Number.isFinite(origin.longitude)) {
    throw httpError("Configure e confirme o ponto da base da empresa antes de otimizar.", 409);
  }
  if (!stops.length) throw httpError("Adicione ao menos uma parada antes de otimizar.", 409);

  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) return fallbackRoute(origin, stops, returnToOrigin);

  try {
    return await orsRoute(origin, stops, returnToOrigin, apiKey);
  } catch (error) {
    console.error("Falha no calculo viario do openrouteservice:", error.message);
    if (String(process.env.ROUTES_REQUIRE_ROAD_ROUTING).toLowerCase() === "true") {
      throw httpError("O servico de calculo viario esta indisponivel. Tente novamente.", 502);
    }
    return fallbackRoute(origin, stops, returnToOrigin, "O servico viario falhou nesta tentativa.");
  }
}

async function geocodeAddress(address) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw httpError("Busca automatica nao configurada. Marque o ponto diretamente no mapa ou configure ORS_API_KEY.", 409);
  }
  const url = new URL(ORS_ENDPOINTS.geocode);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("text", address);
  url.searchParams.set("boundary.country", "BR");
  url.searchParams.set("size", "5");
  const body = await fetchJson(url.toString(), {}, 15000);
  return (body.features || []).map((feature) => ({
    endereco: feature.properties?.label || address,
    latitude: feature.geometry?.coordinates?.[1],
    longitude: feature.geometry?.coordinates?.[0],
  })).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
}

module.exports = { optimizeRoute, geocodeAddress };
