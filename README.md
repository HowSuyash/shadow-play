# SHADOW PLAY

**Your Hands. Your Shadows. Your World.**

A hands-only WebXR shadow-puppet adventure for Meta Quest, playable in the browser. Sit in a candle-lit stone room facing a great wall. Your real tracked hands cast real shadows on it. Form a classic hand-shadow shape, hold it for a second, and the shadow **comes alive** as a creature that acts in the shadow world on the wall.

- **100% hand tracking.** No controller anywhere: start, menus, pause, restart, co-op and duels are all done with your hands.
- **Seated and comfortable.** Every interaction is within about 60 cm. No locomotion, no camera movement.
- **Quick to start, short to finish.** It's playable seconds after loading, and the story takes about 5–8 minutes.
- **Nothing to download.** It runs from an HTTPS link in the Meta Quest Browser.

**Play:** https://howsuyash.github.io/shadow-play/

---

## The four hand shadows

Hold the shape in front of the candle until the glowing ring around its shadow fills (1 second). Shapes are scored with forgiving soft rules, so near-misses still count.

| Creature | How to make it | What it can do |
|---|---|---|
| 🐕 **Dog** | One hand turned sideways, flat, fingers together pointing forward. Raise the **thumb** (ear), drop the **pinky** (jaw). | barks, chases, scares |
| 🐦 **Bird** | Both hands, palms to the wall, **thumbs hooked together** (the head), fingers spread like wings. | flies over gaps and walls |
| 🐇 **Rabbit** | One hand: **index + middle up** (ears), **ring + pinky curled** against the thumb (face). | digs tunnels, leaps |
| 🐍 **Snake** | One hand: all four fingers **straight and pressed together**, **thumb laid flat along the side** (the mouth). | slips through cracks |

## The story: five chapters

The Shadow Eater has stolen the light of the Shadow Kingdom, and your hands hold the old magic. Each chapter wins back one **fragment of light**, shown along the top of the wall.

| Chapter | The problem | One shadow… | …or another |
|---|---|---|---|
| **I · The First Light** (tutorial) | The lantern hangs across a chasm | 🐦 Bird carries it home | 🐇 Rabbit leaps the gap and keeps the light burning over there |
| **II · The Lost Treasure** | A thief steals the candle | 🐕 Dog chases him into the night | 🐇 Rabbit befriends him; he returns the candle and joins you at the end |
| **III · The Underground Secret** | A kitten is trapped behind a wall | 🐇 Rabbit digs a tunnel | 🐦 Bird coaxes the kitten up and over |
| **IV · The Forbidden Passage** | The castle gate is sealed | 🐍 Snake slips through a crack, strikes the lever, and the portcullis rises | — |
| **V · The Shadow Eater** | Four seals guard the caged light | 🐕 distracts · 🐦 reaches the platform · 🐇 digs to the hidden switch · 🐍 breaks the last seal | in co-op, two different creatures break two seals at once |

**Your shadows write the story.** The branches lead to different outcomes and a different cast at the finale, and the ending recaps *your* tale, one line per chapter, with your time and score. If you're stuck, shadow pictures of shapes that would work appear on the wall (after 4 s in the tutorial, 8 s in chapters II–IV, 2.5 s in the boss fight). A creature that doesn't fit the scene looks around, puzzled, and fades away.

## Modes

The main menu floats about 36 cm in front of you as big round buttons. **Pinch** (thumb tip to index tip) on one to choose it, or just hold an open palm toward the wall to begin the story.

- **Story:** the five chapters above.
- **Shadow Duel (Gesture Challenge):** a creature appears, and the first to form its shadow wins the round; best of five. Solo, you race the clock. With a partner, you race each other, with a scoreboard, a winner screen, rematch, and the match history for this session.
- **Shadow Memory:** the wall shows a sequence of creatures, each with its hand shape and its own note. Repeat it with your hands. It starts at 3, grows by one each time you succeed, and three mistakes end the game. Played on your own headset, even in a co-op room.
- **Creature Gallery:** all four creatures alive on the wall (still-locked ones are dimmed), what each can do and how to make it, chapter stars (★★★ = no hint and under 40 s), your best story time, duel record, best Memory length and 9 achievements. Saved on the device.
- **Play together (online co-op):** see below.

