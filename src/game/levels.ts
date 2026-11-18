import { Group, Mesh, MeshBasicMaterial, Vector3 } from '@iwsdk/core';
import { sfx } from '../audio/sfx.js';
import type { PoseId } from '../hands/poseDetector.js';
import type { Room } from '../scene/room.js';
import { STAGE } from '../scene/layout.js';
import { makeBackdrop } from './backdrops.js';
import { Bird, Dog, Dragon, Kitten, makeCandleProp, makeLantern, Rabbit, Snake, Thief, type Silhouette } from './creatures.js';
import { capsule, circle, ease, ellipse, glow, part, poly, ScriptRunner, shadowMaterial, tween, wait, type Script } from './shapes.js';

export const GROUND = STAGE.groundY;
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

const CREATURES: Record<PoseId, () => Silhouette> = {
  dog: () => new Dog(),
  bird: () => new Bird(),
  rabbit: () => new Rabbit(),
  snake: () => new Snake(),
};

export function makeCreature(pose: PoseId): Silhouette {
  return CREATURES[pose]();
}

/** Uneven earth along the bottom of the stage; creatures walk on its top edge. */
export function makeGround(from = STAGE.left - 2.2, to = STAGE.right + 2.2): Group {
  const pts: number[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    pts.push(x, GROUND - 0.006 + Math.sin(i * 2.3) * 0.006 + Math.sin(i * 0.7) * 0.008);
  }
  // Reach down to the floor so no lit edge shows under the stage.
  pts.push(to, GROUND - 1.4, from, GROUND - 1.4);
  const g = new Group();
  g.add(part([poly(pts)], shadowMaterial()));
  return g;
}

/**
 * A level is a little 2D shadow-play on the wall. Idle animation runs until
 * the right creature is summoned, then a scripted "solve" cutscene plays.
 * Summoning the wrong creature plays a short puzzled reaction instead.
 */
export abstract class Level {
  abstract readonly numeral: string;
  abstract readonly title: string;
  /** One line of story shown under the chapter title. */
  abstract readonly subtitle: string;
  /** Short goal shown on the HUD while the chapter is being played. */
  abstract get objective(): string;
  /** Seconds before the hand-shape hint appears (short for the tutorial and the boss). */
  readonly hintDelay: number = 8;
  /**
   * Shadows that solve this chapter. Each leads to a different consequence,
   * so the player's choices write the story. The first is the classic one.
   */
  abstract readonly solutions: readonly PoseId[];
  /** Where the hand-shape hint sits on the stage (clear of this level's props). */
  readonly hintX: number = -0.85;
  readonly root = new Group();
  /** Every silhouette that needs a per-frame update. */
  protected readonly actors: Silhouette[] = [];
  protected readonly script = new ScriptRunner();
  solved = false;
  /** Which solution the player chose, once summoned. */
  outcome: PoseId | null = null;
  /** Co-op: both players made the same shape, so the creature is a giant. */
  protected duet = false;
  /** Visual effects hook, injected by the game (sparks for seals, finales…). */
  fx: { burst(at: Vector3, count?: number, spread?: number): void } | undefined;

  /** One line for the ending's "your story" recap. */
  abstract storyLine(): string;

  constructor(protected readonly room: Room) {
    this.root.position.z = STAGE.z;
    this.root.visible = false;
  }

  /** True while a cutscene plays (pose input is ignored). */
  get busy(): boolean {
    return this.script.running;
  }

  enter(): void {
    this.solved = false;
    this.outcome = null;
    this.script.stop();
    this.reset();
    this.root.visible = true;
  }

  exit(): void {
    this.script.stop();
    this.root.visible = false;
  }

  /**
   * @param partnerPose co-op: the shape the other player was holding at the same moment
   * @returns true if this shadow solves the chapter.
   */
  summon(pose: PoseId, spawn: Vector3, duet = false, _partnerPose: PoseId | null = null): boolean {
    this.duet = duet;
    const solves = this.solutions.includes(pose);
    if (solves) this.outcome = pose;
    this.script.start(solves ? this.solve(pose, spawn) : this.wrong(pose, spawn));
    return solves;
  }

  update(dt: number, time: number): void {
    this.script.update(dt);
    this.tick(dt, time);
    for (const a of this.actors) a.update(dt, time);
  }

  protected abstract reset(): void;
  protected abstract solve(pose: PoseId, spawn: Vector3): Script;

