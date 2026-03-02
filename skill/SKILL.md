---
name: eva-mobile
description: Read Jun's last known GPS location and battery from Eva Mobile via EVA Core.
metadata: {"openclaw":{"requires":{"bins":["node"]},"emoji":"📍","homepage":"https://github.com/flashosophy/eva-mobile"}}
---

# Eva Mobile Locate Skill

Eva Mobile publishes location updates directly to EVA Core.

No pairing step exists.

- Never ask the user to "generate pair code"
- Never request focus-only relay setup
- Never expect a local pairing/session file

Primary commands:

```bash
node {baseDir}/eva-mobile-locate.js status
node {baseDir}/eva-mobile-locate.js read eva-mobile://location
node {baseDir}/eva-mobile-locate.js read eva-mobile://battery
```

Run commands using `{baseDir}/eva-mobile-locate.js`.

All output is JSONL (one JSON object per line).

## Environment

- `EVA_CORE_URL` - EVA Core base URL (example: `http://127.0.0.1:3456`)
- `EVA_CORE_SERVICE_TOKEN` - service token used to read `/api/location/:userId`
- `EVA_CORE_LOCATION_USER_ID` - target user id (default: `user-jun`)

## Commands

### Check status (first choice)

```bash
node {baseDir}/eva-mobile-locate.js status
```

Examples:

```json
{"type":"status","connected":true,"available":true,"userId":"user-jun","staleSeconds":24,"warning":null}
{"type":"status","connected":true,"available":false,"reason":"location_not_found","userId":"user-jun"}
{"type":"status","connected":false,"available":false,"reason":"request_failed","error":"..."}
```

### Read location

```bash
node {baseDir}/eva-mobile-locate.js read eva-mobile://location
```

Example:

```json
{"type":"resource","uri":"eva-mobile://location","data":{"lat":45.5017,"lng":-73.5673,"accuracy":8.2,"altitude":32.1,"speed":1.4,"heading":274.3,"ts":1771626476045,"battery":82,"staleSeconds":19,"available":true}}
```

### Read battery

```bash
node {baseDir}/eva-mobile-locate.js read eva-mobile://battery
```

Example:

```json
{"type":"resource","uri":"eva-mobile://battery","data":{"level":82,"ts":1771626477000,"staleSeconds":19,"available":true}}
```

### List resources

```bash
node {baseDir}/eva-mobile-locate.js list-resources
```

## Behavioral Rules

1. Query location only when relevant to Jun's request.
2. Never ask for a pair code and never instruct a pairing flow.
3. If `available: false`, explain that the app has not published a fix yet.
4. If `staleSeconds > 300`, include a stale-data warning.
5. If `connected: false`, verify EVA Core reachability and service token config.

## Troubleshooting when app is open but not locatable

1. Run `status` first; if `reason` is `location_not_found`, no location fix has reached EVA Core yet.
2. If `staleSeconds` is high, treat data as old and report it as stale instead of "live".
3. Confirm mobile location permissions allow background access.
4. Confirm the app is logged in and sensor/location publishing has started.
