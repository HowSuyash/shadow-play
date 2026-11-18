# Development status

_Last updated: 18 Nov 2026, before the competition deadline._

## Done and verified

| Area | Status | How it was verified |
|---|---|---|
| Real-time hand shadows (both hands, 25 joints) | ✅ | IWER emulator in XR: the shadow follows the emulated hand on the wall |
| Pose detection: dog, bird, rabbit, snake | ✅ | 23 unit tests on joint data captured from the emulator hand model, including 8 false-positive shapes |
| Hold-to-trigger (1 s), hysteresis, release-to-retrigger | ✅ | Unit tests; emulator (dog pose fires, open/flat/point hands don't) |
| Pinch, open palm, palms-up gestures | ✅ | Unit tests; emulator: palms-up pauses and a pinch on Resume resumes |
| Five-chapter story with branching outcomes (8 tales in I–III) | ✅ | Unit tests run every branch to completion headless; full playthrough in a headless GPU browser |
| Boss: four seals, solo order and co-op pairs | ✅ | Unit tests |
| Main menu, pause menu (Resume / Restart / Recenter / Leave) in story, duel and memory, gallery | ✅ | Headless playthrough (keyboard stand-ins); emulator for the pinch buttons |
| Shadow Duel (Gesture Challenge), solo and versus | ✅ | Unit tests (host validation, first hit, five rounds); headless solo match; **networked 5-round match between two browsers over the real relays**: identical creatures dealt, wrong claims rejected, scores matched on both sides (2–3), both finished |
| Online co-op: room code, partner hand shadows, host-authoritative sync, duet rule | ✅ connection and sync | Two isolated headless browsers over the real public relays: connect, start, summon, chapter change and pause all stay in sync |
| Shadow Memory (solo, per headset) | ✅ | Unit tests (grow on success, lives, replay, game over); headless run |
| Controllers detected → "put your controllers down" notice | ✅ | Emulator in controller mode |
| HUD: objective line + detected-creature label | ✅ | Emulator screenshot (DOG label over the filling ring) |
| Lobby: six-character codes, Copy invite link, player slots | ✅ | Two-browser test joins via the `?room=` link; screenshot |
| Settings (sound, effects; saved) and Credits | ✅ | Emulator: pinch Settings → Sound cycles and persists |
| Shadow Dragon (legendary unlock: finale + gallery) | ✅ | Full headless playthrough to the ending |
| Five 360° 3D worlds (Indian shadow-puppetry temple, Sky Kingdom, Forest, Castle, Shadow Realm), per-chapter, with reactions, fade transitions and per-world audio | ✅ | Headless GPU screenshots from three directions per world (60 fps, 18–28 draw calls); emulator in XR (temple around the player, hand shadow intact); full playthrough across all worlds |
| Progress, stars, achievements | ✅ | Unit tests; gallery shows them |
| Transformation particles, dust, partner glow avatar | ✅ | Screenshots; 60 fps (display cap) on an integrated AMD GPU at 1000×620 |
| Deploy: GitHub Pages via Actions (typecheck → tests → build), Vercel config | ✅ | Live at https://howsuyash.github.io/shadow-play/ |

## Not verified (needs hardware or people)

- **A real Meta Quest.** Frame rate, comfort, and how forgiving the four poses feel with real hands have only been checked in the emulator and with captured joint data. Thresholds live in `POSE_CONFIG` and the per-pose rules for quick tuning.
- **The duet rule with two real people.** The rule (both players must hold a shape) is covered by logic and unit tests; the network sync was tested with two browsers, but without real hands.
- **Strict networks.** There's no TURN server, so two headsets behind symmetric NAT (some campus or corporate Wi-Fi) may fail to connect. The game then simply stays solo and says so.

## Deliberate scope decisions (deadline)

- **No dedicated game server.** Co-op is serverless peer-to-peer with host authority and host-side validation of duel claims. A Colyseus/Socket.IO server would need paid hosting and credentials, and GitHub Pages can't run one. Moving to a server later only means replacing `src/net/coop.ts` with the same `send` / `onEvent` interface.
- **Room codes are six digits** (six characters, digits only), so they can be typed on a big pinch keypad in VR.
- **Of the competitive and party ideas, Gesture Challenge (duel, networked) and Shadow Memory (solo) are built.** Not built: Shadow Race, Battle, Soccer, Survival, and the Party mode.
- **No separate lobby "ready" step:** in co-op the game starts when either player chooses Story or Duel.
- **Settings covers sound and effects only.** Recenter is in the pause menu.
- **Gesture calibration is via tunable thresholds** (`POSE_CONFIG`), not an in-game calibration flow.
- **Worlds are procedural geometry, not detailed authored 3D art.** There are no external models or textures, so the look is stylised, not "Unreal-quality". There's no spatial (positional) audio yet: the ambience is stereo. The other player sees your glowing hands, not a full body avatar.

## Test results

```
npm test   →   Test Files 2 passed · Tests 41 passed
npx tsc --noEmit  →  clean
npm run build     →  ok
```

- `tests/poseDetector.test.ts`: classification on real joints, false positives, features, hold timer, detector timing.
- `tests/gameplay.test.ts`: every chapter branch, wrong creatures, chapter reset, boss solo and co-op, duel validation and flow, Shadow Memory, progress.

## Known issues / ideas

- The thief and kitten only appear in the chapters where the story puts them, so the gallery covers the four summonable creatures only.
- Hint timings are per chapter (`hintDelay`); tune them after playtests.
- Possible additions: a versus mode for Shadow Memory, a settings panel, an in-VR "ready" step for co-op, a TURN relay for strict networks.
