import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Sprite,
} from '@iwsdk/core';
import { sfx } from '../audio/sfx.js';
import type { Silhouette } from '../game/creatures.js';
import { makeCreature } from '../game/levels.js';
import type { PoseDetector, PoseId, PoseResult } from '../hands/poseDetector.js';
import type { WorldId } from '../scene/worlds.js';
import { Fader, makeText, pictogramTexture, POSE_CAPTIONS } from '../ui/wallUI.js';
import { glowMat, halo, segmentDistance, Sparks } from './fx.js';
import { makeMonster, Rift, ShadowEater, type ArenaCtx, type Monster, type MonsterKind, type Target } from './monsters.js';
import { HandRig } from './rig.js';
import {
  Blade,
  FirebirdWeapon,
  flapWings,
  makeFirebird,
  makeWeapon,
  Shield,
  SHIELD_RADIUS,
  Whip,
  WEAPON_INFO,
  WEAPON_OF,
  WHIP_SEGMENTS,
  type Weapon,
} from './weapons.js';

// ---------------------------------------------------------------------------
// The five battles: one per chapter, each teaching a new shadow weapon.
// ---------------------------------------------------------------------------

export interface WaveDef {
  list: MonsterKind[];
  /** Most monsters on the field at once. */
  maxAlive: number;
}

export interface BattleDef {
  world: WorldId;
  title: string;
  /** Story beat shown as the battle opens. */
  story: string;
  /** The shadow this battle teaches. */
  feature: PoseId;
  waves: WaveDef[];
  boss?: boolean;
}

export const BATTLES: BattleDef[] = [
  {
    world: 'sky',
    title: 'Battle of the Sky Kingdom',
    story: 'Wraiths dive out of the clouds to put out your light!',
    feature: 'bird',
    waves: [
      { list: ['wraith', 'wraith', 'wraith'], maxAlive: 2 },
      { list: ['wraith', 'imp', 'wraith', 'imp', 'wraith'], maxAlive: 3 },
    ],
  },
  {
    world: 'theatre',
    title: 'Battle of the Shadow Theatre',
    story: 'Shadow imps crawl out of the temple floor!',
    feature: 'dog',
    waves: [
      { list: ['imp', 'imp', 'imp', 'imp'], maxAlive: 2 },
      { list: ['imp', 'imp', 'wraith', 'imp', 'imp', 'imp'], maxAlive: 3 },
    ],
  },
  {
    world: 'forest',
    title: 'Battle of the Forgotten Forest',
    story: 'Thorn wraiths hurl shadow orbs from the trees!',
    feature: 'rabbit',
    waves: [
      { list: ['wraith', 'wraith', 'wraith'], maxAlive: 3 },
      { list: ['imp', 'wraith', 'imp', 'wraith', 'imp', 'wraith'], maxAlive: 3 },
    ],
  },
  {
    world: 'castle',
    title: 'Battle of the Dark Castle',
    story: 'Iron Brutes guard the gate. Only a whip can crack their armour fast enough!',
    feature: 'snake',
    waves: [
      { list: ['brute', 'imp', 'imp', 'brute'], maxAlive: 2 },
      { list: ['brute', 'wraith', 'imp', 'brute', 'wraith', 'imp'], maxAlive: 3 },
    ],
  },
  {
    world: 'realm',
    title: 'The Shadow Eater',
    story: 'The Shadow Eater rises! Break its three glowing cores.',
    feature: 'bird',
    waves: [{ list: ['boss'], maxAlive: 4 }],
    boss: true,
  },
];

const MAX_HP = 5;
const ARMING_GRACE = 18;

type BattleState = 'intro' | 'arming' | 'howto' | 'fight' | 'between' | 'won' | 'down';

/** A shadow orb thrown by a monster. */
interface Orb {
  mesh: Mesh;
  /** Who threw it: a shield sends it straight back at them. */
  owner: Monster | null;
  reflected: boolean;
  pos: Vector3;
  vel: Vector3;
  radius: number;
  life: number;
  alive: boolean;
}

/** A thrown firebird. */
interface Shot {
  root: Group;
  wings: Mesh[];
  pos: Vector3;
  vel: Vector3;
  target: Target | null;
  life: number;
  alive: boolean;
}

export interface BattleInput {
  /** Player's head, room space. */
  head: Vector3;
  /** Where the player is looking, room space (unit). */
  headDir: Vector3;
  pose: PoseResult;
  poses: PoseDetector;
  /** Desktop: number key → equip right (or left with shift) hand. */
  equip: { pose: PoseId; hand: 'left' | 'right' } | null;
  /** Desktop: aim direction for the mouse hand's firebird. */
  aim: Vector3 | null;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const tmp3 = new Vector3();
const DOWN_FWD = new Vector3();

/**
 * One battle: rifts open, monsters pour out in waves, and the player fights
 * with the weapons their shadows became. Lives in room space next to the
 * player; the head-locked HUD hangs off the camera.
 */
export class Battle implements ArenaCtx {
  readonly root = new Group();
  /** Head-locked HUD: life flames and the damage flash (added to the camera). */
  readonly hud = new Group();
  readonly sparks = new Sparks();
  readonly rigs = { left: new HandRig('left'), right: new HandRig('right') };
  readonly weapons: { left: Weapon | null; right: Weapon | null } = { left: null, right: null };
  readonly monsters: Monster[] = [];
  private rifts: Rift[] = [];
  private orbs: Orb[] = [];
  private shots: Shot[] = [];
  readonly head = new Vector3(0, 1.2, 0);
  private readonly headDir = new Vector3(0, 0, -1);

  def: BattleDef | undefined;
  index = 0;
  state: BattleState = 'intro';
  private stateT = 0;
  wave = 0;
  private queue: MonsterKind[] = [];
  private spawnT = 0;
  hp = MAX_HP;
  /** Score and stats for the end screen. */
  kills = 0;
  score = 0;
  damageTaken = 0;
  falls = 0;
  /** True once the battle is won and its victory beat has played. */
  finished = false;
  private sinceHurt = 10;
  /** Played on a computer: banners explain the mouse and keys too. */
  desktop = false;
  /** Called when something achievement-worthy happens. */
  onAchievement: ((id: string) => void) | undefined;
  private slowmo = 0;
  private hurtFlash = 0;
  private bladeSwoosh = [0, 0];
  private whipCrack = [0, 0];

