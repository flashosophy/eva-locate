import { getSnapshot, subscribeUpdates } from './sensors';
import { emitWithAck, getSocket } from './socket';

let _started = false;
let _unsubscribeSensors = null;
let _onSocketConnect = null;
let _flushTimer = null;
let _lastSentAt = 0;
let _pendingPayload = null;
let _inFlight = false;
let _status = {
  pending: false,
  inFlight: false,
  lastQueuedAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: '',
};
const _listeners = new Set();

const MIN_PUSH_INTERVAL_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

function emitStatus() {
  const snapshot = getLocationPushStatus();
  for (const listener of _listeners) {
    try {
      listener(snapshot);
    } catch (_) {}
  }
}

function updateStatus(patch) {
  _status = {
    ..._status,
    ...patch,
  };
  emitStatus();
}

function buildPayload(snapshot) {
  const location = snapshot?.location || null;
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
    return null;
  }

  return {
    lat: location.lat,
    lng: location.lng,
    accuracy: location.accuracy ?? null,
    altitude: location.altitude ?? null,
    speed: location.speed ?? null,
    heading: location.heading ?? null,
    ts: location.ts || Date.now(),
    battery: snapshot?.battery?.level ?? null,
  };
}

function clearRetryTimer() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}

function scheduleRetry(delayMs = RETRY_DELAY_MS) {
  clearRetryTimer();
  if (!_started) return;

  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    void flushPendingLocation({ force: true });
  }, Math.max(250, Number(delayMs) || RETRY_DELAY_MS));
}

async function flushPendingLocation({ force = false } = {}) {
  const socket = getSocket();
  if (!socket || !socket.connected) return;

  if (_inFlight) return;

  const now = Date.now();
  if (!force && now - _lastSentAt < MIN_PUSH_INTERVAL_MS) {
    scheduleRetry(MIN_PUSH_INTERVAL_MS - (now - _lastSentAt));
    return;
  }

  const payload = _pendingPayload || buildPayload(getSnapshot());
  if (!payload) return;

  _pendingPayload = payload;
  _inFlight = true;
  clearRetryTimer();
  updateStatus({
    pending: true,
    inFlight: true,
    lastAttemptAt: Date.now(),
    lastError: '',
  });

  const response = await emitWithAck('location:update', payload);

  _inFlight = false;

  if (!response?.error) {
    if (
      _pendingPayload
      && _pendingPayload.ts === payload.ts
      && _pendingPayload.lat === payload.lat
      && _pendingPayload.lng === payload.lng
    ) {
      _pendingPayload = null;
    }

    _lastSentAt = Date.now();
    updateStatus({
      pending: Boolean(_pendingPayload),
      inFlight: false,
      lastSuccessAt: _lastSentAt,
      lastError: '',
    });

    if (_pendingPayload) {
      scheduleRetry(MIN_PUSH_INTERVAL_MS);
    }
    return;
  }

  updateStatus({
    pending: true,
    inFlight: false,
    lastError: String(response.error || 'Location send failed'),
  });
  scheduleRetry();
}

function queueLatestLocation({ force = false } = {}) {
  const payload = buildPayload(getSnapshot());
  if (!payload) return;

  _pendingPayload = payload;
  updateStatus({
    pending: true,
    lastQueuedAt: Date.now(),
  });
  void flushPendingLocation({ force });
}

export function startLocationPusher() {
  if (_started) return;
  _started = true;

  _unsubscribeSensors = subscribeUpdates((kind) => {
    if (kind === 'location' || kind === 'battery') {
      queueLatestLocation();
    }
  });

  const socket = getSocket();
  if (socket) {
    _onSocketConnect = () => {
      void flushPendingLocation({ force: true });
    };

    socket.on('connect', _onSocketConnect);
    if (socket.connected) {
      queueLatestLocation({ force: true });
    }
  }
}

export function stopLocationPusher() {
  if (!_started) return;
  _started = false;
  _lastSentAt = 0;
  _pendingPayload = null;
  _inFlight = false;
  clearRetryTimer();
  updateStatus({
    pending: false,
    inFlight: false,
    lastError: '',
  });

  if (_unsubscribeSensors) {
    _unsubscribeSensors();
    _unsubscribeSensors = null;
  }

  const socket = getSocket();
  if (socket && _onSocketConnect) {
    socket.off('connect', _onSocketConnect);
  }
  _onSocketConnect = null;
}

export function getLocationPushStatus() {
  return { ..._status };
}

export function subscribeLocationPushStatus(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  _listeners.add(listener);
  try {
    listener(getLocationPushStatus());
  } catch (_) {}

  return () => {
    _listeners.delete(listener);
  };
}
