import { Color, createSystem, Group, Mesh, MeshBasicMaterial, Vector3, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sfx } from './audio/sfx.js';
import { PassageLevel, ShadowEaterLevel } from './game/finalLevels.js';
import { ChasmLevel, Finale, ThiefLevel, WallLevel, type Level } from './game/levels.js';
import { ACHIEVEMENTS, Progress } from './game/progress.js';
import { Duel, type DuelEvent } from './modes/duel.js';
import { Gestures } from './hands/gestures.js';
import { HandData, HandTracker } from './hands/handData.js';
import { POSE_THRESHOLD, POSES, PoseDetector, type PoseId, type PoseResult } from './hands/poseDetector.js';
import { HandShadowCasters } from './hands/shadows.js';
import { Coop, type CoopEvent, type CoopRole } from './net/coop.js';
import { GlowHands, PLAYER_COLORS } from './effects/glowHands.js';
import { Particles } from './effects/particles.js';
import { STAGE } from './scene/layout.js';
import { Room } from './scene/room.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { Gallery } from './ui/gallery.js';
import { Lobby } from './ui/lobby.js';
import { Fader, Flash, FragmentBar, Hint, HoldRing, MainMenu, makeText, PauseMenu, PinchMenu, projectToWall } from './ui/wallUI.js';

type Phase = 'title' | 'level' | 'end' | 'gallery' | 'duel';

/** Seconds each alternative answer's hint stays up before switching. */
const HINT_CYCLE = 4;
/** Pause after a level is solved before the curtain falls. */
const SOLVED_LINGER = 1.6;
/** Half-length of the dim → swap → brighten curtain between scenes. */
const CURTAIN = 0.8;
/** Partner's shadow sits this far to the side of yours (room metres at the hands). */
const PARTNER_OFFSET = 0.2;
/** Score bonus for each giant duet creature. */
const DUET_BONUS = 250;