  // HUD
  private readonly flames: { mesh: Mesh; glow: Sprite }[] = [];
  private readonly vignette: Mesh;
  private banner: Fader | undefined;
  private bannerSub: Fader | undefined;
  private status: Fader | undefined;
  private statusText = '';
  private weaponLabel: Fader | undefined;
  private weaponLabelT = 0;
  private readonly pict: Mesh;
  private readonly pictFade: Fader;
  private readonly field = new Group();
  private boss: ShadowEater | undefined;
  /** Holding-a-shape ring around the hand. */
  private readonly charge: Mesh;
  private readonly chargeMat: MeshBasicMaterial;
  /** Shadow creatures condensing into weapons in your hands. */
  private condensing: { s: Silhouette; t: number; hand: 'left' | 'right' }[] = [];
  /** Weapon-forming silhouette ghost in the hand. */
  private readonly ghost: Mesh;

  constructor() {
    this.root.add(this.sparks.points, this.field);
    // Life flames: a row of five small candle flames low in your view.
    for (let i = 0; i < MAX_HP; i++) {
      const flame = new Mesh(new ConeGeometry(0.006, 0.02, 8), glowMat(0xffc46a));
      flame.position.set((i - (MAX_HP - 1) / 2) * 0.022, -0.17, -0.5);
      const glow = halo(0xff8a2a, 0.03, 0.9);
      glow.position.copy(flame.position);
      this.hud.add(flame, glow);
      this.flames.push({ mesh: flame, glow });
    }
    this.vignette = new Mesh(
      new SphereGeometry(0.3, 16, 12),
      new MeshBasicMaterial({ color: 0x8a0a3a, side: BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
    );
    this.vignette.renderOrder = 999;
    this.hud.add(this.vignette);
    this.hud.visible = false;
    // Hand-shape pictogram on a glowing parchment disc (readable on dark battlefields).
    const pictBack = new Mesh(new CircleGeometry(0.55, 40), new MeshBasicMaterial({ color: 0xf2dcb0, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this.pict = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false }));
    this.pict.add(pictBack);
    pictBack.position.z = -0.01;
    this.pict.position.set(-1.6, 1.75, -3.2);
    this.pict.rotation.y = 0.35;
    this.root.add(this.pict);
    this.pictFade = new Fader(this.pict, 3);
    this.chargeMat = new MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.charge = new Mesh(new CylinderGeometry(0.12, 0.12, 0.004, 40, 1, true), this.chargeMat);
    this.ghost = new Mesh(new SphereGeometry(0.06, 12, 8), new MeshBasicMaterial({ color: 0x050208, transparent: true, opacity: 0, depthWrite: false }));
    this.root.add(this.charge, this.ghost);
    this.root.visible = false;
  }

  get active(): boolean {
    return this.def !== undefined;
  }

  private warm: Group | undefined;
  /**
   * Compile every monster, weapon, rift and orb shader once, while the screen
   * is dark, so nothing hitches the first time it appears (summoning a
   * weapon is the big moment; it must be smooth).
   */
  prewarm(compile: (o: Object3D) => void): void {
    if (this.warm) return;
    const g = new Group();
    for (const k of ['imp', 'wraith', 'brute', 'boss'] as MonsterKind[]) g.add(makeMonster(k).root);
    for (const id of ['blade', 'firebird', 'shield', 'whip'] as const) {
      const w = makeWeapon(id, 'right');
      w.root.visible = true;
      g.add(w.root);
      if (w instanceof Blade) g.add(w.trail.mesh);
      if (w instanceof Whip) w.attach(g);
    }
    g.add(new Rift(new Vector3(), new Vector3(0, 0, 1)).root, makeFirebird().root, makeCreature('dog').root);
    const orb = new Mesh(new SphereGeometry(0.07, 12, 8), glowMat(0xe8d8ff));
    orb.add(halo(0x8c5cff, 0.4, 0.95));
    g.add(orb);
    g.position.set(0, -50, 0);
    this.root.add(g);
    compile(g);
    // Keep it (hidden) so the compiled programs stay cached.
    g.visible = false;
    this.warm = g;
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  start(index: number): void {
    this.stop(false);
    this.index = index;
    this.def = BATTLES[index];
    this.root.visible = true;
    this.hud.visible = true;
    this.hp = MAX_HP;
    this.kills = 0;
    this.score = 0;
    this.damageTaken = 0;
    this.falls = 0;
    this.finished = false;
    this.wave = 0;
    this.buildField(this.def.world);
    this.setBanner(this.def.title.toUpperCase(), this.def.story);
    this.setState('intro');
    sfx.setBattle(this.def.boss ? 2 : 1);
    sfx.horn();
    // A weapon you already hold comes with you into the next battle.
  }

  /** End the battle. Learned weapons stay in your hands for the next one unless `dropWeapons`. */
  stop(dropWeapons = false): void {
    for (const m of this.monsters) m.dispose();
    this.monsters.length = 0;
    for (const r of this.rifts) r.root.removeFromParent();
    this.rifts = [];
    for (const o of this.orbs) this.killOrb(o);
    this.orbs = [];
    for (const s of this.shots) s.root.removeFromParent();
    this.shots = [];
    if (dropWeapons) {
      this.dropWeapon('left');
      this.dropWeapon('right');
    }
    this.sparks.clear();
    this.clearField();
    this.banner?.show(false);
    this.bannerSub?.show(false);
    this.status?.show(false);
    this.pictFade.show(false);
    this.boss = undefined;
    this.def = undefined;
    this.root.visible = false;
    this.hud.visible = false;
    this.chargeMat.opacity = 0;
    sfx.setBattle(0);
  }

  /** Pause menu → Restart: replay the current wave from full health. */
  restartWave(): void {
    if (!this.def) return;
    this.clearWave();
    this.hp = MAX_HP;
    this.beginWave(this.wave);
  }

  private setState(s: BattleState): void {
    this.state = s;
    this.stateT = 0;
  }

  // -------------------------------------------------------------------------
  // Per frame

  update(dtReal: number, t: number, input: BattleInput): void {
    if (!this.def) return;
    // A beat of slow motion on big hits sells the impact.
    this.slowmo = Math.max(0, this.slowmo - dtReal);
    const dt = this.slowmo > 0 ? dtReal * 0.35 : dtReal;
    this.head.copy(input.head);
    this.headDir.copy(input.headDir);
    this.stateT += dtReal;
    this.sinceHurt += dt;

    this.updateSummon(dtReal, input);
    this.updateWeapons(dt, t, input);
    this.updateFlow(dtReal);
    // Monsters, rifts, projectiles.
    for (const r of this.rifts) r.update(dt);
    this.rifts = this.rifts.filter((r) => !r.done);
    for (const m of this.monsters) {
      m.update(dt, t, this);
      // Every defeat counts once, however it happened.
      if (m.dying && !m.counted) {
        m.counted = true;
        this.kills++;
        this.score += m.points;
      }
    }
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      if (this.monsters[i].dead) {
        this.monsters[i].dispose();
        this.monsters.splice(i, 1);
      }
    }
    this.separate();
    this.updateOrbs(dt);
    this.updateShots(dt, t);
    this.hitMonsters();
    this.sparks.update(dt);
    // Slow regeneration once you've been safe for a while.
    if (this.sinceHurt > 4 && this.hp < MAX_HP && this.state === 'fight') {
      this.hp = Math.min(MAX_HP, this.hp + dt / 3);
    }
    this.updateHud(dtReal, t);
  }

  /** Intro → arm the featured weapon → waves → victory. */
  private updateFlow(dt: number): void {
    const def = this.def!;
    switch (this.state) {
      case 'intro':
        if (this.stateT > 3.2) {
          if (this.holding(def.feature)) this.toHowTo();
          else {
            this.setState('arming');
            const cap = POSE_CAPTIONS[def.feature];
            const key = { dog: 1, bird: 2, rabbit: 3, snake: 4 }[def.feature];
            this.setBanner(
              `${cap[0]} → ${WEAPON_INFO[WEAPON_OF[def.feature]].name.toUpperCase()}`,
              this.desktop ? `Press ${key} to pull the shadow into your hand (in VR: ${cap[1]})` : `${cap[1]} · the shadow becomes a weapon in your hand`,
            );
            (this.pict.material as MeshBasicMaterial).map = pictogramTexture(def.feature);
            (this.pict.material as MeshBasicMaterial).needsUpdate = true;
            this.pictFade.show();
          }
        }
        break;
      case 'arming':
        // A weapon of the featured kind in either hand moves things on.
        if (this.holding(def.feature)) this.toHowTo();
        else if (this.stateT > ARMING_GRACE) {
          // Never get stuck: the shadow answers anyway.
          this.equip(def.feature, def.feature === 'rabbit' ? 'left' : 'right');
          this.toHowTo();
        }
        break;
      case 'howto':
        if (this.stateT > 3) this.beginWave(0);
        break;
      case 'fight': {
        this.spawnT -= dt;
        const alive = this.monsters.filter((m) => m.alive).length;
        const waveDef = def.waves[this.wave];
        if (this.queue.length && alive + this.rifts.length < waveDef.maxAlive && this.spawnT <= 0) {
          this.spawn(this.queue.shift()!);
          this.spawnT = 1.6 + Math.random();
        }
        if (!this.queue.length && this.monsters.length === 0 && this.rifts.length === 0) {
          if (this.wave + 1 < def.waves.length) {
            this.setState('between');
            this.setBanner('WAVE CLEARED', `Wave ${this.wave + 2} is coming…`);
            sfx.levelComplete();
          } else {
            this.setState('won');
            this.setBanner('VICTORY', def.boss ? 'The Shadow Eater is broken. The light returns!' : 'The monsters are gone. Your shadows protected the light.');
            sfx.fanfare();
            this.burstAround(this.head, 0xffc46a);
          }
        }
        if (this.hp <= 0.01) {
          this.setState('down');
          this.falls++;
          this.setBanner('YOUR LIGHT FADES…', def.boss ? 'Rise again: its broken cores stay broken' : 'Rise again: the wave begins anew');
          this.clearWave(true);
        }
        break;
      }
      case 'between':
        if (this.stateT > 2.8) this.beginWave(this.wave + 1);
        break;
      case 'down':
        if (this.stateT > 3.5) {
          this.hp = MAX_HP;
          this.beginWave(this.wave);
        }
        break;
      case 'won':
        if (this.stateT > 4.5) this.finished = true;
        break;
    }
  }

  private toHowTo(): void {
    const def = this.def!;
    const w = WEAPON_INFO[WEAPON_OF[def.feature]];
    this.pictFade.show(false);
    this.setState('howto');
    const id = WEAPON_OF[def.feature];
    const extra = !this.desktop
      ? ''
      : id === 'firebird'
        ? ' · desktop: aim with the mouse, click to throw'
        : id === 'shield'
          ? ' · desktop: hold Space to raise it'
          : ' · desktop: sweep the mouse to swing';
    this.setBanner(w.name.toUpperCase(), w.how.charAt(0).toUpperCase() + w.how.slice(1) + extra);
  }

  private beginWave(i: number): void {
    const def = this.def!;
    this.wave = i;
    this.queue = def.waves[i].list.filter((k) => !(k === 'boss' && this.boss?.alive));
    this.spawnT = 0.6;
    this.setState('fight');
    this.setBanner(def.boss ? 'THE SHADOW EATER' : `WAVE ${i + 1} OF ${def.waves.length}`, def.boss ? 'Strike its glowing cores — chest, then hands' : '');
    this.bannerT = 2.5;
    sfx.horn();
  }
  private bannerT = 0;

  /** Remove everything hostile (after a fall or a restart). The boss can stay, wounded. */
  private clearWave(keepBoss = false): void {
    for (const m of this.monsters) if (!(keepBoss && m === this.boss && m.alive)) m.dispose();
    const boss = keepBoss && this.boss?.alive ? this.boss : undefined;
    this.monsters.length = 0;
    if (boss) this.monsters.push(boss);
    for (const r of this.rifts) r.root.removeFromParent();
    this.rifts = [];
    for (const o of this.orbs) this.killOrb(o);
    this.orbs = [];
    this.boss = boss;
  }

  // -------------------------------------------------------------------------
  // Shadows → weapons

  private holding(p: PoseId): boolean {
    const id = WEAPON_OF[p];
    return this.weapons.left?.id === id || this.weapons.right?.id === id;
  }

  private updateSummon(dt: number, input: BattleInput): void {
    const pose = input.pose;
    let hand: 'left' | 'right' | null = null;
    let fired: PoseId | null = null;
    if (pose.triggered) {
      fired = pose.triggered;
      hand = this.handFor(pose.triggered, input);
    }
    if (input.equip) {
      fired = input.equip.pose;
      hand = input.equip.hand;
    }
    if (fired && hand && this.state !== 'won') {
      this.equip(fired, hand);
      input.poses.reset();
    }
    // While a shape is held: a gold ring spins around the hand and a dark
    // shadow-ghost condenses in the palm.
    const charging = pose.charging && pose.progress > 0.05 && this.state !== 'won';
    if (charging) {
      const h = this.handFor(pose.charging!, input);
      const at = pose.charging === 'bird' ? pose.anchor : this.rigs[h].pos;
      this.charge.position.copy(at);
      this.charge.rotation.x = Math.PI / 2;
      this.charge.rotation.z += dt * 6;
      this.charge.scale.setScalar(1.4 - pose.progress * 0.8);
      this.chargeMat.opacity = 0.25 + pose.progress * 0.75;
      this.ghost.position.copy(at);
      this.ghost.scale.setScalar(0.4 + pose.progress);
      (this.ghost.material as MeshBasicMaterial).opacity = pose.progress * 0.8;
      if (Math.random() < 0.6) this.sparks.gather(at, 0.25, 1, 0xffc46a);
      sfx.setChime(pose.progress);
    } else {
      this.chargeMat.opacity = Math.max(0, this.chargeMat.opacity - dt * 4);
      (this.ghost.material as MeshBasicMaterial).opacity = 0;
      sfx.setChime(0);
    }
  }

  /** Which hand a pose belongs to: bird (two hands) goes to the right hand. */
  private handFor(p: PoseId, input: BattleInput): 'left' | 'right' {
    if (p === 'bird') return input.poses.right.tracked || !input.poses.left.tracked ? 'right' : 'left';
    const a = input.pose.anchor;
    const dl = input.poses.left.tracked ? a.distanceToSquared(input.poses.left.palmCenter) : Infinity;
    const dr = input.poses.right.tracked ? a.distanceToSquared(input.poses.right.palmCenter) : Infinity;
    if (dl === Infinity && dr === Infinity) return 'right';
    return dl < dr ? 'left' : 'right';
  }

  /** The shadow leaves the wall and becomes a weapon in this hand. */
  equip(p: PoseId, hand: 'left' | 'right'): void {
    const id = WEAPON_OF[p];
    const cur = this.weapons[hand];
    if (cur?.id === id) return;
    this.dropWeapon(hand);
    const w = makeWeapon(id, hand);
    this.weapons[hand] = w;
    this.root.add(w.root);
    if (w instanceof Blade) this.root.add(w.trail.mesh);
    if (w instanceof Whip) w.attach(this.root);
    const rig = this.rigs[hand];
    const color = WEAPON_INFO[id].color;
    // The creature's shadow appears at your hand and spins down into the weapon.
    const ghost = makeCreature(p);
    const backlight = halo(0xffc46a, 0.9, 0.75);
    backlight.position.set(0, 0.15, -0.02);
    ghost.root.add(backlight);
    ghost.root.position.copy(rig.pos);
    this.root.add(ghost.root);
    this.condensing.push({ s: ghost, t: 0, hand });
    this.sparks.burst(rig.pos, 60, 1.6, color, 0.7, 0.5);
    this.sparks.burst(rig.pos, 30, 0.8, 0x9a5cff, 0.6, 0.2);
    sfx.summonWeapon();
    // Name of the weapon pops up above the hand.
    this.weaponLabel?.mesh.removeFromParent();
    const m = makeText([WEAPON_INFO[id].name], 0.11, { size: 64, color: '#fff1d6' });
    m.position.copy(rig.pos).add(tmp.set(0, 0.22, 0));
    this.root.add(m);
    this.weaponLabel = new Fader(m, 4).show();
    this.weaponLabelT = 1.6;
  }

  private dropWeapon(hand: 'left' | 'right'): void {
    const w = this.weapons[hand];
    if (!w) return;
    if (w.root.visible) this.sparks.burst(w.root.position, 25, 0.8, 0x9a5cff, 0.5, 0.5);
    w.dispose();
    this.weapons[hand] = null;
  }

  private updateWeapons(dt: number, t: number, input: BattleInput): void {
    for (const hand of ['left', 'right'] as const) {
      const w = this.weapons[hand];
      if (!w) continue;
      const rig = this.rigs[hand];
      w.update(dt, t, rig);
      const k = hand === 'left' ? 0 : 1;
      if (w instanceof Blade) {
        // Swoosh on the rising edge of a fast swing.
        this.bladeSwoosh[k] = Math.max(0, this.bladeSwoosh[k] - dt);
        if (w.tipSpeed > 3 && this.bladeSwoosh[k] <= 0) {
          sfx.swoosh(Math.min(1, w.tipSpeed / 7));
          this.bladeSwoosh[k] = 0.3;
        }
      } else if (w instanceof Whip) {
        this.whipCrack[k] = Math.max(0, this.whipCrack[k] - dt);
        if (w.tipSpeed > 7.5 && this.whipCrack[k] <= 0 && w.form >= 1) {
          sfx.crack();
          this.sparks.burst(w.rope.p[WHIP_SEGMENTS], 14, 1.2, 0xd6ff9a, 0.3, 0.5);
          this.whipCrack[k] = 0.35;
        }
      } else if (w instanceof FirebirdWeapon && w.ready && rig.tracked) {
        // Throw on a pinch, or on a quick forward flick of the hand.
        const flickDir = tmp.copy(rig.vel).normalize();
        const flick = rig.speed > 2.2 && flickDir.dot(this.headDir) > 0.55;
        if (rig.pinchStarted || flick) {
          const aim = tmp2;
          if (input.aim && hand === 'right') aim.copy(input.aim);
          else if (flick) aim.copy(flickDir);
          else aim.copy(rig.fwd).multiplyScalar(0.6).addScaledVector(this.headDir, 0.4).normalize();
          this.throwBird(w.perch, aim);
          w.release();
        }
      }
    }
    // Shadows condensing into weapons.
    for (const c of this.condensing) {
      c.t += dt;
      const k = Math.min(1, c.t / 0.6);
      const rig = this.rigs[c.hand];
      c.s.root.position.copy(rig.pos).y += 0.25 * (1 - k);
      c.s.root.lookAt(this.head);
      c.s.root.rotateY(k * Math.PI * 3);
      const sc = 0.75 * (1 - k * k);
      c.s.root.scale.set(sc, sc, sc);
      c.s.update(dt, t);
      c.s.root.scale.set(sc, sc, sc);
      if (k < 1 && Math.random() < 0.7) this.sparks.gather(rig.pos, 0.2, 2, 0xffc46a);
    }
    for (const c of this.condensing) if (c.t >= 0.6) c.s.root.removeFromParent();
    this.condensing = this.condensing.filter((c) => c.t < 0.6);
    // Label above a freshly made weapon.
    if (this.weaponLabel) {
      this.weaponLabelT -= dt;
      if (this.weaponLabelT <= 0) this.weaponLabel.show(false);
      this.weaponLabel.update(dt);
    }
  }

  // -------------------------------------------------------------------------
  // Spawning

  private spawn(kind: MonsterKind): void {
    const m = makeMonster(kind);
    // Pick the free direction furthest from everyone else (front 110° arc).
    let best = 0;
    let bestGap = -1;
    // Walkers come at you inside a comfortable seated arc; casters spread wider.
    const arc = kind === 'wraith' ? 0.75 : 0.5;
    for (let k = 0; k < 9; k++) {
      const a = -arc + (k / 8) * 2 * arc;
      let gap = 9;
      for (const o of this.monsters) gap = Math.min(gap, Math.abs(o.slotAngle - a));
      gap += Math.random() * 0.15;
      if (gap > bestGap) {
        bestGap = gap;
        best = a;
      }
    }
    m.slotAngle = best;
    const dir = tmp.set(Math.sin(best), 0, -Math.cos(best));
    if (kind === 'boss') {
      this.boss = m as ShadowEater;
      m.root.position.set(this.head.x, 0, this.head.z - 9);
      m.slotAngle = 0;
      this.addRift(tmp2.set(this.head.x, 4, this.head.z - 8.5), 7);
    } else {
      const dist = kind === 'wraith' ? 5 : kind === 'brute' ? 5.2 : 4.4;
      const y = kind === 'wraith' ? 2.0 : 0;
      m.root.position.set(this.head.x + dir.x * dist, y, this.head.z + dir.z * dist);
      const riftY = kind === 'wraith' ? 2.0 : kind === 'brute' ? 1.15 : 0.65;
      this.addRift(tmp2.set(m.root.position.x, riftY, m.root.position.z), kind === 'brute' ? 2.4 : kind === 'wraith' ? 1.4 : 1.4);
    }
    m.root.rotation.y = Math.atan2(this.head.x - m.root.position.x, this.head.z - m.root.position.z);
    this.monsters.push(m);
    this.root.add(m.root);
  }

  private addRift(at: Vector3, size: number): void {
    const r = new Rift(at, this.head, size);
    this.rifts.push(r);
    this.root.add(r.root);
    this.panned(at, () => sfx.riftOpen());
  }

  /** Keep monsters from standing inside each other. */
  private separate(): void {
    const ms = this.monsters;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const a = ms[i];
        const b = ms[j];
        if (!a.alive || !b.alive || a.kind === 'boss' || b.kind === 'boss') continue;
        tmp.subVectors(b.root.position, a.root.position);
        tmp.y = 0;
        const d = tmp.length();
        const min = a.kind === 'brute' || b.kind === 'brute' ? 0.9 : 0.6;
        if (d < min && d > 1e-4) {
          tmp.multiplyScalar(((min - d) / d) * 0.5);
          a.root.position.sub(tmp);
          b.root.position.add(tmp);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // ArenaCtx (what monsters can do)

  fireOrb(from: Vector3, speed: number, big: boolean, owner: Monster): void {
    const r = big ? 0.15 : 0.07;
    const mesh = new Mesh(new SphereGeometry(r, 12, 8), glowMat(0xe8d8ff));
    mesh.add(halo(0x8c5cff, r * 6, 0.95));
    mesh.position.copy(from);
    this.root.add(mesh);
    const aim = tmp.copy(this.head).add(tmp3.set((Math.random() - 0.5) * 0.15, -0.05, 0)).sub(from).normalize();
    this.orbs.push({ mesh, owner, reflected: false, pos: mesh.position, vel: aim.multiplyScalar(speed).clone(), radius: r, life: 7, alive: true });
  }

  strike(from: Vector3, dmg: number): boolean {
    // Blocked if a shield is between the blow and your head, or right on it.
    for (const hand of ['left', 'right'] as const) {
      const w = this.weapons[hand];
      if (!(w instanceof Shield) || !w.root.visible || w.form < 0.8) continue;
      const between = segmentDistance(w.center, from, this.head) < SHIELD_RADIUS + 0.14;
      const onIt = w.center.distanceTo(from) < 0.55;
      if (between || onIt) {
        w.glow = 0.35;
        sfx.clang();
        this.sparks.burst(w.center, 30, 1.6, 0xd8ecff, 0.5, 1);
        this.score += 50;
        return true;
      }
    }
    this.hurt(dmg);
    return false;
  }

  summon(kind: MonsterKind, count: number): void {
    for (let i = 0; i < count; i++) this.queue.unshift(kind);
    this.spawnT = 0;
  }

  sound(kind: 'screech' | 'growl' | 'stomp' | 'cast' | 'slam' | 'roar' | 'whoosh', from?: Vector3): void {
    this.panned(from, () => {
      if (kind === 'screech') sfx.screech();
      else if (kind === 'growl') sfx.growl();
      else if (kind === 'stomp') sfx.stomp();
      else if (kind === 'cast') sfx.castOrb();
      else if (kind === 'slam') sfx.slam();
      else if (kind === 'roar') sfx.roar();
      else sfx.swoosh(0.5);
    });
  }

  /** Sounds come from where things happen: pan by direction relative to your gaze. */
  private panned(from: Vector3 | undefined, fn: () => void): void {
    if (!from) return fn();
    const dx = from.x - this.head.x;
    const dz = from.z - this.head.z;
    const len = Math.hypot(dx, dz) || 1;
    // Right vector of the gaze (yaw only): (-dir.z, dir.x).
    const rl = Math.hypot(this.headDir.x, this.headDir.z) || 1;
    const pan = (dx * (-this.headDir.z / rl) + dz * (this.headDir.x / rl)) / len;
    sfx.at(pan * 0.85, fn);
  }

  private hurt(dmg: number): void {
    if (this.state !== 'fight') return;
    this.hp = Math.max(0, this.hp - dmg);
    this.damageTaken += dmg;
    this.sinceHurt = 0;
    this.hurtFlash = 1;
    sfx.hurt();
  }

  // -------------------------------------------------------------------------
  // Projectiles

  private throwBird(from: Vector3, aim: Vector3): void {
    const { root, wings } = makeFirebird();
    root.scale.setScalar(1.6);
    root.position.copy(from);
    this.root.add(root);
    // Gentle auto-aim: home on the target closest to where you threw.
    let target: Target | null = null;
    let bestCos = 0.72;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      for (const tg of m.targets) {
        if (!tg.alive) continue;
        const c = tmp3.subVectors(tg.center, from).normalize().dot(aim);
        if (c > bestCos) {
          bestCos = c;
          target = tg;
        }
      }
    }
    this.shots.push({ root, wings, pos: root.position, vel: aim.clone().multiplyScalar(9), target, life: 3, alive: true });
    sfx.throwFire();
    this.sparks.burst(from, 18, 1, 0xff8a2a, 0.4, 0.3);
  }

  private updateShots(dt: number, t: number): void {
    for (const s of this.shots) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.target && s.target.alive) {
        const want = tmp.subVectors(s.target.center, s.pos).normalize().multiplyScalar(11);
        s.vel.lerp(want, Math.min(1, dt * 5));
      }
      s.pos.addScaledVector(s.vel, dt);
      s.root.lookAt(tmp.copy(s.pos).sub(s.vel));
      flapWings(s.wings, t, 22);
      if (Math.random() < 0.8) this.sparks.burst(s.pos, 1, 0.3, 0xff9a3c, 0.35, -0.3);
      // Firebirds burn through shadow orbs too.
      for (const o of this.orbs) {
        if (o.alive && o.pos.distanceTo(s.pos) < o.radius + 0.2) {
          this.popOrb(o, 0xff9a3c);
          this.score += 25;
        }
      }
      if (s.life <= 0 || s.pos.y < -0.2) this.endShot(s);
    }
    this.shots = this.shots.filter((s) => s.alive);
  }

  private endShot(s: Shot): void {
    s.alive = false;
    s.root.removeFromParent();
    this.sparks.burst(s.pos, 30, 1.4, 0xff8a2a, 0.5, 1);
  }

  private updateOrbs(dt: number): void {
    for (const o of this.orbs) {
      if (!o.alive) continue;
      o.life -= dt;
      if (o.reflected) {
        this.updateReflected(o, dt);
        continue;
      }
      // Light homing so they stay fair but threatening.
      const want = tmp.subVectors(this.head, o.pos).normalize().multiplyScalar(o.vel.length());
      o.vel.lerp(want, Math.min(1, dt * 0.6));
      o.pos.addScaledVector(o.vel, dt);
      if (Math.random() < 0.5) this.sparks.burst(o.pos, 1, 0.15, 0x8c5cff, 0.4, 0);
      // Shields block, blades and whips cut them out of the air.
      for (const hand of ['left', 'right'] as const) {
        const w = this.weapons[hand];
        if (!w || !w.root.visible || w.form < 0.8 || !o.alive) continue;
        if (w instanceof Shield) {
          tmp2.subVectors(o.pos, w.center);
          const along = tmp2.dot(w.normal);
          const lateral = tmp2.addScaledVector(w.normal, -along).length();
          if (Math.abs(along) < 0.12 + o.radius && lateral < SHIELD_RADIUS + o.radius) {
            w.glow = 0.35;
            sfx.clang();
            this.score += 50;
            this.reflect(o, w);
          }
        } else if (w instanceof Blade) {
          if (w.tipSpeed > 1.0 && segmentDistance(o.pos, w.base, w.tip) < o.radius + 0.07) {
            w.glow = 0.25;
            sfx.impact(false);
            this.popOrb(o, 0xffc46a);
            this.score += 50;
          }
        } else if (w instanceof Whip) {
          for (let i = 5; i <= WHIP_SEGMENTS && o.alive; i++) {
            if (w.rope.speed[i] > 2 && w.rope.p[i].distanceTo(o.pos) < o.radius + 0.1) {
              sfx.crack();
              this.popOrb(o, 0x9dff7a);
              this.score += 50;
            }
          }
        }
      }
      if (!o.alive) continue;
      if (o.pos.distanceTo(this.head) < 0.22 + o.radius) {
        this.popOrb(o, 0xb06bff);
        this.hurt(1);
      } else if (o.life <= 0 || o.pos.y < -0.3) this.popOrb(o, 0x8c5cff);
    }
    this.orbs = this.orbs.filter((o) => o.alive);
  }

  /** The Moon Shield turns an orb back on whoever threw it. */
  private reflect(o: Orb, w: Shield): void {
    this.sparks.burst(o.pos, 20, 1.4, 0xd8ecff, 0.4, 0.5);
    const target = o.owner?.targets.find((t) => t.alive);
    if (!o.owner?.alive || !target) {
      this.popOrb(o, 0xd8ecff);
      return;
    }
    o.reflected = true;
    o.life = 4;
    o.vel.subVectors(target.center, o.pos).normalize().multiplyScalar(Math.max(6, o.vel.length() * 2));
    (o.mesh.material as MeshBasicMaterial).color.setHex(0xfff1c0);
    const glow = o.mesh.children[0] as Sprite | undefined;
    glow?.material.color.setHex(0xbfe3ff);
    void w;
  }

  private updateReflected(o: Orb, dt: number): void {
    const owner = o.owner;
    const target = owner?.alive ? owner.targets.find((t) => t.alive) : undefined;
    if (target) {
      const want = tmp.subVectors(target.center, o.pos).normalize().multiplyScalar(o.vel.length());
      o.vel.lerp(want, Math.min(1, dt * 8));
    }
    o.pos.addScaledVector(o.vel, dt);
    if (Math.random() < 0.7) this.sparks.burst(o.pos, 1, 0.2, 0xbfe3ff, 0.35, 0);
    for (const m of this.monsters) {
      if (!m.alive || !o.alive) continue;
      for (const tg of m.targets) {
        if (tg.alive && o.pos.distanceTo(tg.center) < tg.radius + o.radius + 0.05) {
          this.damage(m, tg, 2, tmp2.copy(o.vel), 0xbfe3ff, null);
          if (!m.alive) this.onAchievement?.('mirror');
          this.popOrb(o, 0xbfe3ff);
          break;
        }
      }
    }
    if (o.alive && o.life <= 0) this.popOrb(o, 0xbfe3ff);
  }

  private popOrb(o: Orb, color: number): void {
    this.sparks.burst(o.pos, 24, 1.3, color, 0.45, 0.8);
    this.killOrb(o);
  }

  private killOrb(o: Orb): void {
    o.alive = false;
    o.mesh.removeFromParent();
    o.mesh.geometry.dispose();
  }

  // -------------------------------------------------------------------------
  // Weapons vs monsters

  private hitMonsters(): void {
    for (const m of this.monsters) {
      if (!m.alive || m.emerge < 0.6) continue;
      for (const tg of m.targets) {
        if (!tg.alive || tg.cooldown > 0) continue;
        for (const hand of ['left', 'right'] as const) {
          const w = this.weapons[hand];
          if (!w || !w.root.visible || w.form < 0.7) continue;
          if (w instanceof Blade) {
            if (w.tipSpeed > 1.3 && segmentDistance(tg.center, w.base, w.tip) < tg.radius + 0.05) {
              const heavy = w.tipSpeed > 3.2;
              this.damage(m, tg, heavy ? 2 : 1, tmp.copy(w.tipVel), 0xffc46a, w);
            }
          } else if (w instanceof Whip) {
            for (let i = Math.floor(WHIP_SEGMENTS / 3); i <= WHIP_SEGMENTS; i++) {
              const sp = w.rope.speed[i];
              if (sp > 2.2 && w.rope.p[i].distanceTo(tg.center) < tg.radius + 0.07) {
                this.damage(m, tg, sp > 6 ? 3 : 2, tmp.subVectors(tg.center, w.rope.p[0]), 0x9dff7a, w);
                break;
              }
            }
          } else if (w instanceof Shield) {
            if (w.speed > 1.4 && w.center.distanceTo(tg.center) < tg.radius + SHIELD_RADIUS * 0.8) {
              this.damage(m, tg, 1, tmp.copy(w.vel).multiplyScalar(2), 0xd8ecff, w);
            }
          }
          if (!tg.alive || tg.cooldown > 0) break;
        }
        for (const s of this.shots) {
          if (!s.alive || !tg.alive || tg.cooldown > 0) continue;
          if (s.pos.distanceTo(tg.center) < tg.radius + 0.1) {
            sfx.burn();
            this.damage(m, tg, m.kind === 'brute' ? 1 : 1.5, tmp.copy(s.vel), 0xff8a2a, null);
            this.endShot(s);
          }
        }
      }
    }
  }

  private damage(m: Monster, tg: Target, dmg: number, dir: Vector3, color: number, w: Weapon | null): void {
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.subVectors(tg.center, this.head).setY(0);
    dir.normalize();
    const killed = m.hit(tg, dmg, dir);
    if (w) w.glow = 0.2;
    this.sparks.burst(tg.center, 26 + dmg * 10, 1.4 + dmg * 0.3, color, 0.5, 1.5, dir, 0.9);
    this.sparks.burst(tg.center, 10, 0.8, 0x6a2cff, 0.6, 0.5);
    this.panned(tg.center, () => sfx.impact(dmg >= 2));
    this.score += Math.round(10 * dmg);
    if (!tg.alive && m.alive) {
      // A boss core shattered, but the boss fights on.
      sfx.sealBreak();
      this.slowmo = 0.35;
      this.burstAround(tg.center, 0xd38bff);
      this.score += 500;
    }
    if (killed) {
      this.slowmo = m.kind === 'boss' ? 1.2 : 0.12;
      this.panned(tg.center, () => sfx.monsterDie(m.kind === 'boss' || m.kind === 'brute'));
      this.sparks.burst(tg.center, m.kind === 'boss' ? 300 : 70, m.kind === 'boss' ? 5 : 2.2, 0x9a5cff, 1, 1);
      this.sparks.burst(tg.center, m.kind === 'boss' ? 200 : 40, m.kind === 'boss' ? 4 : 1.8, 0xffc46a, 0.9, 1);
      if (m.kind === 'boss') {
        sfx.roar();
        // Its minions die with it.
        for (const o of this.monsters) if (o !== m && o.alive) o.die(tmp2.set(0, 0, -1));
        for (const o of this.orbs) this.killOrb(o);
        this.queue.length = 0;
      }
    }
  }

  private burstAround(at: Vector3, color: number): void {
    this.sparks.burst(at, 120, 2.5, color, 1.2, 0.6);
  }

  // -------------------------------------------------------------------------
  // HUD

  private setBanner(title: string, sub: string): void {
    for (const f of [this.banner, this.bannerSub]) {
      if (!f) continue;
      f.mesh.removeFromParent();
      (f.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    const t = makeText([title], 0.62, { size: 96, weight: '700', letterSpacing: 8, color: '#fff1d6' });
    t.position.set(this.head.x, 2.55, this.head.z - 3.6);
    this.root.add(t);
    this.banner = new Fader(t, 2.5).show();
    this.bannerSub = undefined;
    if (sub) {
      const s = makeText([sub], 0.3, { size: 60, italic: true, color: '#ffe2a8' });
      s.position.set(this.head.x, 2.2, this.head.z - 3.6);
      this.root.add(s);
      this.bannerSub = new Fader(s, 2.5).show();
    }
    this.bannerT = 0;
  }

  private updateHud(dt: number, t: number): void {
    // Wave banners fade after a moment; story beats stay until replaced.
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) {
        this.banner?.show(false);
        this.bannerSub?.show(false);
      }
    }
    this.banner?.update(dt);
    this.bannerSub?.update(dt);
    this.pictFade.update(dt);
    this.pict.scale.setScalar(1 + 0.03 * Math.sin(t * 2.5));
    // Status line: wave, monsters left, score.
    if (this.state === 'fight' && this.def) {
      const left = this.queue.length + this.monsters.filter((m) => m.alive).length;
      const boss = this.boss && this.boss.alive ? `cores ${this.boss.coresLeft}/3` : `monsters ${left}`;
      const text = `${this.def.boss ? 'BOSS' : `wave ${this.wave + 1}/${this.def.waves.length}`}  ·  ${boss}  ·  ✦ ${this.score}`;
      if (text !== this.statusText) {
        this.statusText = text;
        if (this.status) {
          this.status.mesh.removeFromParent();
          (this.status.mesh.material as MeshBasicMaterial).map?.dispose();
        }
        const m = makeText([text], 0.26, { size: 52, color: '#ffe9c4' });
        m.position.set(this.head.x, 3.0, this.head.z - 3.6);
        this.root.add(m);
        this.status = new Fader(m, 4).show();
        this.status.value = 1;
      }
    } else if (this.status && this.statusText) {
      this.status.show(false);
      this.statusText = '';
    }
    this.status?.update(dt);
    // Life flames.
    for (let i = 0; i < MAX_HP; i++) {
      const f = this.flames[i];
      const lit = Math.max(0, Math.min(1, this.hp - i));
      f.mesh.scale.setScalar(0.35 + 0.65 * lit + (lit > 0 ? 0.08 * Math.sin(t * 11 + i * 2) : 0));
      (f.mesh.material as MeshBasicMaterial).color.setHex(lit > 0.5 ? 0xffc46a : 0x403040);
      f.glow.material.opacity = lit * 0.9;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    const low = this.hp < 1.6 && this.state === 'fight' ? 0.12 + 0.06 * Math.sin(t * 6) : 0;
    (this.vignette.material as MeshBasicMaterial).opacity = Math.max(this.hurtFlash * 0.55, low);
    this.vignette.visible = (this.vignette.material as MeshBasicMaterial).opacity > 0.01;
  }

  // -------------------------------------------------------------------------
  // Battlefield dressing (the theatre's front opens into a temple courtyard)

  private clearField(): void {
    for (const c of [...this.field.children]) {
      c.removeFromParent();
      c.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
  }

  private buildField(world: WorldId): void {
    this.clearField();
    const add = (o: Object3D) => this.field.add(o);
    // Every battlefield gets a few braziers for light and a ring of rune stones.
    const stone = new MeshStandardMaterial({ color: 0x3a3440, roughness: 0.9 });
    const brazier = (x: number, z: number, color: number) => {
      const g = new Group();
      const bowl = new Mesh(new CylinderGeometry(0.28, 0.16, 0.25, 12), new MeshStandardMaterial({ color: 0x5a4024, metalness: 0.7, roughness: 0.4 }));
      bowl.position.y = 1.0;
      const pole = new Mesh(new CylinderGeometry(0.05, 0.08, 1.0, 8), stone);
      pole.position.y = 0.5;
      const fire = new Mesh(new ConeGeometry(0.2, 0.5, 10), glowMat(color));
      fire.position.y = 1.3;
      const glow = halo(color, 1.6, 0.8);
      glow.position.y = 1.35;
      g.add(bowl, pole, fire, glow);
      g.position.set(x, 0, z);
      add(g);
    };
    const fireColor = world === 'castle' || world === 'realm' ? 0xa66bff : world === 'forest' ? 0x9dffb0 : 0xffa040;
    brazier(-2.6, -3.2, fireColor);
    brazier(2.6, -3.2, fireColor);
    if (world === 'theatre') {
      // Temple courtyard: flagstones, gopuram towers, rows of pillars.
      const floor = new Mesh(new PlaneGeometry(26, 22), new MeshStandardMaterial({ color: 0x4a3222, roughness: 0.95 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, -0.005, -12);
      add(floor);
      const towerMat = new MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.85, emissive: 0x1a0c04 });
      for (const [x, z, s] of [
        [0, -17, 1.4],
        [-9, -14, 0.9],
        [9, -14, 0.9],
      ]) {
        const tower = new Group();
        for (let k = 0; k < 6; k++) {
          const w = (5 - k * 0.7) * s;
          const tier = new Mesh(new BoxGeometry(w, 1.1 * s, w * 0.6), towerMat);
          tier.position.y = (0.55 + k * 1.1) * s;
          tower.add(tier);
          for (let j = -1; j <= 1; j++) {
            const win = new Mesh(new PlaneGeometry(0.25 * s, 0.4 * s), glowMat(0xffa040));
            win.position.set(j * w * 0.28, (0.55 + k * 1.1) * s, w * 0.3 + 0.01);
            tower.add(win);
          }
        }
        const kalasha = new Mesh(new SphereGeometry(0.35 * s, 10, 8), new MeshStandardMaterial({ color: 0xd6a540, metalness: 0.9, roughness: 0.3, emissive: 0x6a4210 }));
        kalasha.position.y = 7 * s;
        tower.add(kalasha);
        tower.position.set(x, 0, z);
        add(tower);
      }
      const pillarMat = new MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.8 });
      for (let k = 0; k < 5; k++) {
        for (const sx of [-1, 1]) {
          const p = new Mesh(new CylinderGeometry(0.3, 0.35, 4, 10), pillarMat);
          p.position.set(sx * 5, 2, -4 - k * 2.6);
          add(p);
        }
      }
      for (const z of [-6, -10]) {
        for (const sx of [-1, 1]) {
          const torch = halo(0xffa040, 1.2, 0.85);
          torch.position.set(sx * 4.6, 2.6, z);
          add(torch);
        }
      }
    }
    if (world === 'realm') {
      // The world's own giant steps aside: the real Shadow Eater fights you.
      DOWN_FWD.set(0, 0, 0);
    }
    void tmp3;
  }
}
