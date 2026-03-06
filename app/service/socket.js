import { io } from 'socket.io-client';

import { EVA_CORE_URL, SOCKET_PATH } from '../config';

let _socket = null;
let _token = null;
let _status = {
  state: 'idle',
  lastError: '',
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  lastDisconnectReason: '',
};
const _listeners = new Set();

function emitStatus() {
  const snapshot = getSocketStatus();
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

export function connectSocket(token) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) {
    throw new Error('Token is required');
  }

  if (_socket && _token === normalizedToken) {
    return _socket;
  }

  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }

  _token = normalizedToken;
  updateStatus({
    state: 'connecting',
    lastError: '',
  });

  _socket = io(EVA_CORE_URL, {
    path: SOCKET_PATH,
    auth: {
      token: normalizedToken,
      mode: 'eva-core',
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
  });

  _socket.on('connect', () => {
    updateStatus({
      state: 'connected',
      lastError: '',
      lastConnectedAt: Date.now(),
      lastDisconnectReason: '',
    });
  });

  _socket.on('disconnect', (reason) => {
    updateStatus({
      state: 'disconnected',
      lastDisconnectedAt: Date.now(),
      lastDisconnectReason: String(reason || '').trim(),
    });
  });

  _socket.on('connect_error', (error) => {
    updateStatus({
      state: 'disconnected',
      lastError: String(error?.message || 'Connection failed'),
      lastDisconnectedAt: Date.now(),
    });
  });

  return _socket;
}

export function getSocket() {
  return _socket;
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
  _token = null;
  updateStatus({
    state: 'idle',
    lastError: '',
    lastDisconnectReason: '',
  });
}

export function getSocketStatus() {
  return { ..._status };
}

export function subscribeSocketStatus(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  _listeners.add(listener);
  try {
    listener(getSocketStatus());
  } catch (_) {}

  return () => {
    _listeners.delete(listener);
  };
}

export function emitWithAck(eventName, payload, timeoutMs = 10000) {
  const socket = getSocket();
  if (!socket || !socket.connected) {
    return Promise.resolve({ error: 'not_connected' });
  }

  return new Promise((resolve) => {
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ error: 'timeout' });
    }, timeoutMs);

    socket.emit(eventName, payload, (response) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(response || { success: true });
    });
  });
}
