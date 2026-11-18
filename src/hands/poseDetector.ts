import { Vector3 } from '@iwsdk/core';
import { FINGERS, J, type HandData } from './handData.js';

// ---------------------------------------------------------------------------
// Hand features
// ---------------------------------------------------------------------------

export const FINGER_LABELS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;

/** Geometric summary of one hand, recomputed every frame without allocation. */
export class HandFeatures {
  tracked = false;
  /** 0 = straight, 1 = fully curled. Thumb first. */
  readonly curl = new Float32Array(5);
  /** Unit direction proximal joint → tip, per finger. */
  readonly dir = Array.from({ length: 5 }, () => new Vector3());
  /** Unit normal pointing out of the palm. */
  readonly palmNormal = new Vector3();
  readonly palmCenter = new Vector3();
  /** Thumb tip ↔ index tip distance (metres). */
  pinchDist = 1;
  /** Mean curl of the four fingers (excluding thumb). */
  fingersCurl = 0;

  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(readonly hand: HandData) {}

  update(): void {
    const h = this.hand;
    this.tracked = h.tracked;
    if (!h.tracked) return;
    const j = h.joints;

    for (let f = 0; f < 5; f++) {
      const chain = FINGERS[f];
      const mc = j[chain[0]];
      const prox = j[chain[1]];
      const tip = j[chain[chain.length - 1]];
      // Spec: angle between metacarpal→proximal and proximal→tip.
      this.a.subVectors(prox, mc);
      this.b.subVectors(tip, prox);
      const deg = angleDeg(this.a, this.b);
      this.curl[f] = f === 0 ? clamp01((deg - 10) / 50) : clamp01((deg - 20) / 100);
      this.dir[f].copy(this.b).normalize();
    }
    this.fingersCurl = (this.curl[1] + this.curl[2] + this.curl[3] + this.curl[4]) / 4;

    // Palm normal from the knuckle row; mirrored for the left hand.
    this.a.subVectors(j[J.INDEX_PROX], j[J.WRIST]);
    this.b.subVectors(j[J.PINKY_PROX], j[J.WRIST]);
    this.palmNormal.crossVectors(this.a, this.b).normalize();
    if (h.handedness === 'left') this.palmNormal.negate();

    this.palmCenter
      .copy(j[J.WRIST])
      .add(j[J.INDEX_PROX])
      .add(j[J.MIDDLE_PROX])
      .add(j[J.PINKY_PROX])
      .multiplyScalar(0.25);
    this.pinchDist = j[J.THUMB_TIP].distanceTo(j[J.INDEX_TIP]);
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers: every rule is a soft 0..1 ramp so poses are forgiving.
// ---------------------------------------------------------------------------

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function angleDeg(a: Vector3, b: Vector3): number {
  const d = a.length() * b.length();
  if (d < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, a.dot(b) / d))) * 180) / Math.PI;
}

/** 1 when x ≤ good, 0 when x ≥ bad. */
export function low(x: number, good: number, bad: number): number {
  return clamp01((bad - x) / (bad - good));
}

/** 1 when x ≥ good, 0 when x ≤ bad. */
export function high(x: number, bad: number, good: number): number {
  return clamp01((x - bad) / (good - bad));
}

/** Geometric mean: one failed rule sinks the pose, many near-misses don't. */
function combine(...scores: number[]): number {
  let p = 1;
  for (const s of scores) p *= Math.max(s, 0);
  return Math.pow(p, 1 / scores.length);
}


// ---------------------------------------------------------------------------
// Creature poses — a small registry so new creatures are one entry each.
// ---------------------------------------------------------------------------

export type PoseId = 'dog' | 'bird' | 'rabbit' | 'snake';

/**
 * Tunables, exported so they can be adjusted (e.g. from the debug overlay or
 * a calibration step) without touching the rules.
 */
export const POSE_CONFIG = {
  /** Confidence above which the hold timer runs. */
  threshold: 0.6,
  /** Seconds a pose must be held. */
  holdSeconds: 1.0,
  /** Bonus the pose that's already charging gets when ranking, so it doesn't flicker to a neighbour. */
  stickiness: 0.08,
};

