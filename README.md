# Shadow Play

**A hands-only shadow-puppet puzzle game for Meta Quest, in the browser.**

You sit in a dim, candle-lit stone room facing a large plain wall. When you hold your real hands in front of the candle, they cast real shadows on the wall. Make a classic hand-shadow shape and hold it for a second, and the shadow **comes alive**. A silhouette creature peels off the wall and acts in a 2D shadow world to solve a little puzzle.

- 100% hand tracking: no controllers anywhere, including start, pause and restart
- Seated: every interaction is within about 60 cm of you
- Playable within seconds of loading; a full run takes about 3–6 minutes
- Runs in the Meta Quest Browser from a hosted HTTPS link

**Play:** https://howsuyash.github.io/shadow-play/

---

## The story

| Chapter | What's happening | Shadow that solves it |
|---|---|---|
| **I · The Thief** | A hooded thief sneaks in and steals the candle | **Dog**: runs at him and barks, and the thief flees and drops the candle |
| **II · The Chasm** | The lantern hangs across a deep gap | **Bird**: flies over, picks up the lantern and hangs it on your side |
| **III · The Wall** | A kitten is trapped behind a brick wall | **Rabbit**: digs under the wall and leads the kitten out through the tunnel |
| **The End** | Everyone gathers in the candlelight | Your time and score are shown |

If you haven't solved a chapter after 8 seconds, a shadow picture of the hand shape you need appears on the wall. If you summon the wrong creature, it looks around, puzzled, and fades away, and the right hint appears.

## How to play

### The three hand shadows

Hold the shape steady in front of the candle until the glowing ring around its shadow fills (1 second). The poses are deliberately forgiving.

| Creature | How to make it |
|---|---|
| 🐕 **Dog** | One hand turned sideways, flat, fingers together pointing forward. Raise your **thumb** (the ear) and drop your **pinky** down (the open jaw). |
| 🐦 **Bird** | Both hands, palms toward you, **thumbs hooked together** in the middle (the head), fingers spread out like wings. |
| 🐇 **Rabbit** | One hand: **index and middle fingers up** (the ears); curl your **ring and pinky** down against your thumb (the face). |

### Controls (hands only)

| Action | Gesture |
|---|---|
| Start / play again | Hold an **open palm** toward the wall for 1 s |
| Summon a creature | Hold its hand shape for 1 s |
| Pause | Turn **both palms face-up** for 1 s |
| Resume / Restart | **Pinch** (thumb tip to index tip) on the big round button floating in front of you |

Opening the Quest system menu also pauses the game.

## Running it

```bash
npm install
npm run dev        # https://localhost:8081 (HTTPS only; accept the local certificate)
```

The dev server comes with the IWSDK emulator (IWER), so you can play in a desktop browser. To try it on a Quest, open the network URL that `npx @iwsdk/cli dev status` prints while the headset is on the same Wi-Fi.

**Desktop debug keys** (development aids only; never needed on a headset):

