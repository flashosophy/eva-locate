# Eva Mobile Agent Notes

## Location Access

- Eva Mobile is pairless. Do not talk about paired nodes, pair codes, or local session files for location access.
- The app publishes location directly to EVA Core.
- The first diagnostic command is `node skill/eva-mobile-locate.js status`.
- If the shell does not already have EVA Core env vars, the locate script will try to auto-load `/home/jun/git/eva-core/.env` or `../eva-core/.env`.
- The locate script requires `EVA_CORE_SERVICE_TOKEN` (or `SERVICE_TOKEN`). If that variable is missing, explain it as a session credential/config problem, not a mobile pairing problem.

## Verification

- Use `node skill/eva-mobile-locate.js read eva-mobile://location` only after `status` reports `connected: true`.
- Do not expose precise coordinates unless the user asks for them.
- If `status` reports `available: false`, treat it as "no fresh fix has reached EVA Core yet."

## Mobile Runtime

- The mobile app pushes location over the authenticated Socket.IO connection with `location:update`.
- If location appears unavailable, distinguish between:
  1. EVA Core read-path/config failure
  2. Mobile app not authenticated to EVA Core
  3. Mobile app not receiving location permission/fixes