/**
 * Game state machine: TITLE (main menu) → LEVEL I..V → END, plus GALLERY and
 * DUEL from the menu, with PAUSE as an overlay. Owns every per-frame
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
  readonly menu = new PauseMenu();
  readonly mainMenu = new MainMenu();
  readonly backMenu = new PinchMenu<'back'>('pinch Back · or hold an open palm', [{ id: 'back', label: 'Back' }]);
  readonly duelMenu = new PinchMenu<'rematch' | 'menu'>('Shadow Duel', [
    { id: 'rematch', label: 'Rematch' },
    { id: 'menu', label: 'Menu' },
  ]);
  readonly gallery = new Gallery();
  readonly progress = new Progress();
  readonly particles = new Particles();
  private partnerGlow: GlowHands | undefined;
  readonly duel: Duel;
  private duelRecorded = false;
  /** Set by the system: re-anchor the room to the player's head next frame. */
  onRecenter: (() => void) | undefined;
  private toast: Fader | undefined;
  private toastTimer = 0;
  /** Per-chapter stats for stars. */
  private chapterTime = 0;
  private chapterHinted = false;
  /** Co-op partner's hands, streamed over the network, casting their own shadows. */
  readonly partnerLeft = new HandData('left');
  readonly partnerRight = new HandData('right');
  readonly partnerCasters = new HandShadowCasters();
  coop: Coop | undefined;
  /** Mirrors co-op status to the 2D lobby page. */
  onStatus: ((text: string) => void) | undefined;
  private statusText: Fader | undefined;

  phase: Phase = 'title';
  paused = false;
  private lastDt = 0;
  private readonly menuPinchPoints: Vector3[] = [];
  private readonly menuPinchStarted: boolean[] = [];
  private static readonly NONE: never[] = [];
  private readonly levels: Level[];
  private levelIndex = 0;
  private level: Level | undefined;
  /** Time in the current level spent waiting for the player (excludes cutscenes). */
  private levelClock = 0;
  private hintShown = false;
  private hintIndex = 0;
  private hintCycle = 0;
  private solvedTimer = -1;
  /** Curtain: counts up while a scene change is in progress, -1 when idle. */
  private curtainT = -1;
  private curtainAction: (() => void) | undefined;

  private runTime = 0;
  private hintsUsed = 0;
  private wrongCreatures = 0;
  private duets = 0;

  private readonly titleTexts: Fader[];
  private readonly levelTitles: Fader[];
  private readonly levelSubtitles: Fader[];
  readonly fragments = new FragmentBar();
  private levelTitleTimer = 0;
  private endTexts: Fader[] = [];
  private readonly wallPoint = new Vector3();

  constructor(private readonly world: World) {
    this.room.root.add(this.casters.root, this.partnerCasters.root, this.wall, this.menu.root, this.mainMenu.root, this.backMenu.root, this.duelMenu.root);
    this.duel = new Duel(this.hint, 'host', false, (e) => this.coop?.send(e));
    this.room.root.add(this.particles.points);
    this.wall.add(this.gallery.root, this.duel.root);
    this.wall.add(this.ring.mesh, this.flash.mesh, this.hint.root);

    const title = makeText(['SHADOW PLAY'], 0.34, { size: 120, letterSpacing: 18, weight: '700' });
    title.position.set(0, STAGE.titleY, STAGE.z);
    const sub = makeText(['Your Hands. Your Shadows. Your World.'], 0.18, { size: 64, italic: true });
    sub.position.set(0, STAGE.titleY - 0.27, STAGE.z);
    const how = makeText(['raise your hands to the light · hold an open palm to begin'], 0.15, { size: 56 });
    how.position.set(0, STAGE.groundY - 0.05, STAGE.z);
    this.wall.add(title, sub, how);
    this.titleTexts = [new Fader(title, 1.5), new Fader(sub, 1.2), new Fader(how, 1)];
    this.titleTexts.forEach((t) => t.show());
    this.mainMenu.setVisible(true);

    // The story: the Shadow Eater stole the light; five chapters win it back.
    this.levels = [
      new ChasmLevel(this.room),
      new ThiefLevel(this.room),
      new WallLevel(this.room),
      new PassageLevel(this.room),
      new ShadowEaterLevel(this.room),
    ];
    this.wall.add(this.finale.root, this.fragments.root);
    this.levelTitles = this.levels.map((l) => {
      const m = makeText([`${l.numeral} · ${l.title}`], 0.2, { size: 80, letterSpacing: 4 });
      m.position.set(0, STAGE.titleY, STAGE.z);
      this.wall.add(m, l.root);
      l.fx = this.particles;
      return new Fader(m, 1.5);
    });
    this.levelSubtitles = this.levels.map((l) => {
      const m = makeText([l.subtitle], 0.1, { size: 52, italic: true, color: '#ffe9c4' });
      m.position.set(0, STAGE.titleY - 0.17, STAGE.z);
      this.wall.add(m);
      return new Fader(m, 1.2);
    });
  }

  // -------------------------------------------------------------------------

  update(dt: number, time: number): void {
    this.lastDt = dt;
    this.hands.update(this.world, this.room.root);
    this.casters.update([this.hands.left, this.hands.right]);
    this.poses.updateFeatures();

    const inLevel = this.phase === 'level' && this.level !== undefined;
    const levelReady = inLevel && !this.paused && !this.level!.busy && !this.level!.solved && this.curtainT < 0;
    const canPause = inLevel && !this.paused && this.curtainT < 0;
    const openPalmPhase = this.phase === 'title' || this.phase === 'end' || this.phase === 'gallery';
    const g = this.gestures.update(dt, openPalmPhase && this.curtainT < 0, canPause);
    // Co-op "shadow duet": the host's summon only charges while the partner holds a shape too.
    // (If the partner isn't tracking hands yet, e.g. still on the 2D page, play on solo.)
    const partnerInVR = this.partnerLeft.tracked || this.partnerRight.tracked;
    const partnerHolding = !this.duetMode || !partnerInVR || this.coop!.partnerCharging !== null;
    const duelOpen = this.phase === 'duel' && this.duel.open && this.curtainT < 0;
    const pose = this.poses.update(dt, (levelReady && (this.isGuest || partnerHolding)) || duelOpen);

    if (this.coop) {
      this.coop.update(dt, this.hands.left, this.hands.right, this.localCharging(), pose.progress);
      this.partnerCasters.update([this.partnerLeft, this.partnerRight]);
    }

    this.collectPinches();
    if (this.phase === 'title' || this.phase === 'end') this.updateMenuScreen(g.start);
    else if (this.phase === 'gallery') this.updateGallery(g.start);
    else if (this.phase === 'duel') this.updateDuel(pose);
    else if (inLevel && this.paused) this.updatePaused(dt);
    else if (inLevel) this.updateLevel(dt, pose, levelReady, g.pause);

    // The shadow world freezes while paused.
    if (!this.paused) this.level?.update(dt, time);
    this.finale.update(dt, time);
    // Menus not being driven this frame still animate open/closed.
    if (!this.paused) this.menu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'title' && this.phase !== 'end') this.mainMenu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'gallery') this.backMenu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'duel') this.duelMenu.update(dt, Game.NONE, Game.NONE);
    this.gallery.update(dt, time);
    this.duel.update(dt, time);
    // Sparks gather into the ring while a shape is held.
    const rp = this.ring.progress;
    if (rp > 0.03 && Math.random() < 0.3 + rp) this.particles.gather(this.ring.target, 0.32, 1);
    this.particles.update(dt);
    this.partnerGlow?.update([this.partnerLeft, this.partnerRight], time);
    this.updateToast(dt);
    this.updateCurtain(dt);
    this.room.update(dt);
    this.ring.update(dt, time);
    this.flash.update(dt);
    this.hint.update(dt, time);
    for (const t of this.titleTexts) t.update(dt);
    for (const t of this.levelTitles) t.update(dt);
    for (const t of this.levelSubtitles) t.update(dt);
    this.fragments.update(dt, time);
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
    let choice = this.mainMenu.update(this.lastDt, this.menuPinchPoints, this.menuPinchStarted);
    if (startFired || this.debugKey('Enter')) choice = 'story';
    // Desktop-only shortcuts.
    if (this.debugKey('KeyG')) choice = 'gallery';
    if (this.debugKey('KeyV')) choice = 'duel';
    if (choice === 'story') this.request({ t: 'start' });
    else if (choice === 'duel') this.request({ t: 'mode', mode: 'duel' });
    else if (choice === 'gallery') this.enterGallery();
  }

  /** Pinch midpoints of tracked hands, shared by every pinch menu this frame. */
  private collectPinches(): void {
    const pts = this.menuPinchPoints;
    const started = this.menuPinchStarted;
    pts.length = 0;
    started.length = 0;
    if (this.poses.left.tracked) {
      pts.push(this.gestures.pinchL.point);
      started.push(this.gestures.pinchL.started);
    }
    if (this.poses.right.tracked) {
      pts.push(this.gestures.pinchR.point);
      started.push(this.gestures.pinchR.started);
    }
  }

  // -------------------------------------------------------------------------
  // Main menu destinations

  /** Back to the title / main menu (from anywhere). */
  private enterTitle(): void {
    if (this.paused) this.resume();
    this.level?.exit();
    this.level = undefined;
    this.finale.hide();
    this.gallery.hide();
    this.duel.stop();
    this.duelMenu.setVisible(false);
    this.backMenu.setVisible(false);
    this.fragments.setVisible(false);
    this.hint.show(null);
    this.ring.set(0);
    for (const t of [...this.levelTitles, ...this.levelSubtitles, ...this.endTexts]) t.show(false);
    for (const t of this.titleTexts) t.show();
    this.mainMenu.setVisible(true);
    this.phase = 'title';
  }

  private enterGallery(): void {
    sfx.click();
    this.runCurtain(() => {
      for (const t of [...this.titleTexts, ...this.endTexts]) t.hideNow();
      this.finale.hide();
      this.mainMenu.setVisible(false);
      this.gallery.show(this.progress);
      this.backMenu.setVisible(true);
      this.phase = 'gallery';
    });
  }

  private updateGallery(openPalm: boolean): void {
    let choice = this.backMenu.update(this.lastDt, this.menuPinchPoints, this.menuPinchStarted);
    if (openPalm || this.debugKey('Escape') || this.debugKey('Enter')) choice = 'back';
    if (choice === 'back' && this.curtainT < 0) {
      sfx.click();
      this.runCurtain(() => this.enterTitle());
    }
  }

  private enterDuel(): void {
    // Decide sides now (not after the curtain) so a guest never misses the host's deal.
    const versus = !!this.coop?.connected;
    this.duel.configure(this.coop?.isHost === false && versus ? 'guest' : 'host', versus);
    this.runCurtain(() => {
      for (const t of [...this.titleTexts, ...this.endTexts]) t.hideNow();
      this.level?.exit();
      this.level = undefined;
      this.finale.hide();
      this.gallery.hide();
      this.mainMenu.setVisible(false);
      this.backMenu.setVisible(false);
      this.duelMenu.setVisible(false);
      this.fragments.setVisible(false);
      this.phase = 'duel';
      this.duelRecorded = false;
      // The host (or a solo player) deals the creatures; a guest waits for them.
      if (!this.isGuest) this.duel.begin();
    });
  }

  private updateDuel(pose: PoseResult): void {
    const d = this.duel;
    projectToWall(pose.anchor, this.room.lightPos, this.wallPoint);
    this.ring.set(d.open ? pose.progress : 0, this.wallPoint);
    sfx.setChime(d.open ? pose.progress : 0);
    let hit = pose.triggered;
    // Desktop-only: number keys stand in for poses.
    if (this.debugKey('Digit1')) hit = 'dog';
    if (this.debugKey('Digit2')) hit = 'bird';
    if (this.debugKey('Digit3')) hit = 'rabbit';
    if (this.debugKey('Digit4')) hit = 'snake';
    if (hit && d.open) {
      this.progress.unlock(hit);
      if (hit === d.targets[d.round]) this.particles.burst(this.wallPoint, 60);
      d.localHit(hit);
    }
    if (d.done) {
      if (!this.duelRecorded) {
        this.duelRecorded = true;
        this.progress.recordDuel(d.localWon);
        this.duelMenu.setVisible(true);
      }
      let choice = this.duelMenu.update(this.lastDt, this.menuPinchPoints, this.menuPinchStarted);
      if (this.debugKey('Enter')) choice = 'rematch';
      if (this.debugKey('Escape')) choice = 'menu';
      if (choice === 'rematch') this.request({ t: 'mode', mode: 'duel' });
      else if (choice === 'menu') this.request({ t: 'mode', mode: 'menu' });
    }
  }

  /** A small celebratory line when an achievement unlocks. */
  private updateToast(dt: number): void {
    const fresh = this.progress.takeNew();
    if (fresh.length) {
      if (this.toast) {
        this.toast.mesh.removeFromParent();
        (this.toast.mesh.material as MeshBasicMaterial).map?.dispose();
      }
      const titles = fresh.map((id) => ACHIEVEMENTS[id].title).join(' · ');
      const m = makeText([`✦ ${titles} ✦`], 0.09, { size: 52, color: '#ffe2a8' });
      m.position.set(0, STAGE.titleY + 0.3, STAGE.z + 0.004);
      this.wall.add(m);
      this.toast = new Fader(m, 2.5).show();
      this.toastTimer = 3.5;
      sfx.charm();
    }
    if (this.toast) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.show(false);
      this.toast.update(dt);
    }
  }

  // -------------------------------------------------------------------------
  // Co-op plumbing. Every game-changing action goes through request(): solo
  // and host apply it (the host also broadcasts it); a guest asks the host.

  private get isGuest(): boolean {
    return this.coop?.role === 'guest' && this.coop.connected;
  }

  /** True when a partner is connected, so summons need both players. */
  private get duetMode(): boolean {
    return !!this.coop?.connected;
  }

  private request(e: CoopEvent): void {
    if (this.isGuest) this.coop!.send(e);
    else this.apply(e, true);
  }

  /** Apply an event locally; the host also forwards it to the guest. */
  private apply(e: CoopEvent | DuelEvent, broadcast: boolean): void {
    // Duel traffic has its own host-validated protocol (never blindly forwarded).
    if (e.t === 'duel') {
      this.duel.onEvent(e);
      return;
    }
    if (broadcast && this.coop?.isHost) this.coop.send(e);
    switch (e.t) {
      case 'start':
        if ((this.phase === 'title' || this.phase === 'end') && this.curtainT < 0) this.doStart();
        break;
      case 'summon':
        if (this.phase === 'level' && this.level && !this.level.busy && !this.level.solved) {
          this.doSummon(e.pose, this.wallPoint.set(e.x, e.y, STAGE.z), e.duet, e.pose2 ?? null);
        }
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        if (this.paused) this.resume();
        break;
      case 'restart':
        this.doRestart();
        break;
      case 'mode':
        if (e.mode === 'duel') this.enterDuel();
        else this.runCurtain(() => this.enterTitle());
        break;
      case 'recenter':
        break;
      case 'level':
        // Safety net: keep the guest on the host's chapter.
        if (this.phase !== 'level' || this.levelIndex !== e.i) this.enterLevel(e.i);
        break;
    }
  }

  startCoop(role: CoopRole, code: string): Coop {
    this.coop?.leave();
    this.partnerCasters.root.position.x = role === 'host' ? PARTNER_OFFSET : -PARTNER_OFFSET;
    const coop = new Coop(role, code, this.partnerLeft, this.partnerRight);
    // The partner appears as a glowing puppeteer in their player colour.
    this.partnerGlow?.root.removeFromParent();
    const partnerIsHost = role === 'guest';
    this.partnerGlow = new GlowHands(partnerIsHost ? PLAYER_COLORS.host : PLAYER_COLORS.guest, partnerIsHost ? 'Player 1' : 'Player 2');
    this.partnerGlow.root.position.x = this.partnerCasters.root.position.x;
    this.room.root.add(this.partnerGlow.root);
    // Host: the guest asked for something, so decide and broadcast. Guest: the host decided.
    coop.onEvent = (e) => this.apply(e, coop.isHost);
    coop.onStatus = (text) => this.setWallStatus(`co-op · room ${code} · ${text}`);
    this.coop = coop;
    this.setWallStatus(`co-op · room ${code} · waiting for your partner…`);
    return coop;
  }

  /** Small line of text under the stage for co-op status. */
  setWallStatus(text: string): void {
    if (this.statusText) {
      this.statusText.mesh.removeFromParent();
      (this.statusText.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    const m = makeText([text], 0.09, { size: 48, italic: true });
    m.position.set(0, STAGE.groundY - 0.3, STAGE.z);
    this.wall.add(m);
    this.statusText = new Fader(m, 2).show();
    this.onStatus?.(text);
  }

  /** The creature we're confidently holding right now, if any. */
  private localCharging(): PoseId | null {
    let best: PoseId | null = null;
    for (const p of POSES) {
      const c = this.poses.confidence[p];
      if (c > POSE_THRESHOLD && (!best || c > this.poses.confidence[best])) best = p;
    }
    return best;
  }

  private doStart(): void {
    sfx.setChime(0);
    sfx.success();
    this.flash.fire(this.wallPoint);
    this.particles.burst(this.wallPoint, 60);
    this.ring.set(0);
    for (const t of [...this.titleTexts, ...this.endTexts]) t.show(false);
    this.mainMenu.setVisible(false);
    this.runCurtain(() => this.startRun());
  }

  private doRestart(): void {
    if (this.paused) this.resume();
    this.hint.show(null);
    this.levelTitles.forEach((t) => t.show(false));
    this.levelSubtitles.forEach((t) => t.show(false));
    const i = this.levelIndex;
    this.runCurtain(() => this.enterLevel(i));
  }

  private startRun(): void {
    this.finale.hide();
    this.gallery.hide();
    this.duel.stop();
    this.phase = 'level';
    this.fragments.reset();
    this.fragments.setVisible(true);
    this.runTime = 0;
    this.hintsUsed = 0;
    this.wrongCreatures = 0;
    this.duets = 0;
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
    this.levelSubtitles[i].show();
    this.levelTitleTimer = 5;
    this.chapterTime = 0;
    this.chapterHinted = false;
    if (this.coop?.isHost) this.coop.send({ t: 'level', i });
  }

  // -------------------------------------------------------------------------
  // Pause: both palms up for 1 s → pinch Resume / Restart.

  pause(): void {
    if (this.phase !== 'level' || this.paused) return;
    this.paused = true;
    this.menu.setVisible(true);
    this.ring.set(0);
    sfx.setChime(0);
    sfx.click();
  }

  private resume(): void {
    this.paused = false;
    this.menu.setVisible(false);
    this.gestures.palmsUp.reset();
    this.poses.reset();
    sfx.click();
  }

  private updatePaused(_dt: number): void {
    const pts = this.menuPinchPoints;
    const started = this.menuPinchStarted;
    pts.length = 0;
    started.length = 0;
    for (const [pinch, hand] of [
      [this.gestures.pinchL, this.poses.left],
      [this.gestures.pinchR, this.poses.right],
    ] as const) {
      if (!hand.tracked) continue;
      pts.push(pinch.point);
      started.push(pinch.started);
    }
    let choice = this.menu.update(this.lastDt, pts, started);
    // Desktop-only stand-ins for the pinch buttons.
    if (this.debugKey('KeyP')) choice = 'resume';
    if (this.debugKey('KeyR')) choice = 'restart';
    if (this.debugKey('Escape')) choice = 'leave';
    if (choice === 'recenter') {
      // Local only: each player recentres their own room.
      this.onRecenter?.();
      sfx.click();
      this.request({ t: 'resume' });
    } else if (choice === 'leave') this.request({ t: 'mode', mode: 'menu' });
    else if (choice) this.request({ t: choice });
  }

  private updateLevel(dt: number, pose: PoseResult, ready: boolean, pauseFired: boolean): void {
    const level = this.level!;
    this.runTime += dt;
    if (!level.solved) this.chapterTime += dt;

    if (pauseFired || this.debugKey('KeyP')) {
      this.request({ t: 'pause' });
      return;
    }
    // Show the palms-up ring only once the gesture is clearly building.
    const pp = this.gestures.palmsUp.progress;
    if (pp > 0.15 && pp > pose.progress) {
      projectToWall(this.gestures.palmsUpAnchor, this.room.lightPos, this.wallPoint);
      this.ring.set(pp, this.wallPoint);
      sfx.setChime(pp);
      return;
    }

    if (this.levelTitleTimer > 0) {
      this.levelTitleTimer -= dt;
      if (this.levelTitleTimer <= 0) {
        this.levelTitles[this.levelIndex].show(false);
        this.levelSubtitles[this.levelIndex].show(false);
      }
    }

    // Desktop-only: number keys force a creature so the full flow is testable.
    let summoned: PoseId | null = pose.triggered;
    if (ready) {
      if (this.debugKey('Digit1')) summoned = 'dog';
      if (this.debugKey('Digit2')) summoned = 'bird';
      if (this.debugKey('Digit3')) summoned = 'rabbit';
      if (this.debugKey('Digit4')) summoned = 'snake';
    }

    // A guest only summons through the host; its own hold timer just drives the ring.
    if (this.isGuest && pose.triggered) summoned = null;

    projectToWall(pose.anchor, this.room.lightPos, this.wallPoint);
    let ringProgress = ready ? pose.progress : 0;
    if (ready && this.duetMode) {
      // Duet: show the shared progress, and a faint ring while waiting for the partner.
      const holding = this.localCharging() !== null;
      const shared = this.isGuest ? this.coop!.partnerProgress : pose.progress;
      ringProgress = holding ? Math.max(0.08, shared) : 0;
    }
    this.ring.set(ringProgress, this.wallPoint);
    sfx.setChime(ringProgress);

    if (summoned && ready) {
      // Debug summons have no hand shadow: spawn mid-stage.
      if (!pose.triggered) this.wallPoint.set(-0.35, STAGE.groundY + 0.4, STAGE.z);
      // Both players made the same creature together: a giant duet creature.
      const duet = this.duetMode && this.coop!.partnerCharging === summoned;
      const pose2 = this.duetMode ? this.coop!.partnerCharging : null;
      this.request({ t: 'summon', pose: summoned, pose2, x: this.wallPoint.x, y: this.wallPoint.y, duet });
      return; // the cutscene owns this frame
    }

    if (ready) {
      this.levelClock += dt;
      if (this.levelClock >= level.hintDelay && !this.hintShown) {
        this.hintShown = true;
        this.hintsUsed++;
        this.chapterHinted = true;
        this.hintCycle = 0;
        this.hintIndex = 0;
        this.hint.show(level.solutions[0], level.hintX);
      }
      // Each chapter has more than one answer: alternate between them.
      if (this.hintShown) {
        this.hintCycle += dt;
        if (this.hintCycle > HINT_CYCLE) {
          this.hintCycle = 0;
          this.hintIndex = (this.hintIndex + 1) % level.solutions.length;
          this.hint.show(level.solutions[this.hintIndex], level.hintX);
        }
      }
    }

    if (level.solved && this.solvedTimer < 0) {
      this.solvedTimer = 0;
      this.hint.show(null);
      sfx.levelComplete();
      this.progress.recordChapter(level.numeral, Progress.starsFor(this.chapterTime, this.chapterHinted ? 1 : 0));
      if (level instanceof ThiefLevel && level.outcome === 'rabbit') this.progress.award('kind_heart');
      this.fragments.collect(this.levelIndex, this.wallPoint.set(0, STAGE.groundY + 0.5, STAGE.z));
      this.particles.burst(this.wallPoint, 50, 0.4);
    }
    if (this.solvedTimer >= 0 && this.curtainT < 0) {
      this.solvedTimer += dt;
      if (this.solvedTimer > SOLVED_LINGER + 0.6) {
        const next = this.levelIndex + 1;
        this.runCurtain(() => (next < this.levels.length ? this.enterLevel(next) : this.enterEnd()));
      }
    }
  }

  private doSummon(pose: PoseId, spawn: Vector3, duet: boolean, pose2: PoseId | null = null): void {
    sfx.setChime(0);
    sfx.success();
    if (duet) {
      sfx.charm();
      this.duets++;
      this.progress.award('duet');
    }
    this.progress.unlock(pose);
    if (pose2) this.progress.unlock(pose2);
    this.flash.fire(spawn);
    // The signature moment: the shadow bursts into living sparks.
    this.particles.burst(spawn, duet ? 150 : 80, duet ? 0.8 : 0.5);
    this.ring.set(0);
    this.hint.show(null);
    this.hintShown = false;
    this.poses.reset();
    if (!this.level!.summon(pose, spawn, duet, pose2)) {
      this.wrongCreatures++;
      this.levelClock = this.level!.hintDelay; // show a right shape once it has faded
    }
  }

  private enterEnd(): void {
    this.level?.exit();
    this.level = undefined;
    this.phase = 'end';
    const thiefIsFriend = this.levels.find((l) => l instanceof ThiefLevel)?.outcome === 'rabbit';
    this.progress.recordRun(this.runTime);
    this.mainMenu.setVisible(true);
    this.finale.show(thiefIsFriend);
    const story = this.levels.map((l) => l.storyLine());
    sfx.fanfare();
    const secs = Math.round(this.runTime);
    const score = Math.max(100, 3000 - secs * 5 - this.hintsUsed * 150 - this.wrongCreatures * 50) + this.duets * DUET_BONUS;
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    for (const f of this.endTexts) {
      f.mesh.removeFromParent();
      (f.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    const end = makeText(['The light returns'], 0.26, { size: 110, weight: '700', letterSpacing: 6 });
    end.position.set(0, STAGE.titleY + 0.14, STAGE.z);
    const thanks = makeText(['The End — thanks for playing'], 0.13, { size: 64, italic: true });
    thanks.position.set(0, STAGE.titleY - 0.05, STAGE.z);
    // The plot the player's shadows wrote, one line per chapter.
    const tale = makeText(story, 0.4, { size: 50, italic: true, color: '#ffe9c4' });
    tale.position.set(0, STAGE.titleY - 0.33, STAGE.z);
    const duetNote = this.duets ? `  ·  ${this.duets} duet${this.duets > 1 ? 's' : ''}` : '';
    const stats = makeText([`time ${time}  ·  score ${score}${duetNote}`], 0.15, { size: 60 });
    stats.position.set(0, STAGE.titleY - 0.63, STAGE.z);
    const again = makeText(['open palm to play again · or pinch a button'], 0.12, { size: 52 });
    again.position.set(0, STAGE.groundY - 0.08, STAGE.z);
    const meshes: Mesh[] = [end, thanks, tale, stats, again];
    this.wall.add(...meshes);
    this.endTexts = meshes.map((m, i) => new Fader(m, 1.2 - i * 0.15).show());
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
    if (this.phase === 'duel') return `duel round ${this.duel.round + 1} ${this.duel.open ? 'open' : ''}${this.duel.done ? ' DONE' : ''} score ${this.duel.score.host}-${this.duel.score.guest}`;
    if (this.phase !== 'level' || !this.level) return this.phase;
    const l = this.level;
    return `${this.paused ? 'PAUSED  ' : ''}level ${l.numeral} "${l.title}"${l.busy ? ' (cutscene)' : ''}${l.solved ? ' SOLVED' : ''}  clock ${this.levelClock.toFixed(1)}s`;
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
    if (!game.onRecenter) game.onRecenter = () => (this.anchoredSession = undefined);
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

/** The 2D landing page: solo, or host/join an online co-op room. */
function setupLobby(world: World, g: Game): void {
  if (!world.xrEnabled) return;
  const lobby = new Lobby({
    onCoop: (role, code) => g.startCoop(role, code),
    onEnter: () => {
      sfx.unlock();
      world.launchXR();
    },
  });
  g.onStatus = (text) => lobby.setStatus(text);
  lobby.setVisible(true);
  world.visibilityState.subscribe((state) => {
    lobby.setVisible(state === VisibilityState.NonImmersive);
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
  // Dev-only handle for automated perf and flow tests (stripped from production builds).
  if (import.meta.env.DEV) (window as unknown as { __shadowPlay: unknown }).__shadowPlay = { game, world };
  world.createTransformEntity(game.room.root, { persistent: true });
  world.registerSystem(ShadowPlaySystem);
  setupLobby(world, game);
  // Opening the Quest system menu pauses the game.
  world.visibilityState.subscribe((state) => {
    if (state === VisibilityState.VisibleBlurred) game?.pause();
  });
});
