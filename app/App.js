/**
 * App.js — Eva Locate
 * Single screen: connection status, current readings, pair code generator.
 */

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import * as Sensors from './service/sensors';
import * as Relay from './service/relay';

const RELAY_PAIR_ENDPOINT = 'https://eva.tail5afb5a.ts.net:8443/pair';

// Keep notifications visible while in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default function App() {
  const [relayStatus, setRelayStatus] = useState('disconnected'); // connecting|connected|disconnected
  const [sensorsStarted, setSensorsStarted] = useState(false);
  const [pairCode, setPairCode] = useState(null);
  const [pairExpiry, setPairExpiry] = useState(null);
  const [pairing, setPairing] = useState(false);
  const [snapshot, setSnapshot] = useState({ location: null, battery: null });
  const expiryTimer = useRef(null);

  // Start sensors on mount
  useEffect(() => {
    (async () => {
      try {
        Sensors.setUpdateCallback(() => {
          setSnapshot(Sensors.getSnapshot());
        });
        await Sensors.start();
        setSensorsStarted(true);
      } catch (e) {
        Alert.alert('Permission required', e.message);
      }
    })();

    Relay.setStatusCallback(setRelayStatus);

    return () => {
      Sensors.stop();
      Relay.disconnect();
    };
  }, []);

  // Clear pair code when it expires
  useEffect(() => {
    if (!pairExpiry) return;
    const remaining = pairExpiry - Date.now();
    if (remaining <= 0) { setPairCode(null); setPairExpiry(null); return; }
    expiryTimer.current = setTimeout(() => {
      setPairCode(null);
      setPairExpiry(null);
    }, remaining);
    return () => clearTimeout(expiryTimer.current);
  }, [pairExpiry]);

  async function handleGenerateCode() {
    if (pairing) return;
    setPairing(true);
    setPairCode(null);
    try {
      const code = generateCode();
      const res = await fetch(RELAY_PAIR_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(`Relay error: ${res.status}`);
      const { session_token, expires_at_ms } = await res.json();

      setPairCode(code);
      setPairExpiry(expires_at_ms);

      // Connect to relay as the app (MCP server role)
      Relay.connect(session_token);
    } catch (e) {
      Alert.alert('Pairing failed', e.message);
    } finally {
      setPairing(false);
    }
  }

  const loc = snapshot.location;
  const bat = snapshot.battery;

  const statusColor =
    relayStatus === 'connected' ? '#4ade80' :
    relayStatus === 'connecting' ? '#facc15' : '#6b7280';

  const statusLabel =
    relayStatus === 'connected' ? 'Connected to Eva' :
    relayStatus === 'connecting' ? 'Connecting...' : 'Disconnected';

  const expiresIn = pairExpiry ? Math.max(0, Math.round((pairExpiry - Date.now()) / 1000)) : 0;

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Eva Locate</Text>
        <View style={s.statusRow}>
          <View style={[s.dot, { backgroundColor: statusColor }]} />
          <Text style={[s.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Readings */}
      <View style={s.card}>
        <Text style={s.cardLabel}>Location</Text>
        {loc ? (
          <>
            <Text style={s.value}>{loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}</Text>
            <Text style={s.sub}>
              ±{Math.round(loc.accuracy)}m
              {loc.speed != null && loc.speed > 0.5 ? `  ·  ${(loc.speed * 3.6).toFixed(1)} km/h` : ''}
              {loc.altitude != null ? `  ·  ${Math.round(loc.altitude)}m alt` : ''}
            </Text>
          </>
        ) : (
          <Text style={s.waiting}>
            {sensorsStarted ? 'Getting fix...' : 'Starting sensors...'}
          </Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardLabel}>Battery</Text>
        {bat ? (
          <Text style={s.value}>
            {bat.level}%{bat.charging ? '  ⚡ charging' : ''}
          </Text>
        ) : (
          <Text style={s.waiting}>Reading...</Text>
        )}
      </View>

      {/* Pair section */}
      <View style={s.pairSection}>
        {pairCode ? (
          <>
            <Text style={s.pairLabel}>Give Eva this code:</Text>
            <Text style={s.pairCode}>{pairCode}</Text>
            <Text style={s.pairExpiry}>Expires in {expiresIn}s</Text>
            <Text style={s.pairHint}>
              Run: jun-sense-connect pair {pairCode}
            </Text>
          </>
        ) : (
          <Pressable
            style={[s.button, pairing && s.buttonDisabled]}
            onPress={handleGenerateCode}
            disabled={pairing}
          >
            {pairing
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.buttonText}>Generate Pair Code</Text>
            }
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: Platform.OS === 'android' ? 48 : 60,
    paddingHorizontal: 20,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#f4f4f5',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  card: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#71717a',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  value: {
    fontSize: 17,
    color: '#f4f4f5',
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  sub: {
    fontSize: 13,
    color: '#71717a',
    marginTop: 4,
  },
  waiting: {
    fontSize: 15,
    color: '#52525b',
    fontStyle: 'italic',
  },
  pairSection: {
    marginTop: 20,
    alignItems: 'center',
  },
  button: {
    backgroundColor: '#1d4ed8',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 10,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  pairLabel: {
    color: '#71717a',
    fontSize: 13,
    marginBottom: 8,
  },
  pairCode: {
    fontSize: 44,
    fontWeight: '800',
    color: '#f4f4f5',
    letterSpacing: 8,
    fontVariant: ['tabular-nums'],
  },
  pairExpiry: {
    color: '#71717a',
    fontSize: 12,
    marginTop: 6,
  },
  pairHint: {
    color: '#3f3f46',
    fontSize: 11,
    marginTop: 12,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
});