/** Kept for existing imports. */
export const POSE_THRESHOLD = POSE_CONFIG.threshold;
export const HOLD_SECONDS = POSE_CONFIG.holdSeconds;

/**
 * DOG — one flat hand, fingers together and extended; thumb raised (ear);
 * pinky dropped (jaw).
 */
export function dogScore(f: HandFeatures): number {
  if (!f.tracked) return 0;
  const extended = combine(
    low(f.curl[1], 0.35, 0.7),
    low(f.curl[2], 0.35, 0.7),
    low(f.curl[3], 0.45, 0.85),
  );
  const together = low(angleDeg(f.dir[1], f.dir[3]), 22, 42);
  const thumbUp = combine(high(angleDeg(f.dir[0], f.dir[1]), 18, 38), low(f.curl[0], 0.6, 0.95));
  const pinkyDrop = Math.max(
    high(angleDeg(f.dir[4], f.dir[3]), 14, 32),
    high(f.curl[4] - f.curl[3], 0.12, 0.35),
  );
  return combine(extended, together, thumbUp, pinkyDrop);
}

/**
 * RABBIT — one hand, index + middle up (ears), ring + pinky curled
 * against the thumb (face).
 */
export function rabbitScore(f: HandFeatures): number {
  if (!f.tracked) return 0;
  return combine(
    low(f.curl[1], 0.35, 0.65),
    low(f.curl[2], 0.35, 0.65),
    high(f.curl[3], 0.3, 0.6),
    high(f.curl[4], 0.3, 0.6),
  );
}

/**
 * SNAKE — one hand like a cobra's head: all four fingers straight and
 * pressed together, thumb tucked flat against the side of the hand (the
 * closed mouth). Differs from DOG (thumb raised, pinky dropped) and from an
 * open palm (fingers spread).
 */
export function snakeScore(f: HandFeatures): number {
  if (!f.tracked) return 0;
  const j = f.hand.joints;
  const tip = j[J.THUMB_TIP];
  const tuck = Math.min(tip.distanceTo(j[J.INDEX_PROX]), tip.distanceTo(j[J.INDEX_PROX + 1]), tip.distanceTo(j[J.MIDDLE_PROX]));
  return combine(
    low(f.curl[1], 0.35, 0.7),
    low(f.curl[2], 0.35, 0.7),
    low(f.curl[3], 0.4, 0.75),
    low(f.curl[4], 0.4, 0.75),
    low(angleDeg(f.dir[1], f.dir[4]), 16, 32), // fingers together
    low(angleDeg(f.dir[4], f.dir[3]), 14, 28), // pinky not dropped
    low(tuck, 0.04, 0.07), // thumb tucked in
  );
}

/**
 * BIRD — both hands, fingers spread as wings, thumbs hooked together.
 * We accept any thumb joint of one hand near any thumb joint of the other.
 */
export function birdScore(l: HandFeatures, r: HandFeatures): number {
  if (!l.tracked || !r.tracked) return 0;
  const lj = l.hand.joints;
  const rj = r.hand.joints;
  let minThumb = Infinity;
  for (let i = J.THUMB_PROX; i <= J.THUMB_TIP; i++) {
    for (let k = J.THUMB_PROX; k <= J.THUMB_TIP; k++) {
      minThumb = Math.min(minThumb, lj[i].distanceTo(rj[k]));
    }
  }
  const wrists = lj[J.WRIST].distanceTo(rj[J.WRIST]);
  return combine(
    low(l.fingersCurl, 0.35, 0.6),
    low(r.fingersCurl, 0.35, 0.6),
    low(minThumb, 0.04, 0.08),
    low(wrists, 0.2, 0.32),
  );
}

/** A creature's hand-shape rule: either one hand (best of left/right) or both hands together. */
export type PoseDefinition =
  | { id: PoseId; hands: 'one'; score: (f: HandFeatures) => number }
  | { id: PoseId; hands: 'two'; score: (l: HandFeatures, r: HandFeatures) => number };

/** Add a creature here (plus its silhouette) and every system picks it up. */
export const POSE_DEFS: readonly PoseDefinition[] = [
  { id: 'dog', hands: 'one', score: dogScore },
  { id: 'bird', hands: 'two', score: birdScore },
  { id: 'rabbit', hands: 'one', score: rabbitScore },
  { id: 'snake', hands: 'one', score: snakeScore },
];
export const POSES: readonly PoseId[] = POSE_DEFS.map((d) => d.id);

