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
 */

'use strict';

const EVA_CORE_URL = String(process.env.EVA_CORE_URL || 'http://127.0.0.1:3456').trim().replace(/\/+$/, '');
const EVA_CORE_SERVICE_TOKEN = String(
  process.env.EVA_CORE_SERVICE_TOKEN
  || process.env.SERVICE_TOKEN
  || process.env.EVA_CORE_TOKEN
  || ''
).trim();
const EVA_CORE_LOCATION_USER_ID = String(process.env.EVA_CORE_LOCATION_USER_ID || 'user-jun').trim();

const LOCATION_URI = 'eva-mobile://location';
const BATTERY_URI = 'eva-mobile://battery';

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

  let payload = null;
  try {
    payload = await response.json();
  } catch (_err) {
    payload = null;
  }

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
  const normalizedUri = String(uri || '').trim();
  if (!normalizedUri) {
    die('USAGE', 'read <uri>');
  }

  let requestedType = null;
  if (normalizedUri === LOCATION_URI) requestedType = 'location';
  if (normalizedUri === BATTERY_URI) requestedType = 'battery';
  if (!requestedType) {
    die('UNKNOWN_URI', `Unknown URI: ${normalizedUri}`);
  }

  try {
    const { found, location } = await fetchLocationRecord();
    if (!found) {
      emit({
        type: 'resource',
        uri: requestedType === 'location' ? LOCATION_URI : BATTERY_URI,
        data: {
          available: false,
          reason: 'No location record available yet',
        },
      });
      return;
    }

    const data = requestedType === 'location'
      ? normalizeLocationPayload(location)
      : normalizeBatteryPayload(location);

    emit({
      type: 'resource',
      uri: requestedType === 'location' ? LOCATION_URI : BATTERY_URI,
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
        '  list-resources',
      ].join('\n'));
  }
}

main().catch((err) => {
  die('UNEXPECTED', err.message);
});