  /** Where a walking creature may land (keeps it off chasms and out of walls). */
  protected landX(x: number): number {
    return x;
  }
  /** Idle animation hook. */
  protected tick(_dt: number, _time: number): void {}

  protected add(...actors: Silhouette[]): void {
    for (const a of actors) {
      this.actors.push(a);
      this.root.add(a.root);
    }
  }

  /** The creature peels off the hand's shadow, then (unless it flies) drops to the ground. */
  protected *emerge(c: Silhouette, spawn: Vector3, land = true): Script {
    c.root.visible = true;
    c.boost = this.duet ? 1.4 : 1;
    c.fade(1, true);
    c.root.position.set(land ? this.landX(spawn.x) : spawn.x, spawn.y - 0.12, 0.003);
    c.placed();
    c.grow = 0;
    yield* tween(0.55, (k) => (c.grow = Math.max(0.001, ease.backOut(k))));
    if (!land) return;
    const y0 = c.root.position.y;
    yield* tween(0.4, (k) => (c.root.position.y = lerp(y0, GROUND, ease.in(k))));
    yield* tween(0.18, (k) => (c.root.position.y = GROUND + Math.sin(k * Math.PI) * 0.03));
  }

  /** Move an actor horizontally at `speed` m/s, turning to face where it goes. */
  protected *walkTo(c: Silhouette, x: number, speed: number, easing = ease.inOut): Script {
    const x0 = c.root.position.x;
    if (Math.abs(x - x0) < 0.005) return;
    c.facing = x > x0 ? 1 : -1;
    yield* tween(Math.abs(x - x0) / speed, (k) => (c.root.position.x = lerp(x0, x, easing(k))));
  }

  /** Fly along a gentle arc to (x, y), facing the direction of travel. */
  protected *flyTo(c: Silhouette, x: number, y: number, seconds: number): Script {
    const p = c.root.position;
    const x0 = p.x;
    const y0 = p.y;
    if (Math.abs(x - x0) > 0.02) c.facing = x > x0 ? 1 : -1;
    yield* tween(seconds, (k) => {
      const e = ease.inOut(k);
      p.x = lerp(x0, x, e);
      p.y = lerp(y0, y, e) + Math.sin(k * Math.PI) * 0.1;
    });
  }

  /** A hop from the current spot to (x, y) along a parabola. */
  protected *jumpTo(c: Silhouette, x: number, y: number, seconds: number, height = 0.15): Script {
    const p = c.root.position;
    const x0 = p.x;
    const y0 = p.y;
    if (Math.abs(x - x0) > 0.01) c.facing = x > x0 ? 1 : -1;
    yield* tween(seconds, (k) => {
      p.x = lerp(x0, x, k);
      p.y = lerp(y0, y, k) + Math.sin(k * Math.PI) * height;
    });
  }

  /** Wrong creature: it appears, looks around, shrugs, and fades away. */
  protected *wrong(pose: PoseId, spawn: Vector3): Script {
    const c = makeCreature(pose);
    this.add(c);
    const flies = pose === 'bird';
    yield* this.emerge(c, spawn, !flies);
    yield* wait(0.3);
    for (let i = 0; i < 2; i++) {
      c.facing = c.facing === 1 ? -1 : 1;
      yield* wait(0.45);
    }
    sfx.fizzle();
    c.fade(0);
    yield* wait(0.7);
    this.root.remove(c.root);
    this.actors.splice(this.actors.indexOf(c), 1);
  }
}

// ---------------------------------------------------------------------------
// Level 1 — The Thief
// ---------------------------------------------------------------------------

export class ThiefLevel extends Level {
  readonly numeral = 'II';
  readonly title = 'The Lost Treasure';
  readonly subtitle = 'A shadow thief has stolen the second fragment of light.';
  get objective(): string {
    return 'Save the candle from the thief  ·  DOG or RABBIT';
  }
  readonly solutions: readonly PoseId[] = ['dog', 'rabbit'];

  private readonly thief = new Thief();
  private readonly dog = new Dog();
  private readonly rabbit = new Rabbit();
  /** Warm glow that blooms between the rabbit and the thief when they make friends. */
  private readonly heart = glow(0.3, 0);
  private readonly prop = makeCandleProp();
  private readonly standX = 0.3;
  private readonly idle = new ScriptRunner();
  private glowBoost = 1;

