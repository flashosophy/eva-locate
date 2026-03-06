import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function formatAge(ts, now) {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) {
    return 'not yet';
  }

  const diffMs = Math.max(0, now - value);
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function humanizeError(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  const lower = value.toLowerCase();
  if (lower.includes('invalid token')) {
    return 'the saved sign-in expired';
  }
  if (lower.includes('authentication required')) {
    return 'the app is not signed in';
  }
  if (lower.includes('location permission')) {
    return 'phone location permission is off';
  }
  if (lower.includes('xhr poll error') || lower.includes('network')) {
    return 'the phone cannot reach EVA Core over the network';
  }
  if (lower.includes('not_connected')) {
    return 'the server link is down right now';
  }
  if (lower.includes('timeout')) {
    return 'the server did not answer in time';
  }

  return value;
}

function buildRows({
  authSession,
  sensorSnapshot,
  sensorError,
  socketStatus,
  socketError,
  pushStatus,
  now,
}) {
  const meta = sensorSnapshot?.meta || {};
  const locationTs = sensorSnapshot?.location?.ts || meta.lastLocationAt || null;

  const authLine = authSession?.token
    ? `Signed in${authSession?.user?.name ? ` as ${authSession.user.name}` : ''}.`
    : 'Not signed in yet.';

  let gpsLine = 'Checking phone location.';
  if (sensorError) {
    gpsLine = `Phone location is blocked: ${humanizeError(sensorError)}.`;
  } else if (locationTs) {
    gpsLine = `Phone GPS last updated ${formatAge(locationTs, now)}.`;
  } else if (meta.foregroundPermission === 'granted') {
    gpsLine = 'Phone location is allowed, waiting for the first GPS fix.';
  } else if (meta.foregroundPermission === 'denied') {
    gpsLine = 'Phone location permission is off.';
  }

  let serverLine = 'Server link is idle until sign-in.';
  if (authSession?.token) {
    if (socketStatus?.state === 'connected') {
      serverLine = `Connected to EVA Core${socketStatus?.lastConnectedAt ? ` since ${formatAge(socketStatus.lastConnectedAt, now)}` : ''}.`;
    } else if (socketStatus?.state === 'connecting') {
      serverLine = 'Connecting to EVA Core now.';
    } else if (socketError || socketStatus?.lastError) {
      serverLine = `Server link is down: ${humanizeError(socketError || socketStatus?.lastError)}.`;
    } else {
      serverLine = 'Not connected to EVA Core right now.';
    }
  }

  let deliveryLine = 'Location sending waits until sign-in.';
  if (authSession?.token) {
    if (!locationTs) {
      deliveryLine = 'Location cannot be sent until the phone gets a GPS fix.';
    } else if (pushStatus?.inFlight) {
      deliveryLine = 'Sending the latest location now.';
    } else if (pushStatus?.pending) {
      deliveryLine = socketStatus?.state === 'connected'
        ? 'Latest location is queued and will retry shortly.'
        : 'Latest location is waiting for the server connection to come back.';
    } else if (pushStatus?.lastSuccessAt) {
      deliveryLine = `Last location reached EVA Core ${formatAge(pushStatus.lastSuccessAt, now)}.`;
    } else {
      deliveryLine = 'Waiting for the first successful location send.';
    }
  }

  const backgroundLine = meta.backgroundPermission === 'granted'
    ? 'Background location is allowed.'
    : 'Background location is not fully allowed, so updates may stop when the app is in the background.';

  return [
    { label: 'Sign-in', value: authLine },
    { label: 'Phone GPS', value: gpsLine },
    { label: 'Server link', value: serverLine },
    { label: 'Location send', value: deliveryLine },
    { label: 'Background', value: backgroundLine },
  ];
}

export default function DiagnosticsPanel({
  authSession,
  sensorSnapshot,
  sensorError,
  socketStatus,
  socketError,
  pushStatus,
}) {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const hasIssue = Boolean(
    sensorError
    || socketError
    || pushStatus?.lastError
    || socketStatus?.lastError
  );

  const overallLabel = hasIssue
    ? 'needs attention'
    : pushStatus?.lastSuccessAt
      ? 'working'
      : 'warming up';

  const rows = useMemo(() => {
    return buildRows({
      authSession,
      sensorSnapshot,
      sensorError,
      socketStatus,
      socketError,
      pushStatus,
      now,
    });
  }, [
    authSession,
    now,
    pushStatus,
    sensorError,
    sensorSnapshot,
    socketError,
    socketStatus,
  ]);

  const detailVisible = expanded || hasIssue;

  return (
    <View pointerEvents="box-none" style={s.wrap}>
      <Pressable
        style={[s.chip, hasIssue ? s.chipBad : (pushStatus?.lastSuccessAt ? s.chipGood : s.chipWarm)]}
        onPress={() => {
          setExpanded((value) => !value);
        }}
      >
        <View style={[s.dot, hasIssue ? s.dotBad : (pushStatus?.lastSuccessAt ? s.dotGood : s.dotWarm)]} />
        <Text style={s.chipText}>Phone status: {overallLabel}</Text>
      </Pressable>

      {detailVisible ? (
        <View style={s.card}>
          <Text style={s.title}>How this phone is doing</Text>
          {rows.map((row) => (
            <View key={row.label} style={s.row}>
              <Text style={s.rowLabel}>{row.label}</Text>
              <Text style={s.rowValue}>{row.value}</Text>
            </View>
          ))}
          {pushStatus?.lastError ? (
            <Text style={s.note}>Last send problem: {humanizeError(pushStatus.lastError)}.</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    bottom: 16,
    maxWidth: 320,
  },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipGood: {
    backgroundColor: 'rgba(8, 46, 35, 0.94)',
    borderColor: 'rgba(52, 211, 153, 0.45)',
  },
  chipWarm: {
    backgroundColor: 'rgba(67, 35, 10, 0.94)',
    borderColor: 'rgba(251, 191, 36, 0.45)',
  },
  chipBad: {
    backgroundColor: 'rgba(69, 10, 10, 0.95)',
    borderColor: 'rgba(248, 113, 113, 0.5)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  dotGood: {
    backgroundColor: '#34d399',
  },
  dotWarm: {
    backgroundColor: '#fbbf24',
  },
  dotBad: {
    backgroundColor: '#f87171',
  },
  chipText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.85)',
    backgroundColor: 'rgba(8, 15, 30, 0.96)',
    padding: 12,
    gap: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    gap: 4,
  },
  rowLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  rowValue: {
    color: '#e2e8f0',
    fontSize: 12,
    lineHeight: 17,
  },
  note: {
    color: '#fecaca',
    fontSize: 12,
    lineHeight: 17,
  },
});
