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
const DEFAULT_SEARCH_REFERENCE = { latitude: -8.2835, longitude: -35.9761 };

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

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contextualizeAddress(address, reference) {
  const normalized = normalizeSearchText(address);
  const hasStateAbbreviation = /(?:^|[\s,-])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)(?:$|[\s,-])/i.test(address);
  const hasLocation = /\b(brasil|pernambuco|caruaru)\b/.test(normalized)
    || hasStateAbbreviation;
  if (hasLocation) return address;
  return `${address}, Pernambuco, Brasil`;
}

function rankGeocodingFeatures(features, address, reference) {
  const normalizedAddress = normalizeSearchText(address);
  const tokens = normalizedAddress.split(" ").filter((token) => token.length >= 3);
  const ranked = (features || []).map((feature) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    const latitude = Number(coordinates[1]);
    const longitude = Number(coordinates[0]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const label = properties.label || address;
    const searchable = normalizeSearchText([
      label,
      properties.name,
      properties.street,
      properties.locality,
      properties.localadmin,
      properties.county,
      properties.region,
      properties.region_a,
      properties.postalcode,
    ].filter(Boolean).join(" "));
    const region = normalizeSearchText(`${properties.region || ""} ${properties.region_a || ""}`);
    const locality = normalizeSearchText(`${properties.locality || ""} ${properties.localadmin || ""} ${properties.county || ""}`);
    const distanceKm = haversineMeters(reference, { latitude, longitude }) / 1000;
    let score = Number(properties.confidence || 0) * 100;
    score += tokens.reduce((total, token) => total + (searchable.includes(token) ? 35 : 0), 0);
    if (region.includes("pernambuco") || /(^| )pe( |$)/.test(region)) score += 450;
    const candidateCities = [properties.locality, properties.localadmin, properties.county]
      .map(normalizeSearchText).filter((value) => value.length >= 3);
    if (candidateCities.some((city) => normalizedAddress.includes(city))) score += 650;
    if (properties.layer === "address") score += 50;
    score -= Math.min(distanceKm * 1.5, 500);
    return {
      endereco: label,
      latitude,
      longitude,
      cidade: properties.locality || properties.localadmin || properties.county || null,
      estado: properties.region_a || properties.region || null,
      cep: properties.postalcode || null,
      score,
    };
  }).filter(Boolean).sort((left, right) => right.score - left.score);

  const seen = new Set();
  return ranked.filter((item) => {
    const key = `${item.endereco}|${item.latitude.toFixed(5)}|${item.longitude.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8).map(({ score: _score, ...item }) => item);
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

async function geocodeAddress(address, reference = {}) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    throw httpError("Busca automatica nao configurada. Marque o ponto diretamente no mapa ou configure ORS_API_KEY.", 409);
  }
  const focus = {
    latitude: Number.isFinite(reference.latitude) ? reference.latitude : DEFAULT_SEARCH_REFERENCE.latitude,
    longitude: Number.isFinite(reference.longitude) ? reference.longitude : DEFAULT_SEARCH_REFERENCE.longitude,
  };
  const url = new URL(ORS_ENDPOINTS.geocode);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("text", contextualizeAddress(address, focus));
  url.searchParams.set("boundary.country", "BR");
  url.searchParams.set("focus.point.lat", String(focus.latitude));
  url.searchParams.set("focus.point.lon", String(focus.longitude));
  url.searchParams.set("lang", "pt");
  url.searchParams.set("size", "15");
  const body = await fetchJson(url.toString(), {}, 15000);
  return rankGeocodingFeatures(body.features, address, focus);
}

module.exports = { optimizeRoute, geocodeAddress, contextualizeAddress, rankGeocodingFeatures };
