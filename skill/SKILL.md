---
name: jun-sense
description: Read Jun's real-time GPS location and battery state from his phone. Use when you need to know where Jun is, how fast he's moving, or his battery level. Data comes directly from his phone via a self-hosted relay.
metadata: {"openclaw":{"requires":{"bins":["node"]},"emoji":"📍","homepage":"https://github.com/jun/eva-gps"}}
---

# Jun Sense — Phone Location

Gives you access to Jun's phone sensors via the self-hosted relay at `eva.tail5afb5a.ts.net`.

Run commands using `{baseDir}/jun-sense-connect.js`.

All output is JSONL (one JSON object per line).

## Check if paired

```bash
cat ~/.openclaw/jun-sense-session.json 2>/dev/null
```

If the file exists with a `session_token`, you can read directly. If not, ask Jun to open the Jun Sense app and tap "Generate Pair Code".

## Pair (first time or after session expires)

Ask Jun: "Open the Jun Sense app and tap Generate Pair Code. What's the 6-character code?"

```bash
node {baseDir}/jun-sense-connect.js pair <CODE>
```

Success:
```json
{"type":"paired","session_token":"...","serverInfo":{"name":"jun-sense","version":"1.0.0"}}
```

Failure:
```json
{"type":"error","code":"PAIR_FAILED","message":"..."}
```

If pairing fails, ask Jun to check his phone is connected to the internet and retry with a fresh code.

## Check status

```bash
node {baseDir}/jun-sense-connect.js status
```

```json
{"type":"status","connected":true,"serverInfo":{}}
{"type":"status","connected":false,"reason":"no_session"}
{"type":"status","connected":false,"reason":"connect_failed","error":"..."}
```

## Read location

```bash
node {baseDir}/jun-sense-connect.js read jun://location
```

Success (fix acquired):
```json
{"type":"resource","uri":"jun://location","data":{"lat":45.5017,"lng":-73.5673,"accuracy":8.2,"altitude":32.1,"speed":1.4,"heading":274.3,"ts":1771626476045,"available":true}}
```

No fix yet:
```json
{"type":"resource","uri":"jun://location","data":{"available":false,"reason":"No fix yet"}}
```

Fields:
- `lat` / `lng` — decimal degrees
- `accuracy` — metres (lower is better)
- `speed` — metres per second (multiply by 3.6 for km/h)
- `heading` — degrees from north
- `altitude` — metres above sea level
- `ts` — Unix timestamp ms when reading was taken

## Read battery

```bash
node {baseDir}/jun-sense-connect.js read jun://battery
```

```json
{"type":"resource","uri":"jun://battery","data":{"level":67,"charging":false,"ts":1771626476000,"available":true}}
```

Fields:
- `level` — 0–100
- `charging` — true if plugged in

## List resources

```bash
node {baseDir}/jun-sense-connect.js list-resources
```

## Behavioral rules

1. Only read location when Jun's request is relevant to where he is — don't poll it speculatively.
2. If `available: false`, tell Jun the app may not have a GPS fix yet and to check his phone.
3. If `connected: false` with `reason: connect_failed`, check the relay is running: `curl https://eva.tail5afb5a.ts.net:8443/health`
4. If session expired (connect fails after a successful pair), delete `~/.openclaw/jun-sense-session.json` and ask Jun for a new pair code.
5. Speed under 0.5 m/s is effectively stationary — don't report it as movement.

## Troubleshooting

1. `node {baseDir}/jun-sense-connect.js status` — is the session valid?
2. `curl https://eva.tail5afb5a.ts.net:8443/health` — is the relay up?
3. Is the Jun Sense app open on Jun's phone? It must be running for reads to work.
4. If all else fails: `rm ~/.openclaw/jun-sense-session.json` and re-pair.