  constructor(room: Room) {
    super(room);
    this.root.add(makeBackdrop('village'), makeGround());
    this.prop.root.position.set(this.standX, GROUND, 0.001);
    this.root.add(this.prop.root, this.heart);
    this.add(this.thief, this.dog, this.rabbit);
  }

  storyLine(): string {
    return this.outcome === 'rabbit'
      ? 'A rabbit turned a thief into a friend.'
      : 'A dog chased the thief into the night.';
  }

  protected reset(): void {
    // Candle back on its stand.
    this.prop.root.add(this.prop.candle);
    this.prop.candle.position.set(0, 0.185, 0);
    this.prop.candle.rotation.set(0, 0, 0);
    this.prop.candle.scale.setScalar(1);
    this.glowBoost = 1;
    this.thief.root.position.set(1.5, GROUND, 0.002);
    this.thief.placed();
    this.thief.scared = false;
    this.thief.fade(1, true);
    this.thief.arm.rotation.z = 0;
    this.thief.sneaking = true;
    this.dog.root.visible = false;
    this.dog.fade(0, true);
    this.rabbit.root.visible = false;
    this.rabbit.fade(0, true);
    this.rabbit.hopping = false;
    this.heart.visible = false;
    this.idle.start(this.thiefLoop());
  }

  protected tick(dt: number, time: number): void {
    this.idle.update(dt);
    // The real candle flame's flicker, echoed in the shadow world.
    this.prop.glowMesh.scale.setScalar(this.glowBoost * (1 + 0.06 * Math.sin(time * 9.7)));
  }

  /** Sneak in, steal the candle, then loiter nervously (never escapes: no fail state). */
  private *thiefLoop(): Script {
    const t = this.thief;
    t.sneaking = true;
    yield* wait(1.5);
    yield* this.walkTo(t, this.standX + 0.2, 0.2);
    yield* tween(0.7, (k) => (t.arm.rotation.z = -0.35 * ease.inOut(k)));
    t.hand.attach(this.prop.candle);
    this.prop.candle.position.set(0, -0.2, 0);
    this.prop.candle.rotation.set(0, 0, 0.35);
    yield* tween(0.6, (k) => (t.arm.rotation.z = -0.35 + 0.55 * ease.inOut(k)));
    yield* this.walkTo(t, 0.95, 0.09);
    for (;;) {
      t.facing = -1; // nervous glance back
      yield* wait(1.3);
      t.facing = 1;
      yield* tween(1.6, (k) => (t.root.position.x = 0.95 + Math.sin(k * Math.PI) * 0.04));
      yield* wait(0.8);
    }
  }

  protected solve(pose: PoseId, spawn: Vector3): Script {
    this.idle.stop();
    return pose === 'rabbit' ? this.befriend(spawn) : this.scareOff(spawn);
  }

  /** Put the candle back on its stand from wherever it is (smooth arc). */
  private *returnCandle(seconds: number, arc: number): Script {
    const candle = this.prop.candle;
    if (candle.parent === this.prop.root) return;
    this.root.attach(candle);
    const from = candle.position.clone();
    const rot = candle.rotation.z;
    yield* tween(seconds, (k) => {
      candle.position.set(
        lerp(from.x, this.standX, k),
        lerp(from.y, GROUND + 0.185, k) + Math.sin(k * Math.PI) * arc,
        0.001,
      );
      candle.rotation.z = lerp(rot, 0, k);
    });
    this.prop.root.attach(candle);
    candle.position.set(0, 0.185, 0);
    candle.rotation.set(0, 0, 0);
  }

  /** Branch B: the rabbit hops up, the thief melts, hands the candle back, and waves. */
  private *befriend(spawn: Vector3): Script {
    const t = this.thief;
    const r = this.rabbit;
    yield* this.emerge(r, spawn);
    r.hopping = true;
    yield* this.walkTo(r, Math.min(t.root.position.x - 0.32, this.standX + 0.1), 0.5);
    r.hopping = false;
    r.facing = 1;
    t.sneaking = false;
    t.facing = -1;
    // A warm glow blooms between them.
    this.heart.position.set((r.root.position.x + t.root.position.x) / 2, GROUND + 0.55, 0.004);
    this.heart.visible = true;
    sfx.charm();
    const heartMat = this.heart.material as MeshBasicMaterial;
    yield* tween(1.2, (k) => {
      heartMat.opacity = Math.sin(k * Math.PI) * 0.9;
      this.heart.scale.setScalar(0.6 + k * 0.8);
    });
    this.heart.visible = false;
    // He gently sets the candle back.
    if (this.prop.candle.parent !== this.prop.root) {
      yield* tween(0.5, (k) => (t.arm.rotation.z = lerp(0.2, -0.3, k)));
      yield* this.returnCandle(0.9, 0.06);
    }
    // A friendly wave.
    yield* tween(1.4, (k) => (t.arm.rotation.z = 0.5 + Math.sin(k * Math.PI * 4) * 0.35));
    t.arm.rotation.z = 0;
    yield* tween(0.8, (k) => (this.glowBoost = 1 + k * 0.7));
    yield* wait(1.0);
    this.solved = true;
  }

