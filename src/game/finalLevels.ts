import { Group, Mesh, MeshBasicMaterial, Vector3 } from '@iwsdk/core';
import { sfx } from '../audio/sfx.js';
import type { PoseId } from '../hands/poseDetector.js';
import type { Room } from '../scene/room.js';
import { makeBackdrop } from './backdrops.js';
import { Bird, Dog, Rabbit, Snake } from './creatures.js';
import { GROUND, lerp, Level, makeGround, together } from './levels.js';
import { capsule, circle, ease, ellipse, glow, magicGlow, part, pivot, poly, shadowMaterial, tween, wait, withHole, type Script } from './shapes.js';

const PURPLE = 0xa86bff;

// ---------------------------------------------------------------------------
// Chapter IV — The Forbidden Passage
// ---------------------------------------------------------------------------

/** Castle wall with an arched gate and a low crack under its left side. */
function makeCastleWall(x0: number, x1: number, gateL: number, gateR: number, crackL: number, crackR: number): Group {
  const top = GROUND + 0.95;
  const gateTop = GROUND + 0.36;
  const crackH = 0.04;
  const pts: number[] = [x0, GROUND, crackL, GROUND, crackL, GROUND + crackH, crackR, GROUND + crackH, crackR, GROUND, gateL, GROUND, gateL, gateTop];
  // Rounded arch over the gate.
  const cx = (gateL + gateR) / 2;
  const r = (gateR - gateL) / 2;
  for (let i = 1; i < 12; i++) {
    const a = Math.PI - (i / 12) * Math.PI;
    pts.push(cx + Math.cos(a) * r, gateTop + Math.sin(a) * r * 0.8);
  }
  pts.push(gateR, gateTop, gateR, GROUND, x1, GROUND, x1, top);
  // Battlements back along the top.
  for (let x = x1; x > x0 + 0.04; x -= 0.09) {
    pts.push(x, top + 0.06, x - 0.05, top + 0.06, x - 0.05, top);
  }
  pts.push(x0, top);
  const g = new Group();
  g.add(part([poly(pts)], shadowMaterial()));
  return g;
}

export class PassageLevel extends Level {
  readonly numeral = 'IV';
  readonly title = 'The Forbidden Passage';
  readonly subtitle = 'The castle is sealed. Only something small and quiet can slip inside.';
  readonly solutions: readonly PoseId[] = ['snake'];
  override readonly hintX = -0.7;

  private readonly snake = new Snake();
  private readonly portcullis: Group;
  private readonly lever: Group;
  private readonly rune: Mesh;
  private readonly gateL = 0.24;
  private readonly gateR = 0.46;

  constructor(room: Room) {
    super(room);
    const m = shadowMaterial();
    this.root.add(makeBackdrop('castle'), makeGround(), makeCastleWall(0.04, 0.62, this.gateL, this.gateR, 0.08, 0.2));
    // Iron portcullis filling the arch.
    const bars = [];
    for (let x = this.gateL + 0.02; x < this.gateR; x += 0.045) bars.push(poly([x - 0.008, 0, x + 0.008, 0, x + 0.008, 0.46, x - 0.008, 0.46]));
    for (const y of [0.1, 0.24, 0.38]) bars.push(poly([this.gateL, y, this.gateR, y, this.gateR, y + 0.014, this.gateL, y + 0.014]));
    this.portcullis = new Group();
    this.portcullis.add(part(bars, m));
    this.root.add(this.portcullis);
    // The lever behind the wall that works the gate, with a glowing rune.
    this.rune = magicGlow(0.12, PURPLE, 0.8);
    this.rune.position.set(0, 0.17, 0.002);
    this.lever = pivot(0.86, GROUND + 0.06, part([capsule(0, 0, 0, 0.17, 0.02), circle(0, 0.17, 0.022)], m), this.rune);
    this.root.add(part([ellipse(0.86, GROUND + 0.03, 0.07, 0.04)], m), this.lever);
    this.add(this.snake);
  }

