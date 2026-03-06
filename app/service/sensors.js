/**
 * sensors.js
 * Manages GPS location and battery state.
 * Keeps a live snapshot in memory for UI and location push services.
 */

import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK = 'eva-mobile-location';
const POLL_INTERVAL_MS = 30_000;

// In-memory snapshot — updated by both foreground poll and background task
let _snapshot = {
  location: null, // { lat, lng, accuracy, altitude, speed, heading, ts }
  battery: null, // { level, charging, ts }
  meta: {
    started: false,
    foregroundPermission: 'unknown',
    backgroundPermission: 'unknown',
    backgroundUpdatesActive: false,
    lastLocationAt: null,
    lastBatteryAt: null,
    lastError: '',
  },
};

let _pollTimer = null;
let _locationSubscription = null;
let _started = false;
let _legacyUpdateCallback = null;
const _listeners = new Set();

function _emitUpdate(kind) {
  const snapshot = getSnapshot();

  if (typeof _legacyUpdateCallback === 'function') {
    try {
      _legacyUpdateCallback(kind, snapshot);
    } catch (_) {}
  }

  for (const listener of _listeners) {
    try {
      listener(kind, snapshot);
    } catch (_) {}
  }
}

function _updateMeta(patch) {
  _snapshot.meta = {
    ..._snapshot.meta,
    ...patch,
  };
}

// --- Background task definition (must be at module level) ---

TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  if (error) {
    _updateMeta({
      lastError: String(error.message || error || 'Background location task failed'),
    });
    _emitUpdate('status');
    return;
  }
  if (!data?.locations?.length) return;
  const loc = data.locations[data.locations.length - 1];
  _snapshot.location = _parseLocation(loc);
  _updateMeta({
    lastLocationAt: loc.timestamp || Date.now(),
    lastError: '',
  });
  _emitUpdate('location');
});

// --- Public API ---

export function setUpdateCallback(fn) {
  _legacyUpdateCallback = typeof fn === 'function' ? fn : null;
}

export function subscribeUpdates(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

export function getSnapshot() {
  return {
    ..._snapshot,
    meta: {
      ..._snapshot.meta,
    },
  };
}

export function isStarted() {
  return _started;
}

export async function start() {
  if (_started) return;

  _updateMeta({
    lastError: '',
  });
  _emitUpdate('status');

  // Request permissions
  const fgPerm = await Location.requestForegroundPermissionsAsync();
  _updateMeta({
    foregroundPermission: String(fgPerm?.status || 'unknown'),
  });
  _emitUpdate('status');
  if (fgPerm.status !== 'granted') {
    _updateMeta({
      lastError: 'Location permission denied',
    });
    _emitUpdate('status');
    throw new Error('Location permission denied');
  }
  const bgPerm = await Location.requestBackgroundPermissionsAsync();
  _updateMeta({
    backgroundPermission: String(bgPerm?.status || 'unknown'),
  });
  _emitUpdate('status');

  // Start foreground location subscription for immediate updates
  _locationSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: POLL_INTERVAL_MS,
      distanceInterval: 10, // metres
    },
    (loc) => {
      _snapshot.location = _parseLocation(loc);
      _updateMeta({
        lastLocationAt: loc.timestamp || Date.now(),
        lastError: '',
      });
      _emitUpdate('location');
    }
  );

  // Start background location task if permission granted
  if (bgPerm.status === 'granted') {
    const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
    if (!already) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: POLL_INTERVAL_MS,
        distanceInterval: 10,
        foregroundService: {
          notificationTitle: 'Eva Mobile - location active',
          notificationBody: 'Background location is running',
          notificationColor: '#1a1a2e',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      });
    }
    _updateMeta({
      backgroundUpdatesActive: true,
    });
    _emitUpdate('status');
  }

  // Poll battery on an interval
  await _pollBattery();
  _pollTimer = setInterval(_pollBattery, POLL_INTERVAL_MS);
  _started = true;
  _updateMeta({
    started: true,
  });
  _emitUpdate('status');
}

export async function stop() {
  if (!_started) return;

  if (_locationSubscription) {
    _locationSubscription.remove();
    _locationSubscription = null;
  }
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  if (running) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }

  _started = false;
  _updateMeta({
    started: false,
    backgroundUpdatesActive: false,
  });
  _emitUpdate('status');
}

// --- Internal ---

function _parseLocation(loc) {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    altitude: loc.coords.altitude,
    speed: loc.coords.speed,
    heading: loc.coords.heading,
    ts: loc.timestamp,
  };
}

async function _pollBattery() {
  try {
    const [level, state] = await Promise.all([
      Battery.getBatteryLevelAsync(),
      Battery.getBatteryStateAsync(),
    ]);
    const now = Date.now();
    _snapshot.battery = {
      level: Math.round(level * 100),
      charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
      ts: now,
    };
    _updateMeta({
      lastBatteryAt: now,
    });
    _emitUpdate('battery');
  } catch (_) {}
}
