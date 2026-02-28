#!/usr/bin/env node
/**
 * jun-sense-connect.js
 * OpenClaw skill client for jun-sense phone sensor relay.
 *
 * Usage:
 *   jun-sense-connect.js pair <CODE>        Pair with phone, save session
 *   jun-sense-connect.js status             Check connection state
 *   jun-sense-connect.js read <uri>         Read a resource (one-shot)
 *   jun-sense-connect.js list-resources     List available resources
 *
 * URIs:
 *   jun://location    GPS position
 *   jun://battery     Battery level + charging state
 *
 * All output is JSONL (one JSON object per line).
 * Env vars:
 *   JUN_RELAY_URL          WebSocket relay URL (default: wss://eva.tail5afb5a.ts.net:8443)
 *   JUN_PAIR_ENDPOINT      HTTP pair endpoint  (default: https://eva.tail5afb5a.ts.net:8443/pair)
 *   JUN_SESSION_FILE       Path to session file (default: ~/.openclaw/jun-sense-session.json)
 */

'use strict';

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RELAY_URL = process.env.JUN_RELAY_URL || 'wss://eva.tail5afb5a.ts.net:8443';
const PAIR_ENDPOINT = process.env.JUN_PAIR_ENDPOINT || 'https://eva.tail5afb5a.ts.net:8443/pair';
const SESSION_FILE = process.env.JUN_SESSION_FILE ||
  path.join(os.homedir(), '.openclaw', 'jun-sense-session.json');

const REQUEST_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 10_000;

// --- Output ---

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function die(code, message) {
  emit({ type: 'error', code, message });
  process.exit(1);
}

// --- Session store ---

function loadSession() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveSession(data) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

function clearSession() {
  try { fs.unlinkSync(SESSION_FILE); } catch (_) {}
}

// --- WebSocket connection ---

function connectWs(sessionToken) {
  return new Promise((resolve, reject) => {
    const url = `${RELAY_URL}/connect/${sessionToken}`;
    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Connection timed out'));
    }, CONNECT_TIMEOUT_MS);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });

    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// --- MCP request/response ---

let _msgId = 1;
const _pending = new Map(); // id -> { resolve, reject, timer }

function request(ws, method, params) {
  return new Promise((resolve, reject) => {
    const id = _msgId++;
    const timer = setTimeout(() => {
      _pending.delete(id);
      reject(new Error(`Request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);
    _pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }));
  });
}

function notify(ws, method, params) {
  ws.send(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }));
}

function handleMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  if (msg.id !== undefined && _pending.has(msg.id)) {
    const { resolve, reject, timer } = _pending.get(msg.id);
    _pending.delete(msg.id);
    clearTimeout(timer);
    if (msg.error) {
      reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    } else {
      resolve(msg.result);
    }
  }
}

// --- MCP session init ---

async function initSession(ws) {
  ws.on('message', (data) => handleMessage(data.toString()));

  const result = await request(ws, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'jun-sense-connect', version: '1.0.0' },
  });

  notify(ws, 'notifications/initialized');
  return result;
}

// --- Commands ---

async function cmdPair(code) {
  if (!code) die('USAGE', 'pair <CODE>');

  // POST to relay to get session token
  let pairResult;
  try {
    const res = await fetch(PAIR_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      die('PAIR_FAILED', `Relay returned ${res.status}: ${text}`);
    }
    pairResult = await res.json();
  } catch (e) {
    die('PAIR_FAILED', `Could not reach relay: ${e.message}`);
  }

  const { session_token, expires_at_ms } = pairResult;
  if (!session_token) die('PAIR_FAILED', 'No session_token in relay response');

  // Connect and do MCP handshake to verify phone is there
  let ws;
  try {
    ws = await connectWs(session_token);
  } catch (e) {
    die('CONNECT_FAILED', `WebSocket error: ${e.message}`);
  }

  let serverInfo;
  try {
    const initResult = await initSession(ws);
    serverInfo = initResult?.serverInfo || {};
  } catch (e) {
    ws.terminate();
    die('HANDSHAKE_FAILED', `MCP handshake failed: ${e.message}`);
  }

  ws.close(1000);
  saveSession({ session_token, expires_at_ms, serverInfo, pairedAt: Date.now() });

  emit({ type: 'paired', session_token, serverInfo });
}

async function cmdStatus() {
  const session = loadSession();
  if (!session) {
    emit({ type: 'status', connected: false, reason: 'no_session' });
    return;
  }

  let ws;
  try {
    ws = await connectWs(session.session_token);
  } catch (e) {
    emit({ type: 'status', connected: false, reason: 'connect_failed', error: e.message });
    return;
  }

  try {
    await initSession(ws);
    ws.close(1000);
    emit({ type: 'status', connected: true, serverInfo: session.serverInfo || {} });
  } catch (e) {
    ws.terminate();
    emit({ type: 'status', connected: false, reason: 'handshake_failed', error: e.message });
  }
}

async function cmdRead(uri) {
  if (!uri) die('USAGE', 'read <uri>');

  const session = loadSession();
  if (!session) die('NO_SESSION', 'No session. Run: jun-sense-connect pair <CODE>');

  let ws;
  try {
    ws = await connectWs(session.session_token);
  } catch (e) {
    die('CONNECT_FAILED', `WebSocket error: ${e.message}`);
  }

  try {
    await initSession(ws);
    const result = await request(ws, 'resources/read', { uri });
    ws.close(1000);
    const content = result?.contents?.[0];
    if (!content) die('READ_FAILED', 'Empty response from phone');
    const data = JSON.parse(content.text);
    emit({ type: 'resource', uri, data });
  } catch (e) {
    ws.terminate();
    die('READ_FAILED', e.message);
  }
}

async function cmdListResources() {
  const session = loadSession();
  if (!session) die('NO_SESSION', 'No session. Run: jun-sense-connect pair <CODE>');

  let ws;
  try {
    ws = await connectWs(session.session_token);
  } catch (e) {
    die('CONNECT_FAILED', `WebSocket error: ${e.message}`);
  }

  try {
    await initSession(ws);
    const result = await request(ws, 'resources/list');
    ws.close(1000);
    emit({ type: 'resources', resources: result?.resources || [] });
  } catch (e) {
    ws.terminate();
    die('LIST_FAILED', e.message);
  }
}

// --- Entry point ---

async function main() {
  const [,, cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'pair':           await cmdPair(rest[0]); break;
    case 'status':         await cmdStatus(); break;
    case 'read':           await cmdRead(rest[0]); break;
    case 'list-resources': await cmdListResources(); break;
    default:
      die('NO_COMMAND', [
        'Usage: jun-sense-connect <command>',
        '  pair <CODE>        Pair with phone',
        '  status             Check connection',
        '  read <uri>         Read sensor data',
        '    jun://location',
        '    jun://battery',
        '  list-resources     List available resources',
      ].join('\n'));
  }
}

main().catch((e) => die('UNEXPECTED', e.message));