  storyLine(): string {
    return 'A snake slipped through a crack and opened the castle gate.';
  }

  /** Arrive on the near side of the castle wall. */
  protected override landX(x: number): number {
    return Math.min(x, -0.05);
  }

  protected reset(): void {
    this.portcullis.position.set(0, GROUND, 0.001);
    this.lever.rotation.z = 0.55;
    (this.rune.material as MeshBasicMaterial).opacity = 0.8;
    this.snake.root.visible = false;
    this.snake.fade(0, true);
    this.snake.flat = 0;
    this.snake.rear = 0;
  }

  protected tick(_dt: number, time: number): void {
    this.rune.scale.setScalar(1 + 0.15 * Math.sin(time * 3));
  }

  protected *solve(_pose: PoseId, spawn: Vector3): Script {
    const s = this.snake;
    yield* this.emerge(s, spawn);
    yield* this.walkTo(s, -0.02, 0.35);
    // Flatten and slither through the crack under the wall.
    yield* tween(0.4, (k) => (s.flat = k));
    yield* this.walkTo(s, 0.72, 0.3, (k) => k);
    yield* tween(0.4, (k) => (s.flat = 1 - k));
    // Rear up and strike the lever.
    s.facing = 1;
    yield* tween(0.5, (k) => (s.rear = ease.out(k)));
    yield* wait(0.3);
    sfx.dig();
    yield* tween(0.35, (k) => (this.lever.rotation.z = lerp(0.55, -0.55, ease.out(k))));
    yield* tween(0.4, (k) => ((this.rune.material as MeshBasicMaterial).opacity = 0.8 * (1 - k)));
    // The gate grinds open.
    sfx.rumble(1.6);
    yield* tween(1.6, (k) => (this.portcullis.position.y = GROUND + ease.inOut(k) * 0.42));
    yield* tween(0.4, (k) => (s.rear = 1 - k));
    // Out through the open gate, triumphant.
    yield* this.walkTo(s, -0.35, 0.45);
    s.facing = 1;
    yield* wait(1.0);
    this.solved = true;
  }
}

// ---------------------------------------------------------------------------
// Chapter V — The Shadow Eater
// ---------------------------------------------------------------------------

/** The final boss: a towering, many-armed shadow with burning purple eyes. */
class ShadowEater {
  readonly root = new Group();
  private readonly mat = shadowMaterial();
  private readonly arms: Group[] = [];
  private readonly eyes: Mesh[] = [];
  private flinchT = 1;
  dissolve = 0;

  constructor() {
    const m = this.mat;
    this.root.add(
      part(
        [
          ellipse(0, 0.42, 0.3, 0.46),
          withHole(withHole(ellipse(0, 0.9, 0.2, 0.17), -0.07, 0.93, 0.03, 0.02), 0.07, 0.93, 0.03, 0.02),
          poly([-0.16, 1.0, -0.26, 1.22, -0.08, 1.04]), // horns
          poly([0.16, 1.0, 0.26, 1.22, 0.08, 1.04]),
          poly([-0.1, 0.8, 0.1, 0.8, 0.07, 0.76, 0.03, 0.79, 0, 0.75, -0.03, 0.79, -0.07, 0.76]), // jagged maw
          poly([-0.34, 0, 0.34, 0, 0.26, 0.2, -0.26, 0.2]), // trailing robes
        ],
        m,
      ),
    );
    for (const [x, y, dir] of [
      [-0.24, 0.55, -1],
      [0.24, 0.55, 1],
      [-0.22, 0.32, -1],
      [0.22, 0.32, 1],
    ] as const) {
      const arm = pivot(x, y, part([capsule(0, 0, dir * 0.22, 0.12, 0.05), capsule(dir * 0.22, 0.12, dir * 0.36, 0.05, 0.035)], m));
      this.arms.push(arm);
      this.root.add(arm);
    }
    for (const x of [-0.07, 0.07]) {
      const e = magicGlow(0.13, PURPLE, 1);
      e.position.set(x, 0.93, 0.003);
      this.eyes.push(e);
      this.root.add(e);
    }
  }

