import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

import DiagnosticsPanel from './components/DiagnosticsPanel';
import { APP_VERSION, EVA_WEB_URL } from './config';
import {
  getLocationPushStatus,
  startLocationPusher,
  stopLocationPusher,
  subscribeLocationPushStatus,
} from './service/location-pusher';
import {
  connectSocket,
  disconnectSocket,
  getSocketStatus,
  subscribeSocketStatus,
} from './service/socket';
import * as Sensors from './service/sensors';
import { clearAuthSession, loadAuthSession, saveAuthSession } from './store/auth';

const AUTH_STORAGE_KEY = 'eva-core-auth';
const ANDROID_TOP_INSET = Platform.OS === 'android'
  ? Math.max(50, Number(NativeStatusBar.currentHeight || 0) + 10)
  : 0;

const AUTH_BRIDGE_SCRIPT = `
  (function () {
    if (window.__evaMobileBridgeInstalled) {
      return;
    }
    window.__evaMobileBridgeInstalled = true;

    var authStorageKey = ${JSON.stringify(AUTH_STORAGE_KEY)};

    function post(payload) {
      try {
        if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      } catch (_) {}
    }

    function postRoute() {
      post({
        type: 'eva-route',
        href: String(window.location && window.location.href || ''),
        path: String(window.location && window.location.pathname || ''),
      });
    }

    function postAuthState() {
      try {
        var raw = localStorage.getItem(authStorageKey);
        var parsed = raw ? JSON.parse(raw) : null;
        var state = parsed && parsed.state ? parsed.state : {};
        var token = typeof state.token === 'string' ? state.token : '';
        var isAuthenticated = Boolean(state.isAuthenticated && token);

        post({
          type: 'eva-auth',
          token: token,
          user: state.user || null,
          isAuthenticated: isAuthenticated,
        });
      } catch (error) {
        post({
          type: 'eva-auth-error',
          message: String((error && error.message) || error || 'unknown'),
        });
      }
    }

    var originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      if (key === authStorageKey) {
        postAuthState();
      }
    };

    var originalRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (key) {
      originalRemoveItem(key);
      if (key === authStorageKey) {
        postAuthState();
      }
    };

    var originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(history, arguments);
      postRoute();
    };

    var originalReplaceState = history.replaceState;
    history.replaceState = function () {
      originalReplaceState.apply(history, arguments);
      postRoute();
    };

    window.addEventListener('popstate', postRoute);
    window.addEventListener('hashchange', postRoute);
    window.addEventListener('storage', function (event) {
      if (!event || event.key === authStorageKey) {
        postAuthState();
      }
    });

    postAuthState();
    postRoute();
    setInterval(postAuthState, 4000);
  })();
  true;
`;

function parseMessage(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch (_) {
    return null;
  }
}

function urlPath(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return String(new URL(raw).pathname || '');
  } catch (_) {
    return raw;
  }
}

function isLoginPath(path) {
  const normalized = String(path || '').toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('/chat')) return false;
  return (
    normalized.endsWith('/eva-orchestrator')
    || normalized.endsWith('/eva-orchestrator/')
    || normalized.endsWith('/login')
  );
}