  /** Branch A: the dog barks, the thief jumps, flings the candle back and flees. */
  private *scareOff(spawn: Vector3): Script {
    const t = this.thief;
    const d = this.dog;
    yield* this.emerge(d, spawn);
    yield* this.walkTo(d, Math.min(t.root.position.x - 0.6, 0.15), 1.0);
    d.facing = 1;
    t.facing = -1;
    for (let i = 0; i < 2; i++) {
      d.bark();
      sfx.bark();
      yield* wait(0.65);
    }
    // Startled jump.
    t.scared = true;
    t.sneaking = false;
    const y0 = t.root.position.y;
    yield* tween(0.35, (k) => (t.root.position.y = y0 + Math.sin(k * Math.PI) * 0.14));
    sfx.flee();
    // He flees while the candle is flung back onto its stand.
    yield* together(this.returnCandle(1.1, 0.25), this.walkTo(t, 2.0, 1.4, ease.in));
    t.fade(0);
    // The dog trots over and sits proudly by the candle.
    yield* this.walkTo(d, this.standX - 0.32, 0.6);
    d.facing = 1;
    yield* tween(0.8, (k) => (this.glowBoost = 1 + k * 0.7));
    yield* wait(1.2);
    this.solved = true;
  }
}

// ---------------------------------------------------------------------------
// Level 2 — The Chasm
// ---------------------------------------------------------------------------

/** Two cliffs with a jagged gap between them, reaching down to the floor. */
function makeCliffs(gapLeft: number, gapRight: number): Group {
  const bottom = GROUND - 1.4;
  const left = [-4, GROUND, gapLeft, GROUND];
  const right = [4, GROUND, 4, bottom, gapRight + 0.3, bottom];
  for (let i = 1; i <= 8; i++) {
    left.push(gapLeft - (i % 2 ? 0.035 : 0) - i * 0.015, GROUND - i * 0.17);
  }
  for (let i = 8; i >= 1; i--) {
    right.push(gapRight + (i % 2 ? 0.035 : 0) + i * 0.015, GROUND - i * 0.17);
  }
  left.push(gapLeft - 0.3, bottom, -4, bottom);
  right.push(gapRight, GROUND);
  const g = new Group();
  g.add(part([poly(left), poly(right)], shadowMaterial()));
  return g;
}

/** Upright post with an arm; the hook hangs `HOOK_ARM` to the right of it. */
const HOOK_ARM = 0.17;
const HOOK_Y = GROUND + 0.44;
function makePost(x: number): Group {
  const g = new Group();
  g.add(
    part(
      [
        poly([x - 0.015, GROUND, x + 0.015, GROUND, x + 0.012, GROUND + 0.5, x - 0.012, GROUND + 0.5]),
        capsule(x, GROUND + 0.48, x + HOOK_ARM, GROUND + 0.48, 0.022),
        capsule(x + HOOK_ARM, GROUND + 0.48, x + HOOK_ARM, HOOK_Y, 0.01),
        ellipse(x, GROUND + 0.005, 0.06, 0.014),
      ],
      shadowMaterial(),
    ),
  );
  return g;
}

export class ChasmLevel extends Level {
  readonly numeral = 'I';
  readonly title = 'The First Light';
  readonly subtitle = 'The Shadow Eater stole the light. Your hands hold the old magic.';
  get objective(): string {
    return 'Bring the lantern across the chasm  ·  BIRD or RABBIT';
  }
  override readonly hintDelay = 4;
  readonly solutions: readonly PoseId[] = ['bird', 'rabbit'];
  override readonly hintX = 0.08;

