import { Color, createSystem, Group, Mesh, MeshBasicMaterial, Vector3, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sfx } from './audio/sfx.js';
import { ChasmLevel, Finale, ThiefLevel, WallLevel, type Level } from './game/levels.js';
import { Gestures } from './hands/gestures.js';
import { HandTracker } from './hands/handData.js';
import { PoseDetector, type PoseId, type PoseResult } from './hands/poseDetector.js';
import { HandShadowCasters } from './hands/shadows.js';
import { STAGE } from './scene/layout.js';
import { Room } from './scene/room.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { Fader, Flash, Hint, HoldRing, makeText, projectToWall } from './ui/wallUI.js';

type Phase = 'title' | 'level' | 'end';

/** Seconds without success before the hand-shape hint appears. */
const HINT_DELAY = 8;
/** Pause after a level is solved before the curtain falls. */
const SOLVED_LINGER = 1.6;
/** Half-length of the dim → swap → brighten curtain between scenes. */
const CURTAIN = 0.8;

/**
 * Game state machine: TITLE → LEVEL 1..3 → END. Owns every per-frame
 * subsystem; driven by ShadowPlaySystem below.
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
  readonly hint = new Hint();
  readonly debug = new DebugOverlay();
  readonly finale = new Finale();

  phase: Phase = 'title';
  private readonly levels: Level[];
  private levelIndex = 0;
  private level: Level | undefined;
  /** Time in the current level spent waiting for the player (excludes cutscenes). */
  private levelClock = 0;
  private hintShown = false;
  private solvedTimer = -1;
  /** Curtain: counts up while a scene change is in progress, -1 when idle. */
  private curtainT = -1;
  private curtainAction: (() => void) | undefined;

  private runTime = 0;
  private hintsUsed = 0;
  private wrongCreatures = 0;

  private readonly titleTexts: Fader[];
  private readonly levelTitles: Fader[];
  private levelTitleTimer = 0;
  private endTexts: Fader[] = [];
  private readonly wallPoint = new Vector3();

  constructor(private readonly world: World) {
    this.room.root.add(this.casters.root, this.wall);
    this.wall.add(this.ring.mesh, this.flash.mesh, this.hint.root);

    const title = makeText(['SHADOW PLAY'], 0.34, { size: 120, letterSpacing: 18, weight: '700' });
    title.position.set(0, STAGE.titleY, STAGE.z);
    const sub = makeText(['raise your hands to the light'], 0.18, { size: 64, italic: true });
    sub.position.set(0, STAGE.titleY - 0.27, STAGE.z);
    const how = makeText(['hold an open palm toward the wall'], 0.15, { size: 56 });
    how.position.set(0, STAGE.groundY - 0.05, STAGE.z);
    this.wall.add(title, sub, how);
    this.titleTexts = [new Fader(title, 1.5), new Fader(sub, 1.2), new Fader(how, 1)];
    this.titleTexts.forEach((t) => t.show());

    this.levels = [new ThiefLevel(this.room), new ChasmLevel(this.room), new WallLevel(this.room)];
    this.wall.add(this.finale.root);
    this.levelTitles = this.levels.map((l) => {
      const m = makeText([`${l.numeral} · ${l.title}`], 0.2, { size: 80, letterSpacing: 4 });
      m.position.set(0, STAGE.titleY, STAGE.z);
      this.wall.add(m, l.root);
      return new Fader(m, 1.5);
    });
  }

  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    this.hands.update(this.world, this.room.root);
    this.casters.update([this.hands.left, this.hands.right]);
    this.poses.updateFeatures();

    const inLevel = this.phase === 'level' && this.level !== undefined;
    const levelReady = inLevel && !this.level!.busy && !this.level!.solved && this.curtainT < 0;
    const g = this.gestures.update(dt, this.phase !== 'level' && this.curtainT < 0, false);
    const pose = this.poses.update(dt, levelReady);

    if (this.phase === 'title' || this.phase === 'end') this.updateMenuScreen(g.start);
    else if (inLevel) this.updateLevel(dt, pose, levelReady);

    this.level?.update(dt, time);
    this.finale.update(dt, time);
    this.updateCurtain(dt);
    this.room.update(dt);
    this.ring.update(dt, time);
    this.flash.update(dt);
    this.hint.update(dt, time);
    for (const t of this.titleTexts) t.update(dt);
    for (const t of this.levelTitles) t.update(dt);
    for (const t of this.endTexts) t.update(dt);

    // Desktop debug: D per spec; backquote too, because the IWER emulator uses WASD.
    if (this.debugKey('KeyD') || this.debugKey('Backquote')) this.debug.toggle();
    if (this.debugKey('KeyL')) this.debug.log();
    this.debug.update(dt, this.describe(), this.poses, this.gestures);
  }

  /** Title and end screens: an open palm held toward the wall (re)starts. */
  private updateMenuScreen(startFired: boolean): void {
    if (this.curtainT >= 0) return;
    const p = this.gestures.openPalm.progress;
    projectToWall(this.gestures.openPalmAnchor, this.room.lightPos, this.wallPoint);
    this.ring.set(p, this.wallPoint);
    sfx.setChime(p);
    if (startFired || this.debugKey('Enter')) {
      sfx.setChime(0);
      sfx.success();
      this.flash.fire(this.wallPoint);
      this.ring.set(0);
      for (const t of [...this.titleTexts, ...this.endTexts]) t.show(false);
      this.runCurtain(() => this.startRun());
    }
  }

  private startRun(): void {
    this.finale.hide();
    this.runTime = 0;
    this.hintsUsed = 0;
    this.wrongCreatures = 0;
    this.enterLevel(0);
  }

  private enterLevel(i: number): void {
    this.level?.exit();
    this.levelIndex = i;
    this.level = this.levels[i];
    this.level.enter();
    this.phase = 'level';
    this.levelClock = 0;
    this.hintShown = false;
    this.solvedTimer = -1;
    this.hint.show(null);
    this.poses.reset();
    this.levelTitles[i].show();
    this.levelTitleTimer = 3.5;
  }

  private updateLevel(dt: number, pose: PoseResult, ready: boolean): void {
    const level = this.level!;
    this.runTime += dt;

    if (this.levelTitleTimer > 0) {
      this.levelTitleTimer -= dt;
      if (this.levelTitleTimer <= 0) this.levelTitles[this.levelIndex].show(false);
    }

    // Desktop-only: number keys force a creature so the full flow is testable.
    let summoned: PoseId | null = pose.triggered;
    if (ready) {
      if (this.debugKey('Digit1')) summoned = 'dog';
      if (this.debugKey('Digit2')) summoned = 'bird';
      if (this.debugKey('Digit3')) summoned = 'rabbit';
    }

    projectToWall(pose.anchor, this.room.lightPos, this.wallPoint);
    this.ring.set(ready ? pose.progress : 0, this.wallPoint);
    sfx.setChime(ready ? pose.progress : 0);

    if (summoned && ready) {
      // Debug summons have no hand shadow: spawn mid-stage.
      if (!pose.triggered) this.wallPoint.set(-0.35, STAGE.groundY + 0.4, STAGE.z);
      sfx.setChime(0);
      sfx.success();
      this.flash.fire(this.wallPoint);
      this.ring.set(0);
      this.hint.show(null);
      if (summoned !== level.pose) {
        this.wrongCreatures++;
        this.levelClock = HINT_DELAY; // show the right shape straight after
      }
      level.summon(summoned, this.wallPoint);
    }

    if (ready) {
      this.levelClock += dt;
      if (this.levelClock >= HINT_DELAY && !this.hintShown) {
        this.hintShown = true;
        this.hintsUsed++;
        this.hint.show(level.pose);
      }
    }

    if (level.solved && this.solvedTimer < 0) {
      this.solvedTimer = 0;
      this.hint.show(null);
      sfx.levelComplete();
    }
    if (this.solvedTimer >= 0 && this.curtainT < 0) {
      this.solvedTimer += dt;
      if (this.solvedTimer > SOLVED_LINGER) {
        const next = this.levelIndex + 1;
        this.runCurtain(() => (next < this.levels.length ? this.enterLevel(next) : this.enterEnd()));
      }
    }
  }

  private enterEnd(): void {
    this.level?.exit();
    this.level = undefined;
    this.phase = 'end';
    this.finale.show();
    sfx.fanfare();
    const secs = Math.round(this.runTime);
    const score = Math.max(100, 3000 - secs * 5 - this.hintsUsed * 150 - this.wrongCreatures * 50);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    for (const f of this.endTexts) {
      f.mesh.removeFromParent();
      (f.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    const end = makeText(['The End'], 0.32, { size: 120, weight: '700', letterSpacing: 10 });
    end.position.set(0, STAGE.titleY, STAGE.z);
    const thanks = makeText(['thanks for playing'], 0.2, { size: 64, italic: true });
    thanks.position.set(0, STAGE.titleY - 0.26, STAGE.z);
    const stats = makeText([`time ${time}  ·  score ${score}`], 0.18, { size: 60 });
    stats.position.set(0, STAGE.titleY - 0.47, STAGE.z);
    const again = makeText(['hold an open palm to play again'], 0.16, { size: 52 });
    again.position.set(0, STAGE.groundY - 0.08, STAGE.z);
    const meshes: Mesh[] = [end, thanks, stats, again];
    this.wall.add(...meshes);
    this.endTexts = meshes.map((m, i) => new Fader(m, 1.2 - i * 0.2).show());
  }

  /** Dim the candle, run `action` at the darkest point, then brighten again. */
  private runCurtain(action: () => void): void {
    this.curtainT = 0;
    this.curtainAction = action;
  }

  private updateCurtain(dt: number): void {
    if (this.curtainT < 0) return;
    const before = this.curtainT;
    this.curtainT += dt;
    if (before < CURTAIN && this.curtainT >= CURTAIN) {
      this.curtainAction?.();
      this.curtainAction = undefined;
    }
    if (this.curtainT < CURTAIN) this.room.setBrightness(0.25);
    else this.room.setBrightness(this.phase === 'end' ? 1.7 : 1);
    if (this.curtainT >= 2 * CURTAIN) this.curtainT = -1;
  }

  private describe(): string {
    if (this.phase !== 'level' || !this.level) return this.phase;
    const l = this.level;
    return `level ${l.numeral} "${l.title}"${l.busy ? ' (cutscene)' : ''}${l.solved ? ' SOLVED' : ''}  clock ${this.levelClock.toFixed(1)}s`;
  }

  /** Desktop-only debug keys; never required on a headset. */
  debugKey(code: string): boolean {
    return this.world.input.keyboard.getKeyDown(code);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

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
