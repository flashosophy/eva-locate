import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EVA_CORE_URL } from '../config';

const APP_VERSION = '1.0.2';

export default function LoginScreen({ onSubmit, loading, error }) {
  const [password, setPassword] = useState('');

  const disabled = useMemo(() => loading || password.trim().length === 0, [loading, password]);

  const handleSubmit = () => {
    if (disabled) return;
    onSubmit(password.trim());
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={s.heroCard}>
        <View style={s.brandRow}>
          <Text style={s.brand}>Eva Mobile</Text>
          <Text style={s.version}>v{APP_VERSION}</Text>
        </View>
        <Text style={s.subtitle}>Sign in once. Chat and location stay active.</Text>
        <Text style={s.endpoint}>{EVA_CORE_URL}</Text>

        <View style={s.formCard}>
          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter EVA Core password"
            placeholderTextColor="#6b7280"
            onSubmitEditing={handleSubmit}
          />

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            style={[s.button, disabled && s.buttonDisabled]}
            disabled={disabled}
            onPress={handleSubmit}
          >
            {loading ? <ActivityIndicator color="#0f172a" /> : <Text style={s.buttonText}>Log In</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0b1220',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  heroCard: {
    borderRadius: 22,
    padding: 20,
    backgroundColor: '#111b2e',
    borderWidth: 1,
    borderColor: '#22324f',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  brand: {
    color: '#f8fafc',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  version: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 5,
  },
  endpoint: {
    marginTop: 4,
    color: '#475569',
    fontSize: 11,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  subtitle: {
    marginTop: 8,
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 21,
  },
  formCard: {
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
    gap: 10,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1326',
    color: '#f8fafc',
    paddingHorizontal: 12,
    fontSize: 16,
  },
  error: {
    color: '#fca5a5',
    fontSize: 13,
  },
  button: {
    marginTop: 4,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#22d3ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
});
