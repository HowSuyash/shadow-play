import { Group, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { capsule, circle, ellipse, glow, part, pivot, poly, shadowMaterial, withHole } from './shapes.js';

/**
 * Shadow-world characters. Each is a 2D Group in the wall plane, origin at
 * its feet, authored facing +X. `facing = -1` mirrors it. One material per
 * character so it can fade as a whole.
 */
export abstract class Silhouette {
  readonly root = new Group();
  protected readonly mat: MeshBasicMaterial = shadowMaterial();
  /** Distance-driven gait phase, so feet never slide. */
  protected stride = 0;
  private lastX = 0;
  private opacity = 1;
  private targetOpacity = 1;
  /** Extra uniform scale for "peel off the wall" births. */
  grow = 1;
  /** Size multiplier: giant co-op duet creatures. */
  boost = 1;
  protected readonly baseScale: number;

  constructor(scale = 1) {
    this.baseScale = scale;
    this.root.scale.setScalar(scale);
  }

  set facing(dir: 1 | -1) {
    this.root.scale.x = Math.abs(this.root.scale.x) * dir;
  }

  get facing(): 1 | -1 {
    return this.root.scale.x < 0 ? -1 : 1;
  }

  fade(to: number, instant = false): void {
    this.targetOpacity = to;
    if (instant) this.opacity = to;
  }

  update(dt: number, time: number): void {
    const dx = this.root.position.x - this.lastX;
    this.lastX = this.root.position.x;
    this.stride += Math.abs(dx) / (0.12 * this.baseScale);
    this.opacity += Math.max(-dt * 2, Math.min(dt * 2, this.targetOpacity - this.opacity));
    this.mat.opacity = this.opacity;
    this.root.visible = this.opacity > 0.01;
    const s = this.baseScale * this.grow * this.boost;
    this.root.scale.set(s * this.facing, s, s);
    this.animate(dt, time, Math.abs(dx) / Math.max(dt, 1e-4));
  }

  /** Reset gait tracking after a teleport. */
  placed(): void {
    this.lastX = this.root.position.x;
  }

  protected abstract animate(dt: number, time: number, speed: number): void;
}

// ---------------------------------------------------------------------------

export class Dog extends Silhouette {
  private readonly body: Group;
  private readonly head: Group;
  private readonly jaw: Group;
  private readonly tail: Group;
  private readonly legs: Group[] = [];
  private barkT = 1;
  /** Arcs that radiate from the mouth on a bark. */
  private readonly waves: Mesh[] = [];

  constructor() {
    super(1.15);
    const m = this.mat;
    this.body = new Group();
    this.body.add(
      part(
        [
          ellipse(0, 0.2, 0.17, 0.072),
          ellipse(0.11, 0.21, 0.085, 0.08),
          ellipse(-0.12, 0.21, 0.07, 0.068),
          capsule(0.13, 0.23, 0.2, 0.31, 0.075),
        ],
        m,
      ),
    );
    this.jaw = pivot(0.03, -0.012, part([capsule(0, 0, 0.1, -0.014, 0.03)], m));
    this.head = pivot(
      0.2,
      0.32,
      part(
        [
          withHole(ellipse(0.02, 0.03, 0.066, 0.056), 0.045, 0.045, 0.012, 0.009),
          capsule(0.04, 0.012, 0.135, 0.004, 0.05),
          poly([-0.035, 0.065, 0.03, 0.078, -0.04, 0.16]),
        ],
        m,
      ),
    );
    this.head.add(this.jaw);
    this.tail = pivot(-0.17, 0.23, part([capsule(0, 0, -0.1, 0.09, 0.026)], m));
    for (const x of [0.13, 0.08, -0.15, -0.1]) {
      const leg = pivot(
        x,
        0.18,
        part([capsule(0, 0, 0, -0.17, 0.036), ellipse(0.014, -0.172, 0.024, 0.012)], m),
      );
      this.legs.push(leg);
      this.body.add(leg);
    }
    this.body.add(this.head, this.tail);
    this.root.add(this.body);
    for (let i = 0; i < 3; i++) {
      const arc = part([capsule(0, -0.05, 0.012, 0, 0.016), capsule(0.012, 0, 0, 0.05, 0.016)], m);
      arc.visible = false;
      this.waves.push(arc);
      this.root.add(arc);
    }
  }

  bark(): void {
    this.barkT = 0;
  }

  protected animate(dt: number, time: number, speed: number): void {
    const moving = speed > 0.05;
    const ph = this.stride * Math.PI;
    const swing = moving ? 0.6 : 0;
    this.legs[0].rotation.z = Math.sin(ph) * swing;
    this.legs[1].rotation.z = Math.sin(ph + Math.PI) * swing;
    this.legs[2].rotation.z = Math.sin(ph + Math.PI) * swing;
    this.legs[3].rotation.z = Math.sin(ph) * swing;
    // Run cycle as squash/stretch + bob; idle breathing otherwise.
    this.body.position.y = moving ? Math.abs(Math.sin(ph)) * 0.025 : Math.sin(time * 2.2) * 0.004;
    this.body.scale.set(1 + (moving ? 0.05 * Math.sin(ph * 2) : 0), 1 - (moving ? 0.05 * Math.sin(ph * 2) : 0), 1);
    this.tail.rotation.z = Math.sin(time * (moving ? 18 : 9)) * 0.35;

    this.barkT = Math.min(1, this.barkT + dt / 0.55);
    const b = this.barkT < 1 ? Math.sin(this.barkT * Math.PI * 2) : 0;
    this.jaw.rotation.z = -Math.max(0, b) * 0.6;
    this.head.rotation.z = Math.max(0, b) * 0.18;
    this.waves.forEach((w, i) => {
      const k = this.barkT * 1.6 - i * 0.2;
      w.visible = this.barkT < 1 && k > 0 && k < 1;
      w.position.set(0.37 + k * 0.25, 0.33 + k * 0.03, 0);
      w.scale.setScalar(0.6 + k * 1.2);
    });
  }
}

// ---------------------------------------------------------------------------

export class Bird extends Silhouette {
  private readonly wingNear: Group;
  private readonly wingFar: Group;
  private readonly bodyGroup: Group;
  private readonly feet: Mesh;
  flapping = true;
  private flapPhase = 0;
  /** Called on every downstroke (for the flap sound). */
  onFlap: (() => void) | undefined;

  constructor() {
    super(1.3);
    const m = this.mat;
    this.bodyGroup = new Group();
    this.bodyGroup.add(
      part(
        [
          ellipse(0, 0, 0.1, 0.045, 0.12),
          withHole(circle(0.1, 0.035, 0.04), 0.112, 0.045, 0.007),
          poly([0.13, 0.05, 0.195, 0.032, 0.13, 0.02]),
          poly([-0.07, 0.0, -0.2, 0.05, -0.19, -0.035]),
        ],
        m,
      ),
    );
    const wing = () =>
      part([poly([0, 0, -0.05, 0.17, -0.12, 0.215, -0.17, 0.2, -0.12, 0.14, -0.17, 0.13, -0.11, 0.08, -0.13, 0.05])], m);
    this.wingFar = pivot(0.02, 0.02, wing());
    this.wingFar.position.x = 0.04;
    this.wingNear = pivot(0.0, 0.02, wing());
    this.feet = part([capsule(-0.01, -0.03, -0.02, -0.075, 0.012), capsule(0.02, -0.03, 0.015, -0.075, 0.012)], m);
    this.bodyGroup.add(this.wingFar, this.wingNear, this.feet);
    this.root.add(this.bodyGroup);
  }

  protected animate(dt: number, time: number): void {
    if (this.flapping) {
      const prev = Math.sin(this.flapPhase);
      this.flapPhase += dt * 13;
      const s = Math.sin(this.flapPhase);
      if (prev > 0 && s <= 0) this.onFlap?.();
      // Wing "rotates" about the shoulder axis: scale.y sweeps through 0.
      this.wingNear.scale.y = 0.15 + 0.95 * s;
      this.wingFar.scale.y = 0.1 + 0.8 * Math.sin(this.flapPhase - 0.4);
      this.bodyGroup.position.y = -s * 0.012;
      this.feet.visible = false;
    } else {
      this.wingNear.scale.y = 0.35 + 0.03 * Math.sin(time * 3);
      this.wingFar.scale.y = 0.3;
      this.bodyGroup.position.y = 0.075;
      this.feet.visible = true;
    }
  }
}

// ---------------------------------------------------------------------------

export class Rabbit extends Silhouette {
  private readonly body: Group;
  private readonly ears: Group;
  private readonly paw: Group;
  hopping = false;
  digging = false;
  private hopPhase = 0;
  /** Called each time the front paws scoop (for the dig sound + dirt). */
  onScoop: (() => void) | undefined;

  constructor() {
    super(1.25);
    const m = this.mat;
    this.body = new Group();
    this.ears = pivot(
      0.1,
      0.23,
      part([capsule(0, 0, -0.035, 0.17, 0.038), capsule(0.025, 0, 0.04, 0.165, 0.036)], m),
    );
    this.paw = pivot(0.08, 0.07, part([capsule(0, 0, 0.025, -0.07, 0.032)], m));
    this.body.add(
      part(
        [
          ellipse(0, 0.1, 0.12, 0.088),
          withHole(ellipse(0.11, 0.19, 0.066, 0.056, -0.2), 0.135, 0.205, 0.011, 0.009),
          circle(-0.12, 0.13, 0.032),
          ellipse(-0.05, 0.035, 0.085, 0.038),
        ],
        m,
      ),
      this.ears,
      this.paw,
    );
    this.root.add(this.body);
  }

  protected animate(dt: number, time: number): void {
    this.ears.rotation.z = Math.sin(time * 3.1) * 0.06;
    if (this.digging) {
      const prev = Math.sin(this.hopPhase);
      this.hopPhase += dt * 16;
      const s = Math.sin(this.hopPhase);
      if (prev < 0 && s >= 0) this.onScoop?.();
      this.paw.rotation.z = -0.9 + s * 0.8;
      this.body.rotation.z = -0.35;
      this.body.position.y = 0;
    } else if (this.hopping) {
      this.hopPhase += dt * 9;
      const s = Math.abs(Math.sin(this.hopPhase));
      this.body.position.y = s * 0.09;
      this.body.scale.set(1 - s * 0.06, 1 + s * 0.1, 1);
      this.body.rotation.z = Math.cos(this.hopPhase) * 0.12;
      this.paw.rotation.z = 0.3;
    } else {
      this.body.position.y = 0;
      this.body.scale.set(1, 1 + Math.sin(time * 2.5) * 0.01, 1);
      this.body.rotation.z = 0;
      this.paw.rotation.z = 0;
    }
  }
}

// ---------------------------------------------------------------------------

/** Hunched, hooded candle thief with a loot sack. */
export class Thief extends Silhouette {
  private readonly legs: Group[] = [];
  private readonly torso: Group;
  /** Reaching arm; hold things at `hand`. */
  readonly arm: Group;
  readonly hand = new Group();
  sneaking = false;
  scared = false;

  constructor() {
    super(1.05);
    const m = this.mat;
    for (const x of [-0.025, 0.025]) {
      const leg = pivot(x, 0.3, part([capsule(0, 0, 0, -0.285, 0.048), ellipse(0.03, -0.29, 0.045, 0.016)], m));
      this.legs.push(leg);
      this.root.add(leg);
    }
    this.arm = pivot(0.075, 0.47, part([capsule(0, 0, 0.14, -0.06, 0.036), circle(0.145, -0.062, 0.024)], m));
    this.hand.position.set(0.15, -0.06, 0);
    this.arm.add(this.hand);
    this.torso = new Group();
    this.torso.add(
      part(
        [
          capsule(0, 0.3, 0.065, 0.5, 0.14),
          withHole(circle(0.11, 0.585, 0.058), 0.14, 0.592, 0.011, 0.008),
          poly([0.05, 0.605, 0.165, 0.615, -0.02, 0.72]), // floppy hood
          poly([0.165, 0.585, 0.19, 0.57, 0.16, 0.565]), // nose
          ellipse(-0.08, 0.52, 0.095, 0.085), // sack
          capsule(-0.02, 0.6, 0.0, 0.56, 0.03),
          capsule(0.03, 0.47, -0.05, 0.55, 0.036), // arm holding the sack
        ],
        m,
      ),
      this.arm,
    );
    this.root.add(this.torso);
  }

  protected animate(_dt: number, time: number, speed: number): void {
    const moving = speed > 0.02;
    const ph = this.stride * Math.PI;
    const swing = moving ? (this.scared ? 0.8 : 0.45) : 0;
    this.legs[0].rotation.z = Math.sin(ph) * swing;
    this.legs[1].rotation.z = -Math.sin(ph) * swing;
    // Exaggerated tiptoe bob while sneaking.
    const bob = moving ? Math.abs(Math.sin(ph)) * (this.sneaking ? 0.03 : 0.015) : 0;
    this.torso.position.y = bob;
    this.torso.rotation.z = this.scared ? 0.25 : this.sneaking ? -0.08 + Math.sin(time * 1.5) * 0.03 : 0;
  }
}

// ---------------------------------------------------------------------------

/** The trapped friend in level 3: a small kitten. */
export class Kitten extends Silhouette {
  private readonly tail: Group;
  private readonly legs: Group[] = [];
  private readonly body: Group;
  sad = true;

  constructor() {
    super(1.1);
    const m = this.mat;
    this.body = new Group();
    for (const x of [0.06, -0.06]) {
      const leg = pivot(x, 0.07, part([capsule(0, 0, 0, -0.07, 0.026)], m));
      this.legs.push(leg);
      this.body.add(leg);
    }
    this.tail = pivot(-0.085, 0.1, part([capsule(0, 0, -0.05, 0.06, 0.022), capsule(-0.05, 0.06, -0.035, 0.12, 0.02)], m));
    this.body.add(
      part(
        [
          ellipse(0, 0.1, 0.095, 0.05),
          withHole(circle(0.095, 0.16, 0.048), 0.115, 0.168, 0.009),
          poly([0.06, 0.19, 0.07, 0.25, 0.1, 0.2]),
          poly([0.1, 0.2, 0.13, 0.245, 0.135, 0.185]),
        ],
        m,
      ),
      this.tail,
    );
    this.root.add(this.body);
  }

  protected animate(_dt: number, time: number, speed: number): void {
    const moving = speed > 0.03;
    const ph = this.stride * Math.PI;
    this.legs[0].rotation.z = moving ? Math.sin(ph) * 0.6 : 0;
    this.legs[1].rotation.z = moving ? -Math.sin(ph) * 0.6 : 0;
    this.tail.rotation.z = this.sad ? -0.9 + Math.sin(time * 1.2) * 0.05 : Math.sin(time * 6) * 0.3;
    this.body.position.y = moving ? Math.abs(Math.sin(ph)) * 0.015 : 0;
    this.body.rotation.z = this.sad ? -0.08 : 0;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** A candle (with a real warm glow) on a little stand. `candle` can be carried off. */
export function makeCandleProp(): { root: Group; candle: Group; glowMesh: Mesh } {
  const m = shadowMaterial();
  const root = new Group();
  root.add(
    part(
      [
        capsule(-0.11, 0.17, 0.11, 0.17, 0.028),
        poly([-0.022, 0.0, 0.022, 0.0, 0.016, 0.17, -0.016, 0.17]),
        ellipse(0, 0.012, 0.075, 0.016),
      ],
      m,
    ),
  );
  const candle = new Group();
  candle.position.set(0, 0.185, 0);
  candle.add(part([ellipse(0, 0, 0.05, 0.013), poly([-0.017, 0, 0.017, 0, 0.016, 0.1, -0.016, 0.1])], m));
  const glowMesh = glow(0.2);
  glowMesh.position.set(0, 0.125, 0.001);
  const flame = glow(0.05, 1);
  flame.scale.y = 1.8;
  flame.position.set(0, 0.12, 0.002);
  candle.add(glowMesh, flame);
  root.add(candle);
  return { root, candle, glowMesh };
}

/** A hanging lantern with a warm glow. */
export function makeLantern(): { root: Group; glowMesh: Mesh } {
  const m = shadowMaterial();
  const root = new Group();
  root.add(
    part(
      [
        poly([-0.045, 0, 0.045, 0, 0.035, 0.012, -0.035, 0.012]),
        poly([-0.04, 0.012, -0.03, 0.012, -0.03, 0.1, -0.04, 0.1]),
        poly([0.03, 0.012, 0.04, 0.012, 0.04, 0.1, 0.03, 0.1]),
        poly([-0.05, 0.1, 0.05, 0.1, 0.0, 0.135]),
        capsule(-0.02, 0.135, 0.0, 0.165, 0.008),
        capsule(0.0, 0.165, 0.02, 0.135, 0.008),
      ],
      m,
    ),
  );
  const glowMesh = glow(0.24);
  glowMesh.position.set(0, 0.055, 0.001);
  const core = glow(0.06, 1);
  core.position.set(0, 0.055, 0.002);
  root.add(glowMesh, core);
  return { root, glowMesh };
}