  private readonly bird = new Bird();
  private readonly rabbit = new Rabbit();
  private readonly gapLeft = -0.14;
  private readonly gapRight = 0.3;
  private readonly lantern = makeLantern();
  /** Lantern origin is its base; it hangs 0.165 m below the hook. */
  private readonly farHook = new Vector3(0.68 + HOOK_ARM, HOOK_Y - 0.165, 0.001);
  private readonly nearHook = new Vector3(-0.8 + HOOK_ARM, HOOK_Y - 0.165, 0.001);
  private glowBoost = 1;

  constructor(room: Room) {
    super(room);
    this.root.add(makeCliffs(this.gapLeft, this.gapRight), makePost(0.68), makePost(-0.8));
    this.root.add(this.lantern.root);
    this.add(this.bird, this.rabbit);
  }

  storyLine(): string {
    return this.outcome === 'rabbit'
      ? 'A rabbit leapt the chasm to keep the far light burning.'
      : 'A bird carried the lantern home across the chasm.';
  }

  /** Never land in the gap. */
  protected override landX(x: number): number {
    return x > this.gapLeft - 0.12 && x < this.gapRight + 0.12 ? this.gapLeft - 0.2 : x;
  }

  protected reset(): void {
    this.root.attach(this.lantern.root);
    this.lantern.root.position.copy(this.farHook);
    this.lantern.root.rotation.set(0, 0, 0);
    this.lantern.root.scale.setScalar(1);
    this.glowBoost = 1;
    this.bird.root.visible = false;
    this.bird.fade(0, true);
    this.bird.flapping = true;
    this.bird.onFlap = () => sfx.flap();
    this.rabbit.root.visible = false;
    this.rabbit.fade(0, true);
    this.rabbit.hopping = false;
  }

  protected tick(_dt: number, time: number): void {
    const l = this.lantern.root;
    if (l.parent === this.root) l.rotation.z = Math.sin(time * 1.3) * 0.06; // sway on its hook
    this.lantern.glowMesh.scale.setScalar(this.glowBoost * (1 + 0.07 * Math.sin(time * 8.3)));
  }

  protected solve(pose: PoseId, spawn: Vector3): Script {
    return pose === 'rabbit' ? this.leap(spawn) : this.fetch(spawn);
  }

  /** Branch B: a mighty leap across; the rabbit stays to tend the light over there. */
  private *leap(spawn: Vector3): Script {
    const r = this.rabbit;
    yield* this.emerge(r, spawn);
    r.hopping = true;
    yield* this.walkTo(r, this.gapLeft - 0.12, 0.5);
    r.hopping = false;
    r.facing = 1;
    yield* wait(0.5); // gathering courage...
    // ...and LEAP.
    sfx.flap();
    const x0 = r.root.position.x;
    const x1 = this.gapRight + 0.15;
    yield* tween(1.0, (k) => {
      r.root.position.x = lerp(x0, x1, k);
      r.root.position.y = GROUND + Math.sin(k * Math.PI) * 0.38;
    });
    sfx.dig(); // thump of landing
    r.hopping = true;
    yield* this.walkTo(r, this.farHook.x - 0.2, 0.45);
    r.hopping = false;
    r.facing = -1; // looks back at you across the chasm
    yield* tween(1.0, (k) => (this.glowBoost = 1 + k * 1.1));
    yield* wait(1.2);
    this.solved = true;
  }

  /** Branch A: the bird flies over and carries the lantern home. */
  private *fetch(spawn: Vector3): Script {
    const b = this.bird;
    const l = this.lantern.root;
    yield* this.emerge(b, spawn, false);
    yield* this.flyTo(this.bird, this.farHook.x - 0.02, this.farHook.y + 0.3, 1.8);
    yield* this.flyTo(this.bird, this.farHook.x, this.farHook.y + 0.2, 0.4);
    b.root.attach(l);
    l.rotation.z = 0;
    yield* wait(0.2);
    // Carry it back over the chasm, swinging from the bird's feet.
    yield* this.flyTo(this.bird, this.nearHook.x, this.nearHook.y + 0.2, 2.4);
    this.root.attach(l);
    const from = l.position.clone();
    yield* tween(0.35, (k) => {
      l.position.set(lerp(from.x, this.nearHook.x, k), lerp(from.y, this.nearHook.y, k), 0.001);
    });
    l.rotation.z = 0;
    // Perch on the post and let the lantern blaze.
    yield* this.flyTo(this.bird, this.nearHook.x - HOOK_ARM, GROUND + 0.5, 0.8);
    b.flapping = false;
    b.facing = 1;
    yield* tween(0.8, (k) => (this.glowBoost = 1 + k * 0.8));
    yield* wait(1.0);
    this.solved = true;
  }
}

