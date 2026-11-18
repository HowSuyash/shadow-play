import { BackSide, Color, createSystem, Group, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { sfx } from './audio/sfx.js';
import { Battle, BATTLES, type BattleInput } from './battle/battle.js';
import { PassageLevel, ShadowEaterLevel } from './game/finalLevels.js';
import { ChasmLevel, Finale, ThiefLevel, WallLevel, type Level } from './game/levels.js';
import { ACHIEVEMENTS, Progress } from './game/progress.js';
import { Duel, type DuelEvent } from './modes/duel.js';
import { Memory } from './modes/memory.js';
import { Gestures } from './hands/gestures.js';
import { HandData, HandTracker } from './hands/handData.js';
import { POSE_THRESHOLD, POSES, PoseDetector, type PoseId, type PoseResult } from './hands/poseDetector.js';
import { HandShadowCasters } from './hands/shadows.js';
import { Coop, type CoopEvent, type CoopRole } from './net/coop.js';
import { GlowHands, PLAYER_COLORS } from './effects/glowHands.js';
import { Particles } from './effects/particles.js';
import { STAGE } from './scene/layout.js';
import { Room } from './scene/room.js';
import { Worlds, type WorldId } from './scene/worlds.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { Atlas } from './ui/atlas.js';
import { Gallery } from './ui/gallery.js';
import { Lobby } from './ui/lobby.js';
import { Fader, Flash, FragmentBar, Hint, HoldRing, MainMenu, makeText, PauseMenu, PinchMenu, projectToWall } from './ui/wallUI.js';

type Phase = 'title' | 'story' | 'map' | 'level' | 'battle' | 'end' | 'gallery' | 'duel' | 'memory' | 'credits';

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
/** Hold time for a shadow → weapon in battle (faster than the story's 1 s). */
const BATTLE_HOLD = 0.6;

/** The prologue: how the player discovers the power of shadows. */
const PROLOGUE: string[][] = [
  ['Long ago, the puppeteers of this temple', 'could make their shadows come alive.'],
  ['Then the Shadow Eater swallowed the light,', 'and its monsters crept out of the dark.'],
  ['Tonight one candle still burns.', 'Raise your hands. Your shadows remember.'],
  ['Every shadow you make can leave the wall', 'and become a weapon in your hands.'],
];
const PROLOGUE_CARD = 4.6;

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
  readonly nearField = new Group();
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
  readonly memory: Memory;
  readonly memoryMenu = new PinchMenu<'again' | 'menu'>('Shadow Memory', [
    { id: 'again', label: 'Again' },
    { id: 'menu', label: 'Menu' },
  ]);
  private memoryRecorded = false;
  readonly settingsMenu = new PinchMenu<'sound' | 'effects' | 'back'>('Settings', [
    { id: 'sound', label: 'Sound' },
    { id: 'effects', label: 'Effects' },
    { id: 'back', label: 'Back' },
  ]);
  private settingsOpen = false;
  private soundLevel = 0;
  private effectsLevel = 0;
  private creditTexts: Mesh[] = [];
  readonly progress = new Progress();
  readonly particles = new Particles();
  /** The five 3D worlds surrounding the player. */
  readonly worlds: Worlds;
  /** Your own hands glow softly gold in VR (the partner's glow in their colour). */
  private readonly myGlow = new GlowHands(0xffc46a, '');
  /** Head-locked black sphere for comfortable fade-to-world transitions. */
  private readonly fade = new Mesh(
    new SphereGeometry(0.25, 16, 12),
    new MeshBasicMaterial({ color: 0x000000, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
  );
  private readonly handPoints: Vector3[] = [];
  private partnerGlow: GlowHands | undefined;
  readonly duel: Duel;
  private duelRecorded = false;
  /** Set by the system: re-anchor the room to the player's head next frame. */
  onRecenter: (() => void) | undefined;
  private toast: Fader | undefined;
  /** HUD: the chapter's current goal, re-rendered only when it changes. */
  private objectiveText: Fader | undefined;
  private objectiveShown = '';
  /** HUD: name of the creature being held, floating above the ring. */
  private readonly creatureLabels = {} as Record<PoseId, Fader>;
  /** Shown when the player is holding controllers instead of using hands. */
  private handsNotice: Fader | undefined;
  private noHandsTime = 0;
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
  /** Monster battles between chapters (solo). */
  readonly battle = new Battle();
  /** The Shadow Atlas map shown between chapters. */
  readonly atlas = new Atlas();
  private battleIndex = 0;
  private battleScore = 0;
  private battleKills = 0;
  private mapNext = 0;
  private mapT = 0;
  private storyIndex = 0;
  private storyT = 0;
  private storyTexts: Fader[] = [];
  /** Dev/test only: drive battle weapons from (injected) tracked hands without an XR session. */
  handTest = false;
  /** Desktop battle: the mouse is your sword hand. */
  readonly mouse = { x: 0, y: -0.2, down: false, clicked: false, shift: false, space: false, shiftAt: -1e9 };
  private savedCam: { p: Vector3; q: Quaternion } | undefined;
  private readonly battleInput: BattleInput = {
    head: new Vector3(),
    headDir: new Vector3(),
    pose: undefined as unknown as BattleInput['pose'],
    poses: undefined as unknown as BattleInput['poses'],
    equip: null,
    aim: null,
  };
  private readonly aimDir = new Vector3();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly v4 = new Vector3();
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
    // Near-field pinch menus only make sense with tracked hands, i.e. inside VR.
    this.nearField.add(this.menu.root, this.mainMenu.root, this.backMenu.root, this.duelMenu.root);
    this.room.root.add(this.casters.root, this.partnerCasters.root, this.wall, this.nearField);
    this.duel = new Duel(this.hint, 'host', false, (e) => this.coop?.send(e));
    this.worlds = new Worlds(world.renderer);
    this.room.wallMaterial.envMapIntensity = 0; // keep hand shadows deep
    this.room.root.add(this.particles.points, this.worlds.root, this.myGlow.root, this.battle.root);
    world.camera.add(this.battle.hud);
    this.battleInput.poses = this.poses;
    this.fade.renderOrder = 1000;
    this.fade.frustumCulled = false;
    this.fade.visible = false;
    world.camera.add(this.fade);
    this.applyWorld('theatre');
    this.memory = new Memory(this.hint);
    for (const p of POSES) {
      const m = makeText([p.toUpperCase()], 0.17, { size: 72, letterSpacing: 8, color: '#fff1d6' });
      this.wall.add(m);
      this.creatureLabels[p] = new Fader(m, 6);
    }
    this.nearField.add(this.memoryMenu.root, this.settingsMenu.root);
    this.loadSettings();
    this.wall.add(this.gallery.root, this.duel.root, this.memory.root);
    this.wall.add(this.ring.mesh, this.flash.mesh, this.hint.root);

    const title = makeText(['SHADOW PLAY'], 0.34, { size: 120, letterSpacing: 18, weight: '700' });
    title.position.set(0, STAGE.titleY, STAGE.z);
    const sub = makeText(['Your Hands. Your Shadows. Your World.'], 0.18, { size: 64, italic: true });
    sub.position.set(0, STAGE.titleY - 0.27, STAGE.z);
    const how = makeText(['raise your hands to the light'], 0.13, { size: 56, italic: true });
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
    this.wall.add(this.finale.root, this.fragments.root, this.atlas.root);
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
    this.nearField.visible = !!this.world.session;
    this.hands.update(this.world, this.room.root);
    this.casters.update([this.hands.left, this.hands.right]);
    this.poses.updateFeatures();

    const inLevel = this.phase === 'level' && this.level !== undefined;
    const levelReady = inLevel && !this.paused && !this.level!.busy && !this.level!.solved && this.curtainT < 0;
    // Pause (palms up) works wherever you're playing: story, duel or memory.
    const inBattle = this.phase === 'battle' && this.battle.active;
    const playing = inLevel || inBattle || this.phase === 'duel' || this.phase === 'memory';
    const canPause = playing && !this.paused && this.curtainT < 0;
    const openPalmPhase = this.phase === 'title' || this.phase === 'end' || this.phase === 'gallery' || this.phase === 'story' || this.phase === 'map';
    const g = this.gestures.update(dt, openPalmPhase && this.curtainT < 0, canPause);
    // Co-op "shadow duet": the host's summon only charges while the partner holds a shape too.
    // (If the partner isn't tracking hands yet, e.g. still on the 2D page, play on solo.)
    const partnerInVR = this.partnerLeft.tracked || this.partnerRight.tracked;
    const partnerHolding = !this.duetMode || !partnerInVR || this.coop!.partnerCharging !== null;
    const duelOpen = this.phase === 'duel' && !this.paused && this.duel.open && this.curtainT < 0;
    const memoryOpen = this.phase === 'memory' && !this.paused && this.memory.listening && this.curtainT < 0;
    const battleReady = inBattle && !this.paused && this.curtainT < 0 && this.battle.state !== 'won' && this.battle.state !== 'down';
    const pose = this.poses.update(dt, (levelReady && (this.isGuest || partnerHolding)) || duelOpen || memoryOpen || battleReady);

    if (this.coop) {
      this.coop.update(dt, this.hands.left, this.hands.right, this.localCharging(), pose.progress);
      this.partnerCasters.update([this.partnerLeft, this.partnerRight]);
    }

    this.collectPinches();
    if (this.paused && playing) this.updatePaused(dt);
    else if (this.phase === 'title' || this.phase === 'end') this.updateMenuScreen(g.start);
    else if (this.phase === 'gallery' || this.phase === 'credits') this.updateGallery(g.start);
    else if (this.phase === 'story') this.updateStory(dt, g.start);
    else if (this.phase === 'map') this.updateMap(dt, g.start);
    else if (inBattle) this.updateBattle(dt, time, pose, g.pause);
    else if ((this.phase === 'duel' || this.phase === 'memory') && (g.pause || this.debugKey('KeyP'))) this.request({ t: 'pause' });
    else if (this.phase === 'duel') this.updateDuel(pose);
    else if (this.phase === 'memory') this.updateMemory(pose);
    else if (inLevel) this.updateLevel(dt, pose, levelReady, g.pause);

    // The shadow world freezes while paused.
    if (!this.paused) this.level?.update(dt, time);
    this.finale.update(dt, time);
    // Menus not being driven this frame still animate open/closed.
    if (!this.paused) this.menu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'title' && this.phase !== 'end') this.mainMenu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'gallery') this.backMenu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'duel') this.duelMenu.update(dt, Game.NONE, Game.NONE);
    if (this.phase !== 'memory') this.memoryMenu.update(dt, Game.NONE, Game.NONE);
    if (!this.settingsOpen) this.settingsMenu.update(dt, Game.NONE, Game.NONE);
    if (!this.paused) {
      this.memory.update(dt, time);
      this.duel.update(dt, time);
    }
    this.gallery.update(dt, time);
    // Sparks gather into the ring while a shape is held.
    const rp = this.ring.progress;
    if (rp > 0.03 && Math.random() < 0.3 + rp) this.particles.gather(this.ring.target, 0.32, 1);
    this.particles.update(dt);
    this.handPoints.length = 0;
    if (this.poses.left.tracked) this.handPoints.push(this.poses.left.palmCenter);
    if (this.poses.right.tracked) this.handPoints.push(this.poses.right.palmCenter);
    this.worlds.update(dt, time, this.handPoints);
    this.myGlow.update([this.hands.left, this.hands.right], time);
    this.partnerGlow?.update([this.partnerLeft, this.partnerRight], time);
    this.updateToast(dt);
    this.updateHandsNotice(dt);
    this.updateHud(dt, pose);
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
    for (const t of this.storyTexts) t.update(dt);
    this.atlas.update(dt, time);

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
    if (this.settingsOpen) {
      this.updateSettings();
      return;
    }
    let choice = this.mainMenu.update(this.lastDt, this.menuPinchPoints, this.menuPinchStarted);
    if (startFired || this.debugKey('Enter')) choice = 'story';
    // Desktop-only shortcuts.
    if (this.debugKey('KeyG')) choice = 'gallery';
    if (this.debugKey('KeyV')) choice = 'duel';
    if (this.debugKey('KeyM')) choice = 'memory';
    if (this.debugKey('KeyC')) choice = 'credits';
    if (choice === 'story') this.request({ t: 'start' });
    else if (choice === 'duel') this.request({ t: 'mode', mode: 'duel' });
    else if (choice === 'memory') this.enterMemory();
    else if (choice === 'gallery') this.enterGallery();
    else if (choice === 'credits') this.enterCredits();
    else if (choice === 'settings') {
      sfx.click();
      this.settingsOpen = true;
      this.mainMenu.setVisible(false);
      this.settingsMenu.setVisible(true);
    }
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
    this.exitBattle();
    this.battle.stop(true);
    this.atlas.hideNow();
    this.clearStory();
    this.level?.exit();
    this.level = undefined;
    this.finale.hide();
    this.gallery.hide();
    this.duel.stop();
    this.memory.stop();
    this.clearCredits();
    this.settingsOpen = false;
    this.settingsMenu.setVisible(false);
    this.duelMenu.setVisible(false);
    this.memoryMenu.setVisible(false);
    this.backMenu.setVisible(false);
    this.fragments.setVisible(false);
    this.hint.show(null);
    this.ring.set(0);
    for (const t of [...this.levelTitles, ...this.levelSubtitles, ...this.endTexts]) t.show(false);
    for (const t of this.titleTexts) t.show();
    this.mainMenu.setVisible(true);
    this.applyWorld('theatre');
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

  /**
   * Hands-only game: if the session has controllers but no tracked hands for
   * a couple of seconds, ask the player to put them down. (Quest switches to
   * hand tracking automatically when controllers are set aside.)
   */
  private updateHandsNotice(dt: number): void {
    const session = this.world.session;
    let controllers = false;
    if (session) for (const src of session.inputSources) if (!src.hand && src.gamepad) controllers = true;
    const handsVisible = this.hands.left.tracked || this.hands.right.tracked;
    this.noHandsTime = session && !handsVisible ? this.noHandsTime + dt : 0;
    const show = this.noHandsTime > 2;
    if (show && !this.handsNotice) {
      const m = makeText(
        controllers
          ? ['Put your controllers down', 'Shadow Play is played with your bare hands']
          : ['Raise your hands in front of you', 'Shadow Play needs hand tracking'],
        0.27,
        { size: 60, color: '#ffe2a8' },
      );
      m.position.set(0, STAGE.titleY - 0.45, STAGE.z + 0.01);
      this.wall.add(m);
      this.handsNotice = new Fader(m, 2);
    }
    if (this.handsNotice) {
      this.handsNotice.show(show);
      this.handsNotice.update(dt);
      if (!show && this.handsNotice.value === 0) {
        this.handsNotice.mesh.removeFromParent();
        (this.handsNotice.mesh.material as MeshBasicMaterial).map?.dispose();
        this.handsNotice = undefined;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Settings (sound, effects) and Credits

  private static readonly SOUND = [
    ['Sound: High', 1],
    ['Sound: Low', 0.4],
    ['Sound: Off', 0],
  ] as const;
  private static readonly EFFECTS = [
    ['Effects: Full', 1],
    ['Effects: Low', 0.35],
    ['Effects: Off', 0],
  ] as const;

  private loadSettings(): void {
    try {
      const raw = JSON.parse(localStorage.getItem('shadow-play-settings-v1') ?? '{}') as { sound?: number; effects?: number };
      this.soundLevel = raw.sound ?? 0;
      this.effectsLevel = raw.effects ?? 0;
    } catch {
      /* defaults */
    }
    this.applySettings();
  }

  private applySettings(): void {
    const [sLabel, s] = Game.SOUND[this.soundLevel % 3];
    const [eLabel, e] = Game.EFFECTS[this.effectsLevel % 3];
    sfx.setVolume(s);
    this.particles.level = e;
    this.settingsMenu.setLabel('sound', sLabel);
    this.settingsMenu.setLabel('effects', eLabel);
    try {
      localStorage.setItem('shadow-play-settings-v1', JSON.stringify({ sound: this.soundLevel, effects: this.effectsLevel }));
    } catch {
      /* storage unavailable */
    }
  }

  private updateSettings(): void {
    this.mainMenu.update(this.lastDt, Game.NONE, Game.NONE); // let it animate closed
    let choice = this.settingsMenu.update(this.lastDt, this.menuPinchPoints, this.menuPinchStarted);
    if (this.debugKey('Escape')) choice = 'back';
    if (choice === 'sound') this.soundLevel = (this.soundLevel + 1) % 3;
    if (choice === 'effects') this.effectsLevel = (this.effectsLevel + 1) % 3;
    if (choice === 'sound' || choice === 'effects') {
      this.applySettings();
      sfx.click();
      if (choice === 'effects') this.particles.burst(this.wallPoint.set(0, STAGE.groundY + 0.5, STAGE.z), 50);
    }
    if (choice === 'back') {
      sfx.click();
      this.settingsOpen = false;
      this.settingsMenu.setVisible(false);
      this.mainMenu.setVisible(true);
    }
  }

  private enterCredits(): void {
    sfx.click();
    this.runCurtain(() => {
      for (const t of [...this.titleTexts, ...this.endTexts]) t.hideNow();
      this.finale.hide();
      this.mainMenu.setVisible(false);
      const lines: [string[], number, number, Record<string, unknown>][] = [
        [['SHADOW PLAY'], 0.26, STAGE.titleY + 0.12, { size: 110, letterSpacing: 14, weight: '700' }],
        [['Your Hands. Your Shadows. Your World.'], 0.1, STAGE.titleY - 0.05, { size: 56, italic: true }],
        [
          [
            'Made by HowSuyash for the Meta VR Start Developer Competition',
            'Built with Meta Immersive Web SDK · Three.js · WebXR Hand Input · Trystero',
            'Every silhouette, texture and sound is generated in code',
            'Inspired by the old art of hand-shadow puppetry',
          ],
          0.32,
          STAGE.titleY - 0.38,
          { size: 50, color: '#ffe9c4' },
        ],
      ];
      this.creditTexts = lines.map(([l, h, y, style]) => {
        const m = makeText(l, h, style);
        m.position.set(0, y, STAGE.z + 0.004);
        this.wall.add(m);
        return m;
      });
      this.finale.show(true);
      this.backMenu.setVisible(true);
      this.phase = 'credits';
    });
  }

  private clearCredits(): void {
    for (const m of this.creditTexts) {
      m.removeFromParent();
      (m.material as MeshBasicMaterial).map?.dispose();
    }
    this.creditTexts = [];
  }

  /** Shadow Memory is played locally (each player has their own sequence). */
  private enterMemory(): void {
    sfx.click();
    this.runCurtain(() => {
      for (const t of [...this.titleTexts, ...this.endTexts]) t.hideNow();
      this.finale.hide();
      this.mainMenu.setVisible(false);
      this.memoryMenu.setVisible(false);
      this.fragments.setVisible(false);
      this.phase = 'memory';
      this.memoryRecorded = false;
      this.memory.start();
    });
  }

  private updateMemory(pose: PoseResult): void {
    const m = this.memory;
    projectToWall(pose.anchor, this.room.lightPos, this.wallPoint);
    this.ring.set(m.listening ? pose.progress : 0, this.wallPoint);
    sfx.setChime(m.listening ? pose.progress : 0);
    let hit = pose.triggered;
    // Desktop-only: number keys stand in for poses.
    if (this.debugKey('Digit1')) hit = 'dog';
    if (this.debugKey('Digit2')) hit = 'bird';
    if (this.debugKey('Digit3')) hit = 'rabbit';
    if (this.debugKey('Digit4')) hit = 'snake';
    if (hit && m.listening) {
      if (m.onPose(hit)) this.particles.burst(this.wallPoint, 40, 0.4);
      this.poses.reset();
    }
    if (m.phase === 'done') {
      if (!this.memoryRecorded) {
        this.memoryRecorded = true;
        this.progress.recordMemory(m.best);
        this.memoryMenu.setVisible(true);
      }
      let choice = this.memoryMenu.update(this.lastDt, this.menuPinchPoints, this.menuPinchStarted);
      if (this.debugKey('Enter')) choice = 'again';
      if (this.debugKey('Escape')) choice = 'menu';
      if (choice === 'again') this.enterMemory();
      else if (choice === 'menu') this.runCurtain(() => this.enterTitle());
    }
  }

  /** Enter one of the five 3D worlds (called while the screen is dark). */
  private applyWorld(id: WorldId): void {
    if (this.worlds.current === id) return;
    const look = this.worlds.set(id);
    this.room.setLook(look);
    this.world.scene.fog = look.fog;
    this.world.scene.environment = look.env ?? null;
    sfx.setWorld(id);
    // Portal flourish on the wall as the new world appears.
    this.particles.burst(this.wallPoint.set(0, STAGE.groundY + 0.6, STAGE.z), 90, 0.9);
  }

  /** Minimal HUD: the current objective, and the creature you're forming. */
  private updateHud(dt: number, pose: PoseResult): void {
    // Objective: shown in chapters once the title card has faded.
    const want = this.phase === 'level' && this.level && this.levelTitleTimer <= 0 && !this.level.solved ? this.level.objective : '';
    if (want !== this.objectiveShown) {
      this.objectiveShown = want;
      this.objectiveText?.show(false);
      if (want) {
        if (this.objectiveText) {
          this.objectiveText.mesh.removeFromParent();
          (this.objectiveText.mesh.material as MeshBasicMaterial).map?.dispose();
        }
        const m = makeText([want], 0.085, { size: 56, italic: true, color: '#ffe9c4' });
        m.position.set(0, STAGE.titleY + 0.3, STAGE.z + 0.003);
        this.wall.add(m);
        this.objectiveText = new Fader(m, 2).show();
      }
    }
    this.objectiveText?.update(dt);
    // Detected creature: its name floats above the filling ring.
    const holding = this.ring.progress > 0.12 ? pose.charging : null;
    for (const p of POSES) {
      const f = this.creatureLabels[p];
      f.show(p === holding);
      if (p === holding) f.mesh.position.set(this.ring.target.x, this.ring.target.y + 0.42, STAGE.z + 0.006);
      f.update(dt);
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
      m.position.set(0, STAGE.titleY + 0.56, STAGE.z + 0.004);
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
    // Restart whatever is being played.
    if (this.phase === 'duel') return this.enterDuel();
    if (this.phase === 'memory') return this.enterMemory();
    if (this.phase === 'battle') {
      this.battle.restartWave();
      return;
    }
    this.hint.show(null);
    this.levelTitles.forEach((t) => t.show(false));
    this.levelSubtitles.forEach((t) => t.show(false));
    const i = this.levelIndex;
    this.runCurtain(() => this.enterLevel(i));
  }

  private startRun(): void {
    this.mainMenu.setVisible(false);
    for (const t of [...this.titleTexts, ...this.endTexts]) t.hideNow();
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
    this.battleScore = 0;
    this.battleKills = 0;
    this.battle.stop(true);
    this.enterStory();
  }

  private enterLevel(i: number): void {
    this.level?.exit();
    this.levelIndex = i;
    this.level = this.levels[i];
    this.applyWorld(this.level.world);
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
    if ((this.phase !== 'level' && this.phase !== 'duel' && this.phase !== 'memory' && this.phase !== 'battle') || this.paused) return;
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
        // Solo: the chapter's monsters attack before you move on. (Co-op keeps the shadow story.)
        if (!this.coop && BATTLES[this.levelIndex]) this.runCurtain(() => this.enterBattle(this.levelIndex));
        else this.runCurtain(() => (next < this.levels.length ? this.showMap(next) : this.enterEnd()));
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
    this.worlds.react();
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
    this.applyWorld('sky');
    this.mainMenu.setVisible(true);
    this.finale.show(thiefIsFriend);
    const story = this.levels.map((l) => l.storyLine());
    sfx.fanfare();
    const secs = Math.round(this.runTime);
    const score = Math.max(100, 3000 - secs * 5 - this.hintsUsed * 150 - this.wrongCreatures * 50) + this.duets * DUET_BONUS + this.battleScore;
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
    const killNote = this.battleKills ? `  ·  ${this.battleKills} monsters defeated` : '';
    const stats = makeText([`time ${time}  ·  score ${score}${duetNote}${killNote}`], 0.15, { size: 60 });
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
    // Fade to black and back around every scene change (comfortable in VR).
    const fadeK = this.curtainT < CURTAIN ? this.curtainT / CURTAIN : Math.max(0, 1 - (this.curtainT - CURTAIN) / CURTAIN);
    (this.fade.material as MeshBasicMaterial).opacity = Math.min(1, fadeK * 1.25);
    this.fade.visible = fadeK > 0.01;
    if (this.curtainT < CURTAIN) this.room.setBrightness(0.25);
    else this.room.setBrightness(this.phase === 'end' ? 1.7 : 1);
    if (this.curtainT >= 2 * CURTAIN) this.curtainT = -1;
  }

  // -------------------------------------------------------------------------
  // Prologue → Shadow Atlas → chapter (puzzle) → battle → Atlas → …

  private enterStory(): void {
    this.phase = 'story';
    this.storyIndex = -1;
    this.storyT = PROLOGUE_CARD;
    this.clearStory();
  }

  private clearStory(): void {
    for (const f of this.storyTexts) {
      f.mesh.removeFromParent();
      (f.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    this.storyTexts = [];
  }

  private updateStory(dt: number, openPalm: boolean): void {
    if (this.curtainT >= 0) return;
    this.storyT += dt;
    const skip = this.menuPinchStarted.some((s) => s) || openPalm || this.debugKey('Enter') || this.debugKey('Space');
    if (this.storyT < PROLOGUE_CARD && !(skip && this.storyT > 0.6)) return;
    this.storyIndex++;
    this.storyT = 0;
    for (const f of this.storyTexts) f.show(false);
    if (this.storyIndex >= PROLOGUE.length) {
      this.runCurtain(() => {
        this.clearStory();
        this.showMap(0);
      });
      return;
    }
    const lines = PROLOGUE[this.storyIndex];
    const m = makeText(lines, 0.3, { size: 72, italic: true, color: '#fff1d6' });
    m.position.set(0, STAGE.titleY - 0.15, STAGE.z + 0.005);
    this.wall.add(m);
    this.storyTexts.push(new Fader(m, 1.6).show());
    // Old cards fade out, then go.
    if (this.storyTexts.length > 2) {
      const old = this.storyTexts.shift()!;
      old.mesh.removeFromParent();
      (old.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    this.particles.burst(this.wallPoint.set(0, STAGE.groundY + 0.35, STAGE.z), 30, 0.5);
    sfx.note(this.storyIndex + 2);
  }

  /** The Shadow Atlas: the candle token travels to the next land. */
  private showMap(next: number): void {
    this.phase = 'map';
    this.mapNext = next;
    this.mapT = 0;
    this.applyWorld(this.levels[next].world);
    this.atlas.show(Math.max(0, next - 1), next);
  }

  private updateMap(dt: number, openPalm: boolean): void {
    if (this.curtainT >= 0) return;
    this.mapT += dt;
    const skip = (this.menuPinchStarted.some((s) => s) || openPalm || this.debugKey('Enter') || this.debugKey('Space')) && this.mapT > 0.8;
    if (this.mapT > 4.6 || skip) {
      const i = this.mapNext;
      this.runCurtain(() => {
        this.atlas.hideNow();
        this.enterLevel(i);
      });
    }
  }

  /** The wall sinks away and the chapter's monsters pour out of rifts. */
  private enterBattle(i: number): void {
    this.level?.exit();
    this.level = undefined;
    this.hint.show(null);
    this.ring.set(0);
    for (const t of [...this.levelTitles, ...this.levelSubtitles]) t.hideNow();
    this.phase = 'battle';
    this.battleIndex = i;
    const def = BATTLES[i];
    this.applyWorld(def.world);
    this.room.wallMesh.visible = false;
    this.wall.visible = false;
    const giant = this.worlds.root.getObjectByName('shadow-eater-giant');
    if (giant) giant.visible = !def.boss;
    // Desktop: sit in the player's seat (the room camera normally frames the wall).
    if (!this.world.session) {
      const cam = this.world.camera;
      this.savedCam = { p: cam.position.clone(), q: cam.quaternion.clone() };
      cam.position.set(0, 1.2, 0.05);
      cam.rotation.set(0.04, 0, 0, 'YXZ');
    }
    this.poses.setHoldSeconds(BATTLE_HOLD);
    this.poses.reset();
    this.battle.desktop = !this.world.session && !this.handTest;
    this.battle.onAchievement = (id) => this.progress.award(id);
    this.battle.start(i);
  }

  private exitBattle(): void {
    if (!this.battle.active && this.wall.visible) return;
    this.battleKills += this.battle.kills;
    this.battleScore += this.battle.score;
    this.battle.stop();
    this.room.wallMesh.visible = true;
    this.wall.visible = true;
    const giant = this.worlds.root.getObjectByName('shadow-eater-giant');
    if (giant) giant.visible = true;
    if (this.savedCam && !this.world.session) {
      this.world.camera.position.copy(this.savedCam.p);
      this.world.camera.quaternion.copy(this.savedCam.q);
    }
    this.savedCam = undefined;
    this.poses.setHoldSeconds(1);
    this.poses.reset();
    sfx.setChime(0);
  }

  private updateBattle(dt: number, time: number, pose: PoseResult, pauseFired: boolean): void {
    this.runTime += dt;
    if (pauseFired || this.debugKey('KeyP')) {
      this.request({ t: 'pause' });
      return;
    }
    const input = this.battleInput;
    const cam = this.world.camera;
    // Head position and gaze, room space.
    cam.getWorldPosition(this.v1);
    this.room.root.worldToLocal(input.head.copy(this.v1));
    cam.getWorldDirection(input.headDir);
    input.pose = pose;
    input.equip = null;
    input.aim = null;
    const b = this.battle;
    if (this.world.session || this.handTest) {
      b.rigs.left.fromHand(this.poses.left, this.gestures.pinchL.down, this.gestures.pinchL.started, dt);
      b.rigs.right.fromHand(this.poses.right, this.gestures.pinchR.down, this.gestures.pinchR.started, dt);
    } else {
      this.desktopRigs(dt, input);
    }
    // Desktop: number keys put a weapon in the mouse hand (Shift: the left hand).
    if (!this.world.session && !this.handTest) {
      const shift = this.mouse.shift || performance.now() - this.mouse.shiftAt < 300;
      const keys: [string, PoseId][] = [
        ['Digit1', 'dog'],
        ['Digit2', 'bird'],
        ['Digit3', 'rabbit'],
        ['Digit4', 'snake'],
      ];
      for (const [code, p] of keys) if (this.debugKey(code)) input.equip = { pose: p, hand: shift ? 'left' : 'right' };
    }
    // Desktop/debug: N wins the current wave (testing only).
    if (this.debugKey('KeyN')) for (const m of b.monsters) for (const t of m.targets) if (t.alive) m.hit(t, 99, this.v1.set(0, 0, -1));
    b.update(dt, time, input);
    if (b.finished && this.curtainT < 0) {
      const i = this.battleIndex;
      this.progress.recordBattle(i, b.damageTaken);
      if (i === BATTLES.length - 1) this.progress.award('dragon');
      this.runCurtain(() => {
        this.exitBattle();
        const next = i + 1;
        if (next < this.levels.length) this.showMap(next);
        else this.enterEnd();
      });
    }
  }

  /**
   * Desktop battle hands: the right hand follows the mouse 55 cm out along
   * the cursor ray (its weapon points into the scene); the left hand holds a
   * guard low-left and raises it while Space is held.
   */
  private desktopRigs(dt: number, input: BattleInput): void {
    const cam = this.world.camera;
    const b = this.battle;
    const room = this.room.root;
    const d = this.desk;
    // Ray through the cursor.
    cam.getWorldPosition(this.v1);
    this.v2.set(this.mouse.x, this.mouse.y, 0.5).unproject(cam).sub(this.v1).normalize();
    this.aimDir.copy(this.v2);
    room.worldToLocal(this.v3.copy(this.v1).addScaledVector(this.v2, 0.55));
    d.up.set(0, 1, 0);
    d.right.crossVectors(this.v2, d.up).normalize();
    d.side.copy(d.up).multiplyScalar(0.35).addScaledVector(this.v2, 0.65).normalize();
    d.normal.copy(d.right).negate();
    b.rigs.right.fromFrame(this.v3, this.v2, d.side, d.normal, this.mouse.down, this.mouse.clicked, dt);
    this.mouse.clicked = false;
    input.aim = this.aimDir;
    // Left guard: low-left, raised in front of you while Space is held.
    if (this.mouse.space) d.local.set(-0.05, -0.07, -0.36);
    else d.local.set(-0.27, -0.25, -0.5);
    room.worldToLocal(cam.localToWorld(this.v4.copy(d.local)));
    cam.getWorldDirection(d.fwd);
    cam.getWorldQuaternion(d.q);
    d.camUp.set(0, 1, 0).applyQuaternion(d.q);
    b.rigs.left.fromFrame(this.v4, d.fwd, d.camUp, d.fwd, false, false, dt);
  }
  private readonly desk = {
    up: new Vector3(),
    right: new Vector3(),
    side: new Vector3(),
    normal: new Vector3(),
    local: new Vector3(),
    fwd: new Vector3(),
    camUp: new Vector3(),
    q: new Quaternion(),
  };

  private describe(): string {
    if (this.phase === 'memory') return `${this.paused ? 'PAUSED  ' : ''}memory ${this.memory.phase} ${this.memory.index}/${this.memory.seq.length} lives ${this.memory.lives} best ${this.memory.best} seq ${this.memory.seq.join(',')}`;
    if (this.phase === 'duel') return `${this.paused ? 'PAUSED  ' : ''}duel round ${this.duel.round + 1} ${this.duel.open ? 'open' : ''}${this.duel.done ? ' DONE' : ''} score ${this.duel.score.host}-${this.duel.score.guest}`;
    if (this.phase === 'battle') {
      const b = this.battle;
      return `${this.paused ? 'PAUSED  ' : ''}battle ${b.index + 1} ${b.state} wave ${b.wave + 1} hp ${b.hp.toFixed(1)} monsters ${b.monsters.length} kills ${b.kills} score ${b.score} L:${b.weapons.left?.id ?? '-'} R:${b.weapons.right?.id ?? '-'}`;
    }
    if (this.phase === 'map') return `map → chapter ${this.mapNext + 1}`;
    if (this.phase === 'story') return `story card ${this.storyIndex + 1}/${PROLOGUE.length}`;
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

/**
 * Desktop only: drag with the mouse (or a finger) to look around the 3D
 * world. In VR the headset drives the camera, so this does nothing there.
 */
function setupDesktopLook(world: World, g: Game): void {
  const el = document.getElementById('scene-container');
  if (!el) return;
  const cam = world.camera;
  let yaw = 0;
  let pitch = 0;
  let base: { x: number; y: number; z: number } | undefined;
  let dragging = false;
  let lx = 0;
  let ly = 0;
  const toMouse = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    g.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    g.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };
  el.addEventListener('pointerdown', (e) => {
    if (world.session) return;
    if (g.phase === 'battle') {
      toMouse(e);
      g.mouse.down = true;
      g.mouse.clicked = true;
      return;
    }
    if (!base) {
      cam.rotation.order = 'YXZ';
      base = { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z };
    }
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
  });
  const keys = (e: KeyboardEvent, down: boolean) => {
    g.mouse.shift = e.shiftKey;
    if (down && e.shiftKey) g.mouse.shiftAt = performance.now();
    if (e.code === 'Space') {
      g.mouse.space = down;
      if (g.phase === 'battle') e.preventDefault();
    }
  };
  window.addEventListener('keydown', (e) => keys(e, true));
  window.addEventListener('keyup', (e) => keys(e, false));
  window.addEventListener('pointerup', () => {
    dragging = false;
    g.mouse.down = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!world.session && g.phase === 'battle') {
      toMouse(e);
      return;
    }
    if (!dragging || world.session || !base) return;
    yaw -= (e.clientX - lx) * 0.005;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - (e.clientY - ly) * 0.005));
    lx = e.clientX;
    ly = e.clientY;
    cam.rotation.set(base.x + pitch, base.y + yaw, 0, 'YXZ');
  });
}

/** The 2D landing page: solo, or host/join an online co-op room. */
function setupLobby(world: World, g: Game): void {
  if (!world.xrEnabled) return;
  const keysHelp = document.getElementById('keys-help') as HTMLElement | null;
  /** Play on the flat screen (keyboard demo) — for computers without a headset. */
  const playOnScreen = () => {
    sfx.unlock();
    lobby.setVisible(false);
    const note = document.getElementById('boot-note');
    if (note) note.hidden = true;
    if (keysHelp) keysHelp.hidden = false;
    (document.activeElement as HTMLElement | null)?.blur();
  };
  let vrCheck: ReturnType<typeof setTimeout> | undefined;
  const lobby = new Lobby({
    onCoop: (role, code) => g.startCoop(role, code),
    onEnter: () => {
      sfx.unlock();
      if (!navigator.xr) {
        lobby.showScreenFallback(playOnScreen, 'This browser has no VR. Open the page in the Meta Quest Browser, or play on screen.');
        return;
      }
      world.launchXR();
      // launchXR only logs failures, so check that VR actually started.
      clearTimeout(vrCheck);
      vrCheck = setTimeout(() => {
        if (!world.session) {
          lobby.showScreenFallback(
            playOnScreen,
            "VR didn't start. On a Quest: put the controllers down, then tap Play again. On a computer: play on screen.",
          );
        }
      }, 3000);
    },
  });
  g.onStatus = (text) => {
    lobby.setStatus(text);
    if (g.coop) lobby.setPartner(g.coop.connected);
  };
  lobby.setVisible(true);
  // A computer without a headset: offer the keyboard demo instead of a dead button.
  void navigator.xr
    ?.isSessionSupported('immersive-vr')
    .then((vr) => {
      if (!vr) lobby.setDesktopMode(playOnScreen);
    })
    .catch(() => lobby.setDesktopMode(playOnScreen));
  if (!navigator.xr) lobby.setDesktopMode(playOnScreen);
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
  if (import.meta.env.DEV) (window as unknown as { __shadowPlay: unknown }).__shadowPlay = { game, world, sfx };
  world.createTransformEntity(game.room.root, { persistent: true });
  world.registerSystem(ShadowPlaySystem);
  setupLobby(world, game);
  setupDesktopLook(world, game);
  // Opening the Quest system menu pauses the game.
  world.visibilityState.subscribe((state) => {
    if (state === VisibilityState.VisibleBlurred) game?.pause();
  });
});
