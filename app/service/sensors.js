/**
 * sensors.js
 * Manages GPS location, activity recognition, and battery state.
 * Keeps a live snapshot in memory; relay.js reads from it on demand.
 */

import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK = 'jun-sense-location';
const POLL_INTERVAL_MS = 30_000;

// In-memory snapshot — updated by both foreground poll and background task
let _snapshot = {
  location: null,   // { lat, lng, accuracy, altitude, speed, heading, ts }
  activity: null,   // { type, confidence, ts }
  battery: null,    // { level, charging, ts }
};

let _pollTimer = null;
let _locationSubscription = null;
let _onUpdate = null; // callback so relay.js knows when data changes

// --- Background task definition (must be at module level) ---

TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  if (error) return;
  if (!data?.locations?.length) return;
  const loc = data.locations[data.locations.length - 1];
  _snapshot.location = _parseLocation(loc);
  if (_onUpdate) _onUpdate('location');
});

// --- Public API ---

export function setUpdateCallback(fn) {
  _onUpdate = fn;
}

export function getSnapshot() {
  return { ..._snapshot };
}

export async function start() {
  // Request permissions
  const fgPerm = await Location.requestForegroundPermissionsAsync();
  if (fgPerm.status !== 'granted') {
    throw new Error('Location permission denied');
  }
  const bgPerm = await Location.requestBackgroundPermissionsAsync();

  // Start foreground location subscription for immediate updates
  _locationSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: POLL_INTERVAL_MS,
      distanceInterval: 10, // metres
    },
    (loc) => {
      _snapshot.location = _parseLocation(loc);
      if (_onUpdate) _onUpdate('location');
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
          notificationTitle: 'Eva Locate',
          notificationBody: 'Sharing location with Eva',
          notificationColor: '#1a1a2e',
        },
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      });
    }
  }

  // Poll battery + activity on an interval
  await _pollBattery();
  _pollTimer = setInterval(_pollBattery, POLL_INTERVAL_MS);
}

export async function stop() {
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
    _snapshot.battery = {
      level: Math.round(level * 100),
      charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
      ts: Date.now(),
    };
    if (_onUpdate) _onUpdate('battery');
  } catch (_) {}
}
