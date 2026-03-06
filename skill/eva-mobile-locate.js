#!/usr/bin/env node
/**
 * eva-mobile-locate.js
 * OpenClaw skill client for EVA Core location data published by Eva Mobile.
 *
 * Usage:
 *   eva-mobile-locate.js status
 *   eva-mobile-locate.js read <uri>
 *   eva-mobile-locate.js list-resources
 *
 * URIs:
 *   eva-mobile://location
 *   eva-mobile://battery
 *   eva-mobile://nearby-places
 *   eva-mobile://nearby/restaurants
 *   eva-mobile://nearby/stores
 *   eva-mobile://nearby/gas
 */

'use strict';

const fs = require('fs');
const path = require('path');

loadFallbackEnv();

const EVA_CORE_URL = String(process.env.EVA_CORE_URL || 'http://127.0.0.1:3456').trim().replace(/\/+$/, '');
const EVA_CORE_SERVICE_TOKEN = String(
  process.env.EVA_CORE_SERVICE_TOKEN
  || process.env.SERVICE_TOKEN
  || process.env.EVA_CORE_TOKEN
  || ''
).trim();
const EVA_CORE_LOCATION_USER_ID = String(process.env.EVA_CORE_LOCATION_USER_ID || 'user-jun').trim();

const EVA_CORE_NEARBY_RADIUS_METERS = toBoundedInteger(process.env.EVA_CORE_NEARBY_RADIUS_METERS, null, {
  min: 25,
  max: 5000,
});
const EVA_CORE_NEARBY_LIMIT = toBoundedInteger(process.env.EVA_CORE_NEARBY_LIMIT, null, {
  min: 1,
  max: 50,
});

const LOCATION_URI = 'eva-mobile://location';
const BATTERY_URI = 'eva-mobile://battery';
const NEARBY_PLACES_URI = 'eva-mobile://nearby-places';
const NEARBY_ALIAS_URI = 'eva-mobile://nearby';
const NEARBY_RESTAURANTS_URI = 'eva-mobile://nearby/restaurants';
const NEARBY_STORES_URI = 'eva-mobile://nearby/stores';
const NEARBY_GAS_URI = 'eva-mobile://nearby/gas';

function loadFallbackEnv() {
  const candidates = [
    path.resolve(__dirname, '../../eva-core/.env'),
    path.resolve(process.cwd(), '../eva-core/.env'),
  ];

  for (const filePath of candidates) {
    let raw = '';
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }

    applyEnvFile(raw);
    return;
  }
}

function applyEnvFile(raw) {
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = String(match[1] || '').trim();
    if (!key || String(process.env[key] || '').trim()) continue;

    process.env[key] = parseEnvValue(match[2]);
  }
}

function parseEnvValue(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith('\'') && value.endsWith('\''))
  ) {
    const quote = value[0];
    const inner = value.slice(1, -1);
    return quote === '"'
      ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"')
      : inner;
  }

  return value.replace(/\s+#.*$/, '').trim();
}

function toBoundedInteger(value, fallback = null, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function die(code, message) {
  emit({ type: 'error', code, message });
  process.exit(1);
}

function requireServiceToken() {
  if (EVA_CORE_SERVICE_TOKEN) return;
  die('NO_SERVICE_TOKEN', 'Set EVA_CORE_SERVICE_TOKEN (or SERVICE_TOKEN) to query EVA Core location API.');
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch (_err) {
    return null;
  }
}

function normalizeLocationPayload(location) {
  if (!location || typeof location !== 'object') {
    return { available: false, reason: 'No location payload returned' };
  }

  const staleSeconds = Number.isFinite(Number(location.staleSeconds))
    ? Number(location.staleSeconds)
    : null;

  return {
    lat: Number(location.lat),
    lng: Number(location.lng),
    accuracy: location.accuracy == null ? null : Number(location.accuracy),
    altitude: location.altitude == null ? null : Number(location.altitude),
    speed: location.speed == null ? null : Number(location.speed),
    heading: location.heading == null ? null : Number(location.heading),
    ts: Number(location.ts),
    battery: location.battery == null ? null : Number(location.battery),
    staleSeconds,
    available: true,
  };
}

function normalizeBatteryPayload(location) {
  if (!location || typeof location !== 'object') {
    return { available: false, reason: 'No location payload returned' };
  }

  if (location.battery == null || !Number.isFinite(Number(location.battery))) {
    return { available: false, reason: 'Battery value not available yet' };
  }

  const staleSeconds = Number.isFinite(Number(location.staleSeconds))
    ? Number(location.staleSeconds)
    : null;

  return {
    level: Math.round(Number(location.battery)),
    ts: Number(location.updatedAt || Date.now()),
    staleSeconds,
    available: true,
  };
}

function normalizeNearbyPlace(place) {
  if (!place || typeof place !== 'object') return null;

  const id = String(place.id || '').trim();
  const name = String(place.name || '').trim();
  const lat = Number(place.lat);
  const lng = Number(place.lng);
  const distanceMeters = Number.isFinite(Number(place.distanceMeters))
    ? Number(place.distanceMeters)
    : null;

  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    id,
    name,
    kind: String(place.kind || '').trim() || 'other',
    category: String(place.category || '').trim() || null,
    categoryLabel: String(place.categoryLabel || '').trim() || null,
    distanceMeters,
    lat,
    lng,
    address: String(place.address || '').trim() || null,
  };
}

function normalizeNearbyPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { available: false, reason: 'No nearby places payload returned' };
  }

  const places = Array.isArray(payload.places)
    ? payload.places.map(normalizeNearbyPlace).filter(Boolean)
    : [];

  const recognitionSource = payload.recognition && typeof payload.recognition === 'object'
    ? payload.recognition
    : null;

  const recognition = {
    available: recognitionSource?.available === true,
    statement: String(recognitionSource?.statement || '').trim()
      || (places[0] ? `You're near ${places[0].name}.` : null),
    relation: String(recognitionSource?.relation || '').trim() || null,
    confidence: String(recognitionSource?.confidence || '').trim() || null,
    placeId: String(recognitionSource?.placeId || '').trim() || null,
    placeName: String(recognitionSource?.placeName || '').trim() || null,
    distanceMeters: Number.isFinite(Number(recognitionSource?.distanceMeters))
      ? Number(recognitionSource.distanceMeters)
      : null,
  };

  const centerSource = payload.center && typeof payload.center === 'object'
    ? payload.center
    : null;

  const center = centerSource
    ? {
        userId: String(centerSource.userId || '').trim() || null,
        lat: Number.isFinite(Number(centerSource.lat)) ? Number(centerSource.lat) : null,
        lng: Number.isFinite(Number(centerSource.lng)) ? Number(centerSource.lng) : null,
        accuracy: Number.isFinite(Number(centerSource.accuracy)) ? Number(centerSource.accuracy) : null,
        ts: Number.isFinite(Number(centerSource.ts)) ? Number(centerSource.ts) : null,
        staleSeconds: Number.isFinite(Number(centerSource.staleSeconds))
          ? Number(centerSource.staleSeconds)
          : null,
      }
    : null;

  const querySource = payload.query && typeof payload.query === 'object'
    ? payload.query
    : null;

  const query = {
    radiusMeters: Number.isFinite(Number(querySource?.radiusMeters))
      ? Number(querySource.radiusMeters)
      : null,
    limit: Number.isFinite(Number(querySource?.limit)) ? Number(querySource.limit) : null,
    kinds: Array.isArray(querySource?.kinds)
      ? querySource.kinds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [],
  };

  return {
    available: true,
    source: String(payload.source || 'openstreetmap-overpass').trim() || 'openstreetmap-overpass',
    statement: recognition.statement,
    recognition,
    center,
    query,
    places,
    count: places.length,
    cache: payload.cache && typeof payload.cache === 'object' ? payload.cache : null,
    warning: String(payload.warning || '').trim() || null,
    attribution: payload.attribution && typeof payload.attribution === 'object'
      ? {
          text: String(payload.attribution.text || '').trim() || null,
          url: String(payload.attribution.url || '').trim() || null,
        }
      : null,
    fetchedAt: String(payload.fetchedAt || '').trim() || null,
  };
}

async function fetchLocationRecord() {
  requireServiceToken();

  const targetUserId = encodeURIComponent(EVA_CORE_LOCATION_USER_ID);
  const response = await fetch(`${EVA_CORE_URL}/api/location/${targetUserId}`, {
    method: 'GET',
    headers: {
      'x-service-token': EVA_CORE_SERVICE_TOKEN,
      'content-type': 'application/json',
    },
  });

  const payload = await readJsonSafe(response);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        found: false,
        location: null,
      };
    }

    const reason = payload?.error || `HTTP ${response.status}`;
    throw new Error(reason);
  }

  return {
    found: true,
    location: payload?.location || null,
  };
}