### Hands-only controls

| Action | Gesture |
|---|---|
| Choose a menu button | **Pinch** on it |
| Start the story / play again | Hold an **open palm** toward the wall for 1 s |
| Summon a creature | Hold its shape for 1 s |
| Pause | Turn **both palms face-up** for 1 s |
| Pause menu | Pinch **Resume · Restart** (this chapter) **· Recenter · Leave** |

Opening the Quest system menu also pauses the game.

## Play together (online co-op)

1. On the start page, tap **Play together → Host a room** to get a 4-digit code (a `?room=1234` link fills it in for your partner).
2. Your partner taps **Play together → Join a room** on their own Quest and types the code on the big keypad.
3. Both of you face the same wall. Your partner appears as a pair of glowing hands in their player colour (host gold, guest violet) with a name tag beside you, and **their hand shadow falls on your wall**.

**Shadow duet:** in co-op, a creature only comes alive when **both** of you hold a shape at the same time; the ring fills only while you're both holding. Make the **same** creature together and you summon a **giant** one for a bonus. In the boss fight, two **different** creatures break two seals at once. Shadow Duel becomes a head-to-head race. Either player can pause, and it pauses for both. If your partner leaves, you carry on solo.

**How it works:** there is no game server. The two browsers find each other through public Nostr relays, which are used only to swap WebRTC connection offers, and then talk directly over a peer-to-peer data channel ([Trystero](https://github.com/dmotz/trystero)). The **host's game is authoritative**: it decides every summon, chapter change and pause, and broadcasts them. A guest can only *request* actions. In duels, the host validates every claimed hit (right round, right creature, round still open) before awarding a point.

## Running it locally

Requirements: Node.js 20.19+ (22 or 24 recommended).

```bash
npm install
npm run dev        # https://localhost:8081  (HTTPS only; accept the local certificate)
npm test           # 41 automated tests
npm run build      # static site in dist/
```

The dev server includes the IWSDK emulator (IWER), so you can play in a desktop browser:
1. Click **Enter XR**.
2. Switch the emulator to **hand** input.
3. Shape and move the hands in the emulator's Hand panels.

To try it on a Quest, open the network URL that `npx @iwsdk/cli dev status` prints while the headset is on the same Wi-Fi.

**Desktop debug keys** (development only; never needed in a headset):

| Key | Action |
|---|---|
| `Enter` | Start the story / rematch |
| `G` / `V` / `M` | Open the Gallery / a Duel / Shadow Memory from the menu |
| `1` `2` `3` `4` | Force Dog / Bird / Rabbit / Snake (summon, or duel answer) |
| `P` | Pause / resume (`R` restarts the chapter, `Esc` leaves) |
| `D` or `` ` `` | Debug overlay: live per-finger curl, palm normals, every pose and gesture confidence, the hold timer |
| `L` | Log the overlay to the console (readable during an XR session) |

Simulated creatures are always labelled as debug input; they are never presented as hand tracking.

**Configuration:** none is required, and there are no secrets. See [.env.example](.env.example) for the optional relay list.

## Deployment

Every push to `main` typechecks, runs the tests, builds and deploys to **GitHub Pages** ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)). [vercel.json](vercel.json) makes the same static build deploy on **Vercel** as a backup. The build uses relative asset paths, so it works from any sub-path.

## How the hand interaction works

1. **Reading the hands** ([src/hands/handData.ts](src/hands/handData.ts)): all 25 joints of both hands come straight from the WebXR Hand Input API (`XRFrame.fillPoses` / `fillJointRadii`, falling back to `getJointPose`). They're converted to room space and **smoothed with a 4-frame moving average**.
2. **Real shadows** ([src/hands/shadows.ts](src/hands/shadows.ts)): the candle is the only shadow-casting light (a `SpotLight` with a soft 2048² map, focused on the region where hands are). Each hand has an invisible stand-in made of instanced capsules for every bone plus "webbing" for the palm, drawn with `colorWrite: false`. It only exists in the shadow map, so the shadow on the wall is a true real-time shadow of your tracked hand. That costs two draw calls per player.
3. **Pose detection** ([src/hands/poseDetector.ts](src/hands/poseDetector.ts)): per hand, it computes **finger curl** (the angle between the metacarpal→proximal and proximal→tip vectors), finger directions, the palm normal and the thumb's position; for the bird, the two-hand thumb and wrist distances. Each creature is an entry in a small **registry** (`POSE_DEFS`): soft linear ramps between "good" and "bad" values, combined with a geometric mean, give a 0–1 confidence. Thresholds live in `POSE_CONFIG`.
4. **Hold-to-trigger with hysteresis:** a pose must stay above 0.6 for 1.0 s. The timer drains at double speed rather than resetting, so tracking blips are forgiven. Only the most confident pose may charge, the pose already charging gets a stickiness bonus so it doesn't flicker to a neighbour, and a fired pose must be released before it can fire again.
5. **UI gestures** ([src/hands/gestures.ts](src/hands/gestures.ts)):
   - **Pinch:** thumb tip to index tip under 2 cm, released past 3.5 cm.
   - **Open palm:** fingers extended and the palm normal facing the wall.
   - **Palms up:** both palm normals pointing up, with the hands apart so it can't be confused with the bird.
6. **Co-op hands** ([src/net/coop.ts](src/net/coop.ts)): each player streams both hands, plus the shape they're holding and their hold progress, 20 times a second in one small `Float32Array`. The receiver eases toward the latest packet at full frame rate. The partner's skeleton drives a second shadow rig and the glowing-hands avatar.
7. **The transformation** ([src/effects/particles.ts](src/effects/particles.ts)): sparks gather into the ring while you hold a shape. Then a flash, a gold-and-purple burst and a chime, and the creature grows out of your shadow and drops into the scene. The whole particle system is one pooled additive `Points` draw call, which also carries the dust drifting through the candlelight.

## Art, audio and performance

- **Art:** everything is procedural, with no external assets. The stone is a canvas-generated texture. The creatures, props and scenery backdrops (village, forest, castle, moon and floating islands) are flat silhouettes built from shapes. The colour palette is warm candle gold, deep black and purple magic.
- **Audio:** every sound is synthesized with the Web Audio API: chimes, a bark, wing flaps, digging, mews, chirps, a gate rumble, the boss's roar, seals shattering, fanfares, and a room hum with candle crackle.
- **Performance:** it targets 72 fps on Quest. There is one shadow light and no post-processing. Silhouettes are unlit flat geometry, and the hand rigs, partner avatar and particles are single instanced/pooled draw calls. The per-frame path doesn't allocate.

## Code map

```
src/
  main.ts                 boot + game state machine (menu, story, gallery, duel, pause, co-op plumbing)
  scene/room.ts, layout.ts   candle-lit room, the shadow light, seated layout
  hands/handData.ts       WebXR joints → smoothed room-space skeletons
  hands/shadows.ts        invisible shadow-casting hand rig
  hands/poseDetector.ts   features, creature registry (dog, bird, rabbit, snake), hold timers
  hands/gestures.ts       pinch, open palm, palms up
  game/levels.ts          level base class + chapters I–III, finale
  game/finalLevels.ts     chapters IV (snake) and V (the Shadow Eater)
  game/creatures.ts       silhouettes + animation (dog, bird, rabbit, snake, thief, kitten), props
  game/backdrops.ts       distant scenery cloths
  game/progress.ts        stars, unlocks, best times, achievements (localStorage)
  game/shapes.ts          2D silhouette toolkit + coroutine cutscene scripting
  modes/duel.ts           Shadow Duel (Gesture Challenge), host-validated
  modes/memory.ts         Shadow Memory (repeat the sequence)
  net/coop.ts             serverless WebRTC co-op
  effects/particles.ts, glowHands.ts   sparks + dust, partner avatar
  ui/wallUI.ts            wall text, hold ring, hints, fragments bar, pinch menus
  ui/gallery.ts, lobby.ts, debugOverlay.ts
tests/                    Vitest: gestures on real joint fixtures, chapters, boss, duel, memory, progress
```

See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for what's done, what's not, and test results.