// ---------------------------------------------------------------------------
// Level 3 — The Wall
// ---------------------------------------------------------------------------

/** A brick wall with real gaps between the bricks, so the lit wall shows through. */
function makeBrickWall(x0: number, x1: number, height: number): Group {
  const shapes = [];
  const rowH = 0.075;
  const gap = 0.012;
  const brickW = 0.13;
  const rows = Math.round(height / rowH);
  for (let r = 0; r < rows; r++) {
    const y = GROUND + r * rowH;
    for (let x = x0 - (r % 2 ? brickW / 2 : 0); x < x1; x += brickW) {
      const a = Math.max(x0, x);
      const b = Math.min(x1, x + brickW - gap);
      if (b - a > 0.02) shapes.push(poly([a, y, b, y, b, y + rowH - gap, a, y + rowH - gap]));
    }
  }
  const top = GROUND + rows * rowH;
  for (let x = x0; x < x1 - 0.02; x += 0.09) {
    const b = Math.min(x1, x + 0.055);
    shapes.push(poly([x, top - gap, b, top - gap, b, top + 0.06, x, top + 0.06]));
  }
  const g = new Group();
  g.add(part(shapes, shadowMaterial()));
  return g;
}

/** Run several scripts side by side until all finish. */
export function* together(...scripts: Script[]): Script {
  const done = scripts.map(() => false);
  for (const s of scripts) s.next(0);
  while (done.includes(false)) {
    const dt = yield;
    scripts.forEach((s, i) => {
      if (!done[i]) done[i] = !!s.next(dt).done;
    });
  }
}

export class WallLevel extends Level {
  readonly numeral = 'III';
  readonly title = 'The Underground Secret';
  readonly subtitle = 'Beneath the roots, a friend is trapped.';
  get objective(): string {
    return 'Free the kitten behind the wall  ·  RABBIT or BIRD';
  }
  readonly solutions: readonly PoseId[] = ['rabbit', 'bird'];
  override readonly hintX = -0.6;

  private readonly rabbit = new Rabbit();
  private readonly bird = new Bird();
  /** Top of the brick wall the kitten is trapped behind. */
  private readonly wallTop = GROUND + 0.75;
  private readonly kitten = new Kitten();
  private readonly moundNear: Mesh;
  private readonly moundFar: Mesh;
  private readonly dirt: Mesh[] = [];
  private readonly dirtVel: Vector3[] = [];
  private readonly nearX = 0.02;
  private readonly farX = 0.62;
  private mewTimer = 2;

  constructor(room: Room) {
    super(room);
    const m = shadowMaterial();
    this.root.add(makeBackdrop('forest'), makeGround(), makeBrickWall(0.2, 0.44, 0.75), makeBrickWall(1.18, 1.42, 0.75));
    this.moundNear = part([ellipse(0, 0, 0.11, 0.045)], m);
    this.moundFar = part([ellipse(0, 0, 0.11, 0.045)], m);
    this.moundNear.position.set(this.nearX - 0.1, GROUND, 0.001);
    this.moundFar.position.set(this.farX + 0.1, GROUND, 0.001);
    this.root.add(this.moundNear, this.moundFar);
    for (let i = 0; i < 10; i++) {
      const d = part([circle(0, 0, 0.012 + (i % 3) * 0.005)], m);
      d.visible = false;
      this.dirt.push(d);
      this.dirtVel.push(new Vector3());
      this.root.add(d);
    }
    this.add(this.kitten, this.rabbit, this.bird);
  }

  storyLine(): string {
    return this.outcome === 'bird'
      ? 'A bird showed the kitten the way over the wall.'
      : 'A rabbit dug a tunnel and set the kitten free.';
  }

  /** Creatures arrive on the near side of the wall. */
  protected override landX(x: number): number {
    return Math.min(x, 0.05);
  }