  flinch(): void {
    this.flinchT = 0;
  }

  reset(): void {
    this.dissolve = 0;
    this.root.visible = true;
    this.root.scale.setScalar(1);
    this.mat.opacity = 1;
  }

  update(dt: number, time: number): void {
    this.flinchT = Math.min(1, this.flinchT + dt / 0.8);
    const f = Math.sin(this.flinchT * Math.PI) * (this.flinchT < 1 ? 1 : 0);
    this.arms.forEach((a, i) => (a.rotation.z = Math.sin(time * 1.6 + i * 1.3) * 0.25 + (i % 2 ? -1 : 1) * f * 0.5));
    this.root.rotation.z = f * 0.12 + Math.sin(time * 0.8) * 0.02;
    this.root.position.y = GROUND + Math.sin(time * 1.1) * 0.012;
    const eye = (0.75 + 0.25 * Math.sin(time * 4)) * (1 - this.dissolve) * (1 - f * 0.6);
    for (const e of this.eyes) (e.material as MeshBasicMaterial).opacity = eye;
    // Defeat: the shadow thins out and shrinks into nothing.
    this.mat.opacity = 1 - this.dissolve;
    this.root.scale.set(1 + this.dissolve * 0.3, 1 - this.dissolve * 0.6, 1);
    this.root.visible = this.dissolve < 0.999;
  }
}

export class ShadowEaterLevel extends Level {
  readonly numeral = 'V';
  readonly title = 'The Shadow Eater';
  readonly subtitle = 'Four seals guard the stolen light. Break them with all four shadows.';
  override readonly hintDelay = 2.5;
  override readonly hintX = -0.85;

  /** Seals in order: each needs one creature. */
  private readonly needs: readonly PoseId[] = ['dog', 'bird', 'rabbit', 'snake'];
  private stage = 0;
  private readonly boss = new ShadowEater();
  private readonly dog = new Dog();
  private readonly bird = new Bird();
  private readonly rabbit = new Rabbit();
  private readonly snake = new Snake();
  private readonly seals: Mesh[] = [];
  private readonly sealHome: Vector3[] = [];
  private readonly light: Mesh;
  private readonly cage: Group;
  private readonly switchGlow: Mesh;
  /** High floating platform holding the caged light. */
  private readonly perch = new Vector3(0.12, GROUND + 0.82, 0);

  constructor(room: Room) {
    super(room);
    const m = shadowMaterial();
    this.root.add(makeBackdrop('moon'), makeGround());
    this.boss.root.position.set(0.85, GROUND, 0.001);
    this.root.add(this.boss.root);
    // Floating platform + iron cage with the stolen light inside.
    this.root.add(part([ellipse(this.perch.x, this.perch.y, 0.2, 0.03), poly([this.perch.x - 0.16, this.perch.y, this.perch.x + 0.16, this.perch.y, this.perch.x + 0.03, this.perch.y - 0.18])], m));
    this.light = glow(0.34, 1);
    this.light.position.set(this.perch.x, this.perch.y + 0.13, 0.002);
    const bars = [];
    for (let i = -2; i <= 2; i++) bars.push(poly([this.perch.x + i * 0.035 - 0.006, this.perch.y, this.perch.x + i * 0.035 + 0.006, this.perch.y, this.perch.x + i * 0.035 + 0.006, this.perch.y + 0.24, this.perch.x + i * 0.035 - 0.006, this.perch.y + 0.24]));
    bars.push(ellipse(this.perch.x, this.perch.y + 0.245, 0.095, 0.02));
    this.cage = new Group();
    this.cage.add(part(bars, m));
    this.root.add(this.light, this.cage);
    // Four purple seals orbiting the cage.
    for (let i = 0; i < 4; i++) {
      const s = magicGlow(0.16, PURPLE, 0.9);
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      this.sealHome.push(new Vector3(this.perch.x + Math.cos(a) * 0.2, this.perch.y + 0.13 + Math.sin(a) * 0.17, 0.003));
      this.seals.push(s);
      this.root.add(s);
    }
    // Hidden switch under the ground (lit by the rabbit).
    this.switchGlow = glow(0.18, 0);
    this.switchGlow.position.set(0.32, GROUND - 0.12, 0.004);
    this.root.add(this.switchGlow);
    this.add(this.dog, this.bird, this.rabbit, this.snake);
  }