function buildNearbyQuerySuffix(kind) {
  const search = new URLSearchParams();

  if (kind) {
    search.set('kinds', kind);
  }

  if (EVA_CORE_NEARBY_RADIUS_METERS != null) {
    search.set('radius', String(EVA_CORE_NEARBY_RADIUS_METERS));
  }

  if (EVA_CORE_NEARBY_LIMIT != null) {
    search.set('limit', String(EVA_CORE_NEARBY_LIMIT));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

async function fetchNearbyPlacesRecord({ kind = '' } = {}) {
  requireServiceToken();

  const targetUserId = encodeURIComponent(EVA_CORE_LOCATION_USER_ID);
  const suffix = buildNearbyQuerySuffix(kind);

  const response = await fetch(`${EVA_CORE_URL}/api/location/${targetUserId}/nearby-places${suffix}`, {
    method: 'GET',
    headers: {
      'x-service-token': EVA_CORE_SERVICE_TOKEN,
      'content-type': 'application/json',
    },
  });

  const payload = await readJsonSafe(response);

  if (!response.ok) {
    if (response.status === 404) {
      return {
        found: false,
        nearby: null,
      };
    }

    const reason = payload?.error || `HTTP ${response.status}`;
    throw new Error(reason);
  }

  return {
    found: true,
    nearby: payload || null,
  };
}

function resolveReadRequest(uri) {
  const normalizedUri = String(uri || '').trim();
  if (!normalizedUri) return null;

  if (normalizedUri === LOCATION_URI) {
    return { type: 'location', uri: LOCATION_URI, nearbyKind: '' };
  }

  if (normalizedUri === BATTERY_URI) {
    return { type: 'battery', uri: BATTERY_URI, nearbyKind: '' };
  }

  if (normalizedUri === NEARBY_PLACES_URI || normalizedUri === NEARBY_ALIAS_URI) {
    return { type: 'nearby', uri: NEARBY_PLACES_URI, nearbyKind: '' };
  }

  if (normalizedUri === NEARBY_RESTAURANTS_URI) {
    return { type: 'nearby', uri: NEARBY_RESTAURANTS_URI, nearbyKind: 'restaurant' };
  }

  if (normalizedUri === NEARBY_STORES_URI) {
    return { type: 'nearby', uri: NEARBY_STORES_URI, nearbyKind: 'store' };
  }

  if (normalizedUri === NEARBY_GAS_URI) {
    return { type: 'nearby', uri: NEARBY_GAS_URI, nearbyKind: 'gas' };
  }

  return null;
}

async function cmdStatus() {
  try {
    const { found, location } = await fetchLocationRecord();
    if (!found) {
      emit({
        type: 'status',
        connected: true,
        available: false,
        reason: 'location_not_found',
        userId: EVA_CORE_LOCATION_USER_ID,
      });
      return;
    }

    const staleSeconds = Number.isFinite(Number(location?.staleSeconds))
      ? Number(location.staleSeconds)
      : null;

    emit({
      type: 'status',
      connected: true,
      available: true,
      userId: EVA_CORE_LOCATION_USER_ID,
      staleSeconds,
      warning: staleSeconds != null && staleSeconds > 300
        ? `Location data is stale (${staleSeconds}s old)`
        : null,
    });
  } catch (err) {
    emit({
      type: 'status',
      connected: false,
      available: false,
      reason: 'request_failed',
      error: err.message,
    });
  }
}

async function cmdRead(uri) {
  const request = resolveReadRequest(uri);
  if (!request) {
    die('UNKNOWN_URI', `Unknown URI: ${String(uri || '').trim()}`);
  }

  try {
    if (request.type === 'nearby') {
      const { found, nearby } = await fetchNearbyPlacesRecord({ kind: request.nearbyKind });
      if (!found) {
        emit({
          type: 'resource',
          uri: request.uri,
          data: {
            available: false,
            reason: 'No location record available yet',
          },
        });
        return;
      }

      emit({
        type: 'resource',
        uri: request.uri,
        data: normalizeNearbyPayload(nearby),
      });
      return;
    }

    const { found, location } = await fetchLocationRecord();
    if (!found) {
      emit({
        type: 'resource',
        uri: request.uri,
        data: {
          available: false,
          reason: 'No location record available yet',
        },
      });
      return;
    }

    const data = request.type === 'location'
      ? normalizeLocationPayload(location)
      : normalizeBatteryPayload(location);

    emit({
      type: 'resource',
      uri: request.uri,
      data,
    });
  } catch (err) {
    die('READ_FAILED', err.message);
  }
}

function cmdListResources() {
  emit({
    type: 'resources',
    resources: [
      {
        uri: LOCATION_URI,
        name: 'Location',
        description: 'Last known GPS location from Eva Mobile',
        mimeType: 'application/json',
      },
      {
        uri: BATTERY_URI,
        name: 'Battery',
        description: 'Last known battery level from Eva Mobile',
        mimeType: 'application/json',
      },
      {
        uri: NEARBY_PLACES_URI,
        name: 'Nearby Places',
        description: 'Nearby OpenStreetMap places plus recognition statement',
        mimeType: 'application/json',
      },
      {
        uri: NEARBY_RESTAURANTS_URI,
        name: 'Nearby Restaurants',
        description: 'Nearby restaurants, cafes, and food places',
        mimeType: 'application/json',
      },
      {
        uri: NEARBY_STORES_URI,
        name: 'Nearby Stores',
        description: 'Nearby stores and shopping places',
        mimeType: 'application/json',
      },
      {
        uri: NEARBY_GAS_URI,
        name: 'Nearby Gas',
        description: 'Nearby gas stations and fuel stops',
        mimeType: 'application/json',
      },
    ],
  });
}

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case 'status':
      await cmdStatus();
      break;
    case 'read':
      if (!rest[0]) {
        die('USAGE', 'read <uri>');
      }
      await cmdRead(rest[0]);
      break;
    case 'list-resources':
      cmdListResources();
      break;
    default:
      die('NO_COMMAND', [
        'Usage: eva-mobile-locate <command>',
        '  status',
        '  read <uri>',
        '    eva-mobile://location',
        '    eva-mobile://battery',
        '    eva-mobile://nearby-places',
        '    eva-mobile://nearby/restaurants',
        '    eva-mobile://nearby/stores',
        '    eva-mobile://nearby/gas',
        '  list-resources',
      ].join('\n'));
  }
}

main().catch((err) => {
  die('UNEXPECTED', err.message);
});