  protected reset(): void {
    this.kitten.root.position.set(0.85, GROUND, 0.002);
    this.kitten.placed();
    this.kitten.facing = -1;
    this.kitten.sad = true;
    this.kitten.fade(1, true);
    this.rabbit.root.visible = false;
    this.rabbit.fade(0, true);
    this.rabbit.hopping = false;
    this.rabbit.digging = false;
    this.rabbit.onScoop = () => this.scoop();
    this.bird.root.visible = false;
    this.bird.fade(0, true);
    this.bird.flapping = true;
    this.bird.onFlap = () => sfx.flap();
    this.moundNear.scale.setScalar(0.001);
    this.moundFar.scale.setScalar(0.001);
    for (const d of this.dirt) d.visible = false;
  }

  /** One paw-scoop: sound + a clod of earth flung backwards. */
  private scoop(): void {
    sfx.dig();
    this.moundNear.scale.setScalar(Math.min(1, this.moundNear.scale.x + 0.15));
    const i = this.dirt.findIndex((x) => !x.visible);
    if (i < 0) return;
    const r = this.rabbit.root.position;
    this.dirt[i].position.set(r.x + 0.05, GROUND + 0.04, 0.004);
    this.dirtVel[i].set(-0.4 - Math.random() * 0.4, 0.7 + Math.random() * 0.5, 0);
    this.dirt[i].visible = true;
  }

  protected tick(dt: number): void {
    for (let i = 0; i < this.dirt.length; i++) {
      const d = this.dirt[i];
      if (!d.visible) continue;
      const v = this.dirtVel[i];
      v.y -= 3 * dt;
      d.position.x += v.x * dt;
      d.position.y += v.y * dt;
      if (d.position.y < GROUND) d.visible = false;
    }
    // The trapped kitten mews now and then.
    if (this.kitten.sad && !this.busy) {
      this.mewTimer -= dt;
      if (this.mewTimer <= 0) {
        this.mewTimer = 4 + Math.random() * 3;
        sfx.mew(true);
      }
    }
  }

  /** Sink below (or rise from) the ground line; black-on-black hides the tunnel. */
  private *sink(c: Silhouette, down: boolean, seconds: number): Script {
    const from = down ? GROUND : GROUND - 0.32;
    const to = down ? GROUND - 0.32 : GROUND;
    yield* tween(seconds, (k) => (c.root.position.y = lerp(from, to, down ? ease.in(k) : ease.out(k))));
  }

  protected solve(pose: PoseId, spawn: Vector3): Script {
    return pose === 'bird' ? this.guide(spawn) : this.tunnel(spawn);
  }

  /** Branch B: the bird perches on the wall and coaxes the kitten up and over. */
  private *guide(spawn: Vector3): Script {
    const b = this.bird;
    const k = this.kitten;
    yield* this.emerge(b, spawn, false);
    yield* this.flyTo(b, 0.33, this.wallTop + 0.05, 1.5);
    b.flapping = false;
    b.facing = 1;
    sfx.chirp();
    yield* wait(0.6);
    k.sad = false;
    sfx.mew(false);
    yield* this.walkTo(k, 0.56, 0.35);
    yield* this.jumpTo(k, 0.36, this.wallTop - 0.01, 0.6, 0.12);
    yield* wait(0.5);
    // The bird flutters down; the kitten follows.
    b.flapping = true;
    sfx.chirp();
    yield* this.flyTo(b, -0.4, GROUND, 0.9);
    b.flapping = false;
    yield* this.jumpTo(k, 0.04, GROUND, 0.7, 0.08);
    yield* this.walkTo(k, -0.15, 0.35);
    k.facing = -1;
    sfx.mew(false);
    yield* wait(1.2);
    this.solved = true;
  }

  /** Branch A: the rabbit digs under the wall and leads the kitten out. */
  private *tunnel(spawn: Vector3): Script {
    const r = this.rabbit;
    const k = this.kitten;
    yield* this.emerge(r, spawn);
    r.hopping = true;
    yield* this.walkTo(r, this.nearX, 0.55);
    r.hopping = false;
    r.facing = 1;
    // Dig down beside the wall...
    r.digging = true;
    yield* wait(1.4);
    yield* this.sink(r, true, 1.0);
    r.digging = false;
    yield* wait(0.5);
    // ...and pop up on the far side.
    r.root.position.x = this.farX;
    r.placed();
    yield* tween(0.4, (t) => this.moundFar.scale.setScalar(Math.max(0.001, t)));
    yield* this.sink(r, false, 0.5);
    k.sad = false;
    sfx.mew(false);
    yield* this.walkTo(k, this.farX + 0.2, 0.4);
    yield* wait(0.5);
    // Both slip into the tunnel and come out free.
    r.facing = -1;
    yield* this.sink(r, true, 0.5);
    yield* this.walkTo(k, this.farX, 0.3);
    yield* this.sink(k, true, 0.6);
    yield* wait(0.5);
    r.root.position.x = this.nearX - 0.08;
    k.root.position.x = this.nearX + 0.06;
    r.placed();
    k.placed();
    yield* together(this.sink(r, false, 0.45), this.sink(k, false, 0.6));
    sfx.mew(false);
    r.hopping = true;
    yield* together(this.walkTo(k, -0.45, 0.4), this.walkTo(r, -0.72, 0.55));
    r.hopping = false;
    r.facing = 1;
    k.facing = 1;
    yield* wait(1.2);
    this.solved = true;
  }
}