export default function App() {
  const authSessionRef = useRef(null);

  const [booting, setBooting] = useState(true);
  const [authSession, setAuthSession] = useState(null);

  const [webViewKey, setWebViewKey] = useState(1);
  const [webError, setWebError] = useState('');
  const [bridgeError, setBridgeError] = useState('');
  const [sensorError, setSensorError] = useState('');
  const [socketError, setSocketError] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [sensorSnapshot, setSensorSnapshot] = useState(() => Sensors.getSnapshot());
  const [socketStatus, setSocketStatus] = useState(() => getSocketStatus());
  const [pushStatus, setPushStatus] = useState(() => getLocationPushStatus());

  const updateSession = useCallback(async (nextSession) => {
    const nextToken = String(nextSession?.token || '').trim();
    const currentToken = String(authSessionRef.current?.token || '').trim();

    if (nextToken === currentToken) {
      return;
    }

    if (nextToken) {
      const normalizedSession = {
        token: nextToken,
        user: nextSession?.user || null,
      };
      authSessionRef.current = normalizedSession;
      setAuthSession(normalizedSession);
      await saveAuthSession(nextToken, normalizedSession.user);
      return;
    }

    authSessionRef.current = null;
    setAuthSession(null);
    await clearAuthSession();
  }, []);

  useEffect(() => {
    const unsubscribeSensors = Sensors.subscribeUpdates((_kind, snapshot) => {
      setSensorSnapshot(snapshot);
    });
    const unsubscribeSocket = subscribeSocketStatus((status) => {
      setSocketStatus(status);
    });
    const unsubscribePush = subscribeLocationPushStatus((status) => {
      setPushStatus(status);
    });

    return () => {
      unsubscribeSensors();
      unsubscribeSocket();
      unsubscribePush();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        try {
          await Sensors.start();
          setSensorError('');
        } catch (err) {
          setSensorError(String(err?.message || 'Location setup failed'));
        }

        const stored = await loadAuthSession();
        if (!cancelled && stored?.token) {
          authSessionRef.current = stored;
          setAuthSession(stored);
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      stopLocationPusher();
      disconnectSocket();
      Sensors.stop().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const token = String(authSession?.token || '').trim();
    if (!token) {
      setSocketError('');
      stopLocationPusher();
      disconnectSocket();
      return;
    }

    const socket = connectSocket(token);

    const handleConnect = () => {
      setSocketError('');
    };
    const handleConnectError = (error) => {
      setSocketError(String(error?.message || 'Realtime connection failed'));
    };
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);

    startLocationPusher();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      stopLocationPusher();
      disconnectSocket();
    };
  }, [authSession?.token]);

  const handleWebMessage = useCallback((event) => {
    const message = parseMessage(event?.nativeEvent?.data);
    if (!message || typeof message !== 'object') return;

    if (message.type === 'eva-auth') {
      setBridgeError('');
      const token = message.isAuthenticated ? String(message.token || '').trim() : '';
      updateSession(token ? { token, user: message.user || null } : null).catch((err) => {
        setBridgeError(err?.message || 'Failed to sync auth state');
      });
      return;
    }

    if (message.type === 'eva-auth-error') {
      setBridgeError(String(message.message || 'Auth bridge parse error'));
      return;
    }

    if (message.type === 'eva-route') {
      setCurrentPath(urlPath(message.path || message.href || ''));
    }
  }, [updateSession]);

  const showLoginVersion = useMemo(() => {
    return isLoginPath(currentPath);
  }, [currentPath]);

  const issueMessage = webError || bridgeError;
  const issueTitle = 'Connection issue';
  const canReloadWebView = Boolean(webError || bridgeError);

  if (booting) {
    return (
      <View style={s.bootWrap}>
        <ExpoStatusBar style="light" translucent={false} backgroundColor="#070b16" />
        <ActivityIndicator color="#22d3ee" />
        <Text style={s.bootText}>Booting Eva Mobile...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ExpoStatusBar style="light" translucent={false} backgroundColor="#070b16" />

      <View style={s.webViewFrame}>
        <WebView
          key={webViewKey}
          source={{ uri: EVA_WEB_URL }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          injectedJavaScriptBeforeContentLoaded={AUTH_BRIDGE_SCRIPT}
          onMessage={handleWebMessage}
          onNavigationStateChange={(navState) => {
            setCurrentPath(urlPath(navState?.url || ''));
          }}
          onError={(event) => {
            const description = String(event?.nativeEvent?.description || 'Failed to load web app');
            setWebError(`${description} (${EVA_WEB_URL})`);
          }}
          onHttpError={(event) => {
            const code = event?.nativeEvent?.statusCode;
            const description = String(event?.nativeEvent?.description || 'WebView request failed');
            setWebError(`HTTP ${code || 'error'}: ${description} (${EVA_WEB_URL})`);
          }}
          onLoadStart={() => {
            setWebError('');
          }}
          startInLoadingState
          renderLoading={() => (
            <View style={s.webLoadingWrap}>
              <ActivityIndicator color="#22d3ee" />
              <Text style={s.webLoadingText}>Loading EVA Orchestrator...</Text>
            </View>
          )}
        />
      </View>

      {issueMessage ? (
        <View style={s.errorOverlay}>
          <Text style={s.errorTitle}>{issueTitle}</Text>
          <Text style={s.errorText}>{issueMessage}</Text>
          {canReloadWebView ? (
            <Pressable
              style={s.retryButton}
              onPress={() => {
                setWebError('');
                setBridgeError('');
                setWebViewKey((value) => value + 1);
              }}
            >
              <Text style={s.retryText}>Reload</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showLoginVersion ? (
        <View pointerEvents="none" style={s.versionBadge}>
          <Text style={s.versionText}>Eva Mobile v{APP_VERSION}</Text>
        </View>
      ) : null}

      <DiagnosticsPanel
        authSession={authSession}
        sensorSnapshot={sensorSnapshot}
        sensorError={sensorError}
        socketStatus={socketStatus}
        socketError={socketError}
        pushStatus={pushStatus}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#070b16',
  },
  bootWrap: {
    flex: 1,
    backgroundColor: '#070b16',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bootText: {
    color: '#93c5fd',
    fontSize: 14,
  },
  webLoadingWrap: {
    flex: 1,
    backgroundColor: '#070b16',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  webViewFrame: {
    flex: 1,
    paddingTop: ANDROID_TOP_INSET,
    backgroundColor: '#070b16',
  },
  webLoadingText: {
    color: '#93c5fd',
    fontSize: 13,
  },
  versionBadge: {
    position: 'absolute',
    top: ANDROID_TOP_INSET + 10,
    right: 10,
    backgroundColor: 'rgba(8, 15, 30, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.8)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  versionText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
  },
  errorOverlay: {
    position: 'absolute',
    top: ANDROID_TOP_INSET + 56,
    left: 14,
    right: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: 'rgba(69, 10, 10, 0.95)',
    padding: 12,
    gap: 8,
  },
  errorTitle: {
    color: '#fecaca',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#fee2e2',
    fontSize: 12,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  retryText: {
    color: '#fee2e2',
    fontSize: 12,
    fontWeight: '700',
  },
});
