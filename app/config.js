const DEFAULT_EVA_CORE_URL = 'https://eva.tail5afb5a.ts.net';
const DEFAULT_EVA_WEB_PATH = '/eva-orchestrator/chat';
const DEFAULT_EVA_WEB_URL = `${DEFAULT_EVA_CORE_URL}${DEFAULT_EVA_WEB_PATH}`;
const DEFAULT_SOCKET_PATH = '/socket.io';
const APP_VERSION = '1.0.9';

const INVALID_ENV_VALUES = new Set(['undefined', 'null']);

function normalizeEnvValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return INVALID_ENV_VALUES.has(raw.toLowerCase()) ? '' : raw;
}

function ensureHttpProtocol(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  return `http://${value}`;
}

function sanitizeHttpUrl(value, fallback = DEFAULT_EVA_CORE_URL) {
  const normalizedFallback = String(fallback || DEFAULT_EVA_CORE_URL).trim().replace(/\/+$/, '');
  const raw = normalizeEnvValue(value);
  const candidate = raw ? ensureHttpProtocol(raw) : normalizedFallback;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || INVALID_ENV_VALUES.has(parsed.hostname.toLowerCase())) {
      throw new Error('Invalid hostname');
    }

    const pathname = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname}`;
  } catch (_) {
    return normalizedFallback;
  }
}

function sanitizeSocketPath(value, fallback = DEFAULT_SOCKET_PATH) {
  const raw = normalizeEnvValue(value);
  if (!raw) return fallback;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return parsed.pathname.replace(/\/+$/, '') || fallback;
    } catch (_) {
      return fallback;
    }
  }

  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  return normalized.replace(/\/+$/, '') || fallback;
}

const EVA_CORE_URL = sanitizeHttpUrl(process.env.EXPO_PUBLIC_EVA_CORE_URL, DEFAULT_EVA_CORE_URL);
const EVA_WEB_URL = sanitizeHttpUrl(
  process.env.EXPO_PUBLIC_EVA_WEB_URL,
  `${EVA_CORE_URL}${DEFAULT_EVA_WEB_PATH}`,
);
const SOCKET_PATH = sanitizeSocketPath(
  process.env.EXPO_PUBLIC_EVA_CORE_SOCKET_PATH,
  DEFAULT_SOCKET_PATH,
);

export { APP_VERSION, EVA_CORE_URL, EVA_WEB_URL, SOCKET_PATH };
