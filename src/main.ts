import { Color, createSystem, Group, Vector3, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sfx } from './audio/sfx.js';
import { Gestures } from './hands/gestures.js';
import { HandTracker } from './hands/handData.js';
import { PoseDetector } from './hands/poseDetector.js';
import { HandShadowCasters } from './hands/shadows.js';
import { STAGE } from './scene/layout.js';
import { Room } from './scene/room.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { Fader, Flash, HoldRing, makeText, projectToWall } from './ui/wallUI.js';

type Phase = 'title' | 'level' | 'end';

/**
 * Game state machine: TITLE → LEVEL 1..3 → END, with PAUSE as an overlay.
 * Owns every per-frame subsystem; driven by ShadowPlaySystem below.
 */
class Game {
  readonly room = new Room();
  readonly hands = new HandTracker();
  readonly casters = new HandShadowCasters();
  readonly poses = new PoseDetector(this.hands.left, this.hands.right);
  readonly gestures = new Gestures(this.poses.left, this.poses.right);
  readonly wall = new Group();
  readonly ring = new HoldRing();
  readonly flash = new Flash();
  readonly debug = new DebugOverlay();

  phase: Phase = 'title';
  private readonly titleTexts: Fader[];
  private readonly wallPoint = new Vector3();

  constructor(private readonly world: World) {
    this.room.root.add(this.casters.root, this.wall);
    this.wall.add(this.ring.mesh, this.flash.mesh);

    const title = makeText(['SHADOW PLAY'], 0.34, { size: 120, letterSpacing: 18, weight: '700' });
    title.position.set(0, STAGE.titleY, STAGE.z);
    const sub = makeText(['raise your hands to the light'], 0.18, { size: 64, italic: true });
    sub.position.set(0, STAGE.titleY - 0.27, STAGE.z);
    const how = makeText(['hold an open palm toward the wall'], 0.15, { size: 56 });
    how.position.set(0, STAGE.groundY - 0.05, STAGE.z);
    this.wall.add(title, sub, how);
    this.titleTexts = [new Fader(title, 1.5), new Fader(sub, 1.2), new Fader(how, 1)];
    this.titleTexts.forEach((t) => t.show());
  }

  update(dt: number, time: number): void {
    this.hands.update(this.world, this.room.root);
    this.casters.update([this.hands.left, this.hands.right]);
    this.poses.updateFeatures();

    const g = this.gestures.update(dt, this.phase === 'title', false);
    if (this.phase === 'title') this.updateTitle(g.start);

    this.room.update(dt);
    this.ring.update(dt, time);
    this.flash.update(dt);
    for (const t of this.titleTexts) t.update(dt);

    // D per spec; backquote as a fallback because the IWER emulator uses WASD.
    if (this.debugKey('KeyD') || this.debugKey('Backquote')) this.debug.toggle();
    this.debug.update(dt, this.phase, this.poses, this.gestures);
    if (this.debugKey('KeyL')) this.debug.log();
  }

  private updateTitle(startFired: boolean): void {
    const p = this.gestures.openPalm.progress;
    projectToWall(this.gestures.openPalmAnchor, this.room.lightPos, this.wallPoint);
    this.ring.set(p, this.wallPoint);
    sfx.setChime(p);
    if (startFired || this.debugKey('Enter')) this.startGame();
  }

  startGame(): void {
    sfx.setChime(0);
    sfx.success();
    this.flash.fire(this.wallPoint.lengthSq() ? this.wallPoint : new Vector3(0, STAGE.titleY, STAGE.z));
    this.ring.set(0);
    for (const t of this.titleTexts) t.show(false);
    this.phase = 'level';
  }

  /** Desktop-only debug keys; never required on a headset. */
  debugKey(code: string): boolean {
    return this.world.input.keyboard.getKeyDown(code);
  }
}

let game: Game | undefined;
/** Where the desktop (non-XR) camera sits; matches iwsdk.config.json. */
const DESKTOP_EYE = new Vector3(0, 1.2, 0);

class ShadowPlaySystem extends createSystem({}) {
  private head = new Vector3();
  private anchoredSession: XRSession | undefined;
  private anchorFrames = 0;

  update(delta: number, time: number): void {
    if (!game) return;
    this.anchorRoom();
    game.update(Math.min(delta, 0.1), time);
  }

  /** Once per XR session, centre the room on the player's actual head. */
  private anchorRoom(): void {
    const session = this.world.session;
    if (!session) {
      if (this.anchoredSession) game!.room.anchorTo(DESKTOP_EYE);
      this.anchoredSession = undefined;
      return;
    }
    if (this.anchoredSession === session) return;
    if (++this.anchorFrames < 5) return; // let the viewer pose settle
    this.anchorFrames = 0;
    this.world.player.head.getWorldPosition(this.head);
    if (this.head.lengthSq() === 0) return;
    game!.room.anchorTo(this.head);
    this.anchoredSession = session;
  }
}

function setupEnterButton(world: World): void {
  const button = document.getElementById('enter-vr') as HTMLButtonElement | null;
  if (!button || !world.xrEnabled) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    sfx.unlock();
    world.launchXR();
  });
  world.visibilityState.subscribe((state) => {
    button.hidden = state !== VisibilityState.NonImmersive;
    if (state !== VisibilityState.NonImmersive) sfx.unlock();
  });
}

// Browsers only allow audio after a gesture.
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => sfx.unlock(), { passive: true });
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.scene.background = new Color(0x050302);
  world.renderer.shadowMap.enabled = true;
  game = new Game(world);
  world.createTransformEntity(game.room.root, { persistent: true });
  world.registerSystem(ShadowPlaySystem);
  setupEnterButton(world);
});