| Key | Action |
|---|---|
| `Enter` | Start / play again |
| `1` `2` `3` | Force Dog / Bird / Rabbit |
| `P` | Pause / resume (`R` restarts while paused) |
| `D` or `` ` `` | Debug overlay: live per-finger curl, palm normals, every pose and gesture confidence |
| `L` | Log the overlay to the console (readable during an XR session) |

**Build and deploy:** `npm run build` outputs a static site to `dist/` with relative asset paths. Every push to `main` builds and deploys to GitHub Pages ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)); `vercel.json` makes the same build deploy on Vercel as a backup.

## Tech stack

- **[Meta Immersive Web SDK (IWSDK)](https://iwsdk.dev)**: World, ECS system loop, XR session and input, emulator
- **Three.js** (re-exported by IWSDK) for rendering
- **WebXR Hand Input API** for the 25-joint hand skeleton
- **Web Audio API**: every sound is synthesized at runtime
- **TypeScript + Vite**

There are no external assets at all. The stone textures, silhouettes, glows and text are generated with canvas and geometry at startup, and all audio is synthesized, so there is nothing to download, nothing licensed, and nothing that can fail to load.

## How the hand interaction works

### 1. Reading the hands: [`src/hands/handData.ts`](src/hands/handData.ts)
Each frame, all 25 joints of both hands are read straight from WebXR (`XRFrame.fillPoses` / `fillJointRadii`, falling back to `getJointPose`). They are converted into the room's local space and **smoothed with a 4-frame moving average**, which removes tracking jitter without adding noticeable lag.

### 2. Real shadows: [`src/hands/shadows.ts`](src/hands/shadows.ts)
The candle is a single `SpotLight` with a soft 2048² shadow map, placed at lap height so it shines past your hands onto the wall (about 3–4× magnification). An invisible stand-in for each hand (instanced capsules for every finger bone, plus extra "webbing" segments that fill the palm) is drawn with `colorWrite: false`. You never see it, but it renders into the shadow map, so the shadow on the wall is a true real-time shadow of your tracked hand. Both hands cost two instanced draw calls in the shadow pass.

### 3. Pose detection: [`src/hands/poseDetector.ts`](src/hands/poseDetector.ts)
Per hand, every frame:
- **Finger curl** (0–1): the angle between the metacarpal→proximal and proximal→tip vectors
- **Finger direction**: unit vector from proximal joint to tip, used for "fingers together", "thumb raised" and "pinky dropped"
- **Palm normal**: cross product across the knuckle row, mirrored for the left hand
- **Two-hand features** for the bird: the closest distance between any thumb joints of the two hands, and the wrist distance

Each pose is a set of **soft rules**. Every rule is a linear ramp between a "good" and a "bad" value, rather than a hard threshold, and the rules are combined with a geometric mean. One clearly broken rule sinks the pose, but several near-misses still pass. That is what makes the shapes forgiving.

A pose must stay above **0.6 confidence for 1.0 s** to fire. The hold timer drains at twice its fill rate when the pose drops below the threshold, so a brief tracking glitch doesn't reset your progress. Only the single most confident pose may charge at a time, and a fired pose must be released before it can fire again.

### 4. UI gestures: [`src/hands/gestures.ts`](src/hands/gestures.ts)
- **Pinch:** thumb tip to index tip under 2 cm, released past 3.5 cm (hysteresis prevents flicker). Fires once, on the frame the pinch closes.
- **Open palm:** fingers extended and the palm normal facing the wall
- **Palms up:** both palm normals pointing up, with the hands held apart so the gesture can never be confused with the bird

### 5. Feedback
While a pose is building, a shader-drawn ring fills around the point where your hand's shadow hits the wall (projected from the candle position), and a rising chime follows the hold progress. On success there is a flash of light and an arpeggio, and the creature grows out of your shadow.

## Code map

```
src/
  main.ts            boot, ECS system, game state machine (TITLE → LEVEL I–III → END, PAUSE overlay)
  scene/room.ts      procedural stone room, flickering candle, the one shadow-casting light
  scene/layout.ts    seated-player layout constants (wall, candle, stage, menu)
  hands/handData.ts  raw WebXR joints → smoothed room-space hand skeletons
  hands/shadows.ts   invisible shadow-casting hand rig
  hands/poseDetector.ts  features, DOG / BIRD / RABBIT rules, hold timers
  hands/gestures.ts  pinch, open palm, palms up
  game/shapes.ts     2D silhouette toolkit + coroutine cutscene scripting
  game/creatures.ts  dog, bird, rabbit, thief, kitten (+ animations), candle and lantern props
  game/levels.ts     level base class, the three chapters, the finale
  ui/wallUI.ts       wall text, hold ring, flash, hint pictograms, pinch pause menu
  ui/debugOverlay.ts desktop tuning overlay
  audio/sfx.ts       synthesized chimes, bark, wing flaps, digging, mews, ambience
```

## Performance notes

Shadow Play targets 72 fps on Quest:
- one shadow-casting light and no post-processing
- silhouettes are flat unlit geometry, and the hand rig is two instanced meshes
- the per-frame update path does no allocation
- "vignette" and warmth come from the spotlight's penumbra and colour, not a screen effect