// ---------------------------------------------------------------------------
// Hold-to-trigger
// ---------------------------------------------------------------------------

/**
 * Charges while `active`, drains twice as fast when not. Fires once on
 * reaching 1, then must fully drain (pose released) before it can fire again.
 */
export class HoldTimer {
  progress = 0;
  private armed = true;

  constructor(private readonly seconds = POSE_CONFIG.holdSeconds) {}

  update(dt: number, active: boolean): boolean {
    if (active && this.armed) {
      this.progress = Math.min(1, this.progress + dt / this.seconds);
      if (this.progress >= 1) {
        this.armed = false;
        return true;
      }
    } else {
      this.progress = Math.max(0, this.progress - (2 * dt) / this.seconds);
      if (!active && this.progress === 0) this.armed = true;
    }
    return false;
  }

  reset(): void {
    this.progress = 0;
    this.armed = true;
  }
}

export interface PoseResult {
  /** Pose currently charging (highest progress), if any. */
  charging: PoseId | null;
  progress: number;
  /** Fired this frame. */
  triggered: PoseId | null;
  /** Room-local point the pose's shadow comes from (palm centre / between palms). */
  readonly anchor: Vector3;
}

const tmpA = new Vector3();

/** Evaluates every registered creature pose each frame and runs their hold timers. */
export class PoseDetector {
  readonly left: HandFeatures;
  readonly right: HandFeatures;
  readonly confidence = {} as Record<PoseId, number>;
  readonly result: PoseResult = { charging: null, progress: 0, triggered: null, anchor: new Vector3() };

  private readonly timers = {} as Record<PoseId, HoldTimer>;
  private readonly anchors = {} as Record<PoseId, Vector3>;
  /** The pose that charged last frame (gets the hysteresis bonus). */
  private sticky: PoseId | null = null;

  constructor(left: HandData, right: HandData) {
    this.left = new HandFeatures(left);
    this.right = new HandFeatures(right);
    for (const p of POSES) {
      this.confidence[p] = 0;
      this.timers[p] = new HoldTimer();
      this.anchors[p] = new Vector3();
    }
  }

  /** Recompute features. Call once per frame before anything reads them. */
  updateFeatures(): void {
    this.left.update();
    this.right.update();
  }

  /** @param enabled whether creature poses may charge right now (not paused, not mid-cutscene). */
  update(dt: number, enabled: boolean): PoseResult {
    const L = this.left;
    const R = this.right;
    for (const def of POSE_DEFS) {
      if (def.hands === 'one') {
        const l = def.score(L);
        const r = def.score(R);
        this.confidence[def.id] = Math.max(l, r);
        this.anchors[def.id].copy(l >= r ? L.palmCenter : R.palmCenter);
      } else {
        this.confidence[def.id] = def.score(L, R);
        this.anchors[def.id].copy(tmpA.addVectors(L.palmCenter, R.palmCenter).multiplyScalar(0.5));
      }
    }

    const res = this.result;
    res.triggered = null;
    res.charging = null;
    res.progress = 0;
    // Only the most confident pose may charge, so overlapping shapes never race;
    // the one already charging gets a small bonus (hysteresis).
    let best: PoseId | null = null;
    let bestScore = 0;
    for (const p of POSES) {
      const c = this.confidence[p];
      if (c <= POSE_CONFIG.threshold) continue;
      const ranked = c + (p === this.sticky ? POSE_CONFIG.stickiness : 0);
      if (ranked > bestScore) {
        best = p;
        bestScore = ranked;
      }
    }
    for (const p of POSES) {
      const fired = this.timers[p].update(dt, enabled && p === best);
      if (fired) res.triggered = p;
      if (this.timers[p].progress > res.progress) {
        res.progress = this.timers[p].progress;
        res.charging = p;
      }
    }
    this.sticky = best;
    if (res.charging) res.anchor.copy(this.anchors[res.charging]);
    return res;
  }

  reset(): void {
    for (const p of POSES) this.timers[p].reset();
  }
}