// ---------------------------------------------------------------------------
// Finale — everyone gathers in the candlelight
// ---------------------------------------------------------------------------

export class Finale {
  readonly root = new Group();
  private readonly dog = new Dog();
  private readonly bird = new Bird();
  private readonly rabbit = new Rabbit();
  private readonly kitten = new Kitten();
  /** Only joins the circle if the rabbit befriended him in chapter I. */
  private readonly thief = new Thief();
  private readonly snake = new Snake();
  /** The legendary Shadow Dragon, awakened by the Shadow Eater's defeat. */
  private readonly dragon = new Dragon();
  private readonly actors: Silhouette[] = [this.dog, this.bird, this.rabbit, this.kitten, this.thief, this.snake, this.dragon];
  private t = 0;

  constructor() {
    this.root.position.z = STAGE.z;
    this.root.visible = false;
    this.root.add(makeGround());
    for (const a of this.actors) this.root.add(a.root);
  }

  show(thiefIsFriend: boolean): void {
    this.t = 0;
    this.root.visible = true;
    this.thief.root.position.set(-2.0, GROUND, 0.001);
    this.snake.root.position.set(2.0, GROUND, 0.002);
    this.dragon.root.position.set(-2.6, GROUND + 1.25, 0.004);
    this.dog.root.position.set(-1.6, GROUND, 0.002);
    this.rabbit.root.position.set(1.6, GROUND, 0.002);
    this.kitten.root.position.set(1.8, GROUND, 0.002);
    this.bird.root.position.set(-1.2, GROUND + 1.12, 0.003);
    for (const a of this.actors) {
      a.placed();
      a.fade(1, true);
      a.root.visible = true;
    }
    this.bird.flapping = true;
    this.thief.fade(thiefIsFriend ? 1 : 0, true);
    this.thief.sneaking = false;
  }

  hide(): void {
    this.root.visible = false;
  }

  update(dt: number, time: number): void {
    if (!this.root.visible) return;
    this.t += dt;
    const k = ease.out(Math.min(1, this.t / 2.5));
    this.dog.root.position.x = lerp(-1.6, -1.22, k);
    this.dog.facing = 1;
    this.rabbit.root.position.x = lerp(1.6, 1.08, k);
    this.rabbit.facing = -1;
    this.rabbit.hopping = k < 1 || Math.sin(time * 1.5) > 0.6;
    this.kitten.root.position.x = lerp(1.8, 1.38, k);
    this.thief.root.position.x = lerp(-2.0, -1.68, k);
    this.thief.facing = 1;
    this.snake.root.position.x = lerp(2.0, 1.75, k);
    this.snake.facing = -1;
    this.snake.rear = 0.6 + 0.2 * Math.sin(time * 1.3);
    // The dragon sweeps across the sky in a slow loop.
    const loop = (this.t * 0.42) % 5.6;
    this.dragon.root.position.x = -2.6 + loop;
    this.dragon.root.position.y = GROUND + 1.16 + Math.sin(this.t * 0.9) * 0.06;
    this.dragon.facing = 1;
    this.kitten.facing = -1;
    this.kitten.sad = false;
    // The bird circles above everyone.
    const a = time * 0.9;
    this.bird.root.position.x = lerp(-1.2, Math.cos(a) * 0.95, k);
    this.bird.root.position.y = GROUND + 1.12 + Math.sin(a * 2) * 0.06;
    this.bird.facing = Math.sin(a) > 0 ? -1 : 1;
    for (const actor of this.actors) actor.update(dt, time);
  }
}