  /** Only the creature for the next unbroken seal works. */
  get solutions(): readonly PoseId[] {
    return this.stage < this.needs.length ? [this.needs[this.stage]] : [];
  }

  storyLine(): string {
    return 'Together, all four shadows broke the seals and freed the stolen light.';
  }

  protected override landX(x: number): number {
    return Math.min(x, 0.45);
  }

  protected reset(): void {
    this.stage = 0;
    this.boss.reset();
    this.cage.position.set(0, 0, 0.001);
    this.cage.visible = true;
    this.light.position.set(this.perch.x, this.perch.y + 0.13, 0.002);
    this.light.scale.setScalar(1);
    (this.switchGlow.material as MeshBasicMaterial).opacity = 0;
    this.seals.forEach((s, i) => {
      s.visible = true;
      s.position.copy(this.sealHome[i]);
      s.scale.setScalar(1);
      (s.material as MeshBasicMaterial).opacity = 0.9;
    });
    for (const c of [this.dog, this.bird, this.rabbit, this.snake]) {
      c.root.visible = false;
      c.fade(0, true);
    }
    this.bird.flapping = true;
    this.bird.onFlap = () => sfx.flap();
    this.snake.rear = 0;
    this.snake.flat = 0;
    this.rabbit.hopping = false;
    this.rabbit.digging = false;
    this.rabbit.onScoop = () => sfx.dig();
  }

  /**
   * Co-op: if the two players hold the creatures for this seal and the next
   * one, both seals break in one go.
   */
  override summon(pose: PoseId, spawn: Vector3, duet = false, partnerPose: PoseId | null = null): boolean {
    this.duet = duet;
    const need = this.needs[this.stage];
    let first = pose;
    let second: PoseId | null = partnerPose;
    if (first !== need && second === need) [first, second] = [second, first];
    if (first !== need) {
      this.script.start(this.wrong(pose, spawn));
      return false;
    }
    const next = this.needs[this.stage + 1];
    const pair = second && second !== first && second === next ? second : null;
    this.outcome = first;
    this.script.start(this.breakSeals(first, pair, spawn));
    return true;
  }

  protected solve(pose: PoseId, spawn: Vector3): Script {
    return this.breakSeals(pose, null, spawn);
  }

  protected tick(_dt: number, time: number): void {
    this.boss.update(_dt, time);
    this.seals.forEach((s, i) => {
      if (!s.visible) return;
      const a = time * 0.6 + (i / 4) * Math.PI * 2;
      s.position.x = this.perch.x + Math.cos(a) * 0.2;
      s.position.y = this.perch.y + 0.13 + Math.sin(a) * 0.17;
    });
    // The caged light pulses until the finale takes it over.
    if (this.stage < this.needs.length) this.light.scale.setScalar(1 + 0.08 * Math.sin(time * 5));
  }

  private *shatter(i: number): Script {
    const s = this.seals[i];
    sfx.sealBreak();
    this.fx?.burst(new Vector3(s.position.x, s.position.y, this.root.position.z), 60, 0.6);
    const mat = s.material as MeshBasicMaterial;
    yield* tween(0.5, (k) => {
      s.scale.setScalar(1 + k * 2.5);
      mat.opacity = 0.9 * (1 - k);
    });
    s.visible = false;
  }

  private *breakSeals(first: PoseId, second: PoseId | null, spawn: Vector3): Script {
    if (second) {
      // Two players, two creatures, two seals at once.
      yield* together(this.stageScript(first, spawn), this.stageScript(second, new Vector3(spawn.x - 0.3, spawn.y, spawn.z)));
      this.stage += 2;
    } else {
      yield* this.stageScript(first, spawn);
      this.stage += 1;
    }
    if (this.stage >= this.needs.length) yield* this.finale();
  }

  private *stageScript(pose: PoseId, spawn: Vector3): Script {
    const i = this.needs.indexOf(pose);
    if (pose === 'dog') {
      // The dog distracts the Shadow Eater.
      const d = this.dog;
      yield* this.emerge(d, spawn);
      yield* this.walkTo(d, 0.4, 0.9);
      d.facing = 1;
      for (let k = 0; k < 3; k++) {
        d.bark();
        sfx.bark();
        if (k === 1) {
          this.boss.flinch();
          sfx.roar();
        }
        yield* wait(0.55);
      }
      yield* this.shatter(i);
      yield* this.walkTo(d, -0.55, 0.7);
      d.facing = 1;
    } else if (pose === 'bird') {
      // The bird reaches the high platform.
      const b = this.bird;
      yield* this.emerge(b, spawn, false);
      yield* this.flyTo(b, this.perch.x - 0.15, this.perch.y + 0.35, 1.4);
      yield* this.flyTo(b, this.perch.x + 0.2, this.perch.y + 0.3, 0.8);
      yield* this.shatter(i);
      yield* this.flyTo(b, this.perch.x - 0.16, this.perch.y + 0.01, 0.7);
      b.flapping = false;
      b.facing = 1;
    } else if (pose === 'rabbit') {
      // The rabbit digs down to the hidden switch.
      const r = this.rabbit;
      yield* this.emerge(r, spawn);
      r.hopping = true;
      yield* this.walkTo(r, 0.22, 0.55);
      r.hopping = false;
      r.facing = 1;
      r.digging = true;
      yield* wait(1.0);
      yield* tween(0.7, (k) => (r.root.position.y = GROUND - k * 0.3));
      r.digging = false;
      sfx.click();
      yield* tween(0.4, (k) => ((this.switchGlow.material as MeshBasicMaterial).opacity = k));
      yield* this.shatter(i);
      yield* tween(0.5, (k) => (r.root.position.y = GROUND - 0.3 + k * 0.3));
      yield* this.walkTo(r, -0.85, 0.6);
      r.facing = 1;
    } else {
      // The snake slithers up and strikes the last seal's anchor.
      const s = this.snake;
      yield* this.emerge(s, spawn);
      yield* this.walkTo(s, this.perch.x - 0.05, 0.4);
      s.facing = 1;
      yield* tween(0.5, (k) => (s.rear = ease.out(k)));
      yield* wait(0.3);
      yield* this.shatter(i);
      yield* tween(0.4, (k) => (s.rear = 1 - k));
      yield* this.walkTo(s, -0.25, 0.4);
      s.facing = 1;
    }
  }

  /** All seals broken: the cage falls, the light flies into the Shadow Eater and undoes it. */
  private *finale(): Script {
    sfx.rumble(0.9);
    yield* tween(0.8, (k) => (this.cage.position.y = -ease.in(k) * 0.9));
    this.cage.visible = false;
    yield* wait(0.3);
    const from = this.light.position.clone();
    const to = new Vector3(this.boss.root.position.x, GROUND + 0.9, 0.004);
    yield* tween(1.1, (k) => {
      this.light.position.set(lerp(from.x, to.x, ease.inOut(k)), lerp(from.y, to.y, k) + Math.sin(k * Math.PI) * 0.25, 0.004);
    });
    sfx.roar();
    this.fx?.burst(new Vector3(to.x, to.y, this.root.position.z), 160, 1.1);
    yield* together(
      tween(2.0, (k) => (this.boss.dissolve = ease.inOut(k))),
      tween(2.0, (k) => this.light.scale.set(1 + k * 4, 1 + k * 4, 1)),
    );
    yield* wait(1.2);
    this.solved = true;
  }
}
