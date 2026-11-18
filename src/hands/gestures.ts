import { Vector3 } from '@iwsdk/core';
import { J } from './handData.js';
import { high, HoldTimer, low, type HandFeatures } from './poseDetector.js';

const UP = new Vector3(0, 1, 0);
/** The wall is straight ahead (-Z in room space). */
const TOWARD_WALL = new Vector3(0, 0, -1);

/** Pinch = thumb tip within 2 cm of index tip; released past 3.5 cm (hysteresis). */
const PINCH_ON = 0.02;
const PINCH_OFF = 0.035;

/** Edge-detecting pinch state for one hand. */
export class Pinch {
  down = false;
  /** True only on the frame the pinch closes. */
  started = false;
  /** Midpoint between thumb and index tips (room-local). */
  readonly point = new Vector3();

  update(f: HandFeatures): void {
    const was = this.down;
    if (!f.tracked) {
      this.down = false;
    } else {
      const d = f.pinchDist;
      this.down = was ? d < PINCH_OFF : d < PINCH_ON;
      const j = f.hand.joints;
      this.point.addVectors(j[J.THUMB_TIP], j[J.INDEX_TIP]).multiplyScalar(0.5);
    }
    this.started = this.down && !was;
  }
}

/** Open hand, fingers extended, palm facing the wall (0..1). */
export function openPalmScore(f: HandFeatures): number {
  if (!f.tracked) return 0;
  const extended = low(f.fingersCurl, 0.3, 0.55);
  const facing = high(f.palmNormal.dot(TOWARD_WALL), 0.35, 0.7);
  return Math.min(extended, facing);
}

/** Palm facing the ceiling, fingers roughly open (0..1). */
export function palmUpScore(f: HandFeatures): number {
  if (!f.tracked) return 0;
  return Math.min(high(f.palmNormal.dot(UP), 0.45, 0.8), low(f.fingersCurl, 0.4, 0.7));
}

/** Both palms up and held apart (so it never overlaps the BIRD pose). */
export function palmsUpScore(l: HandFeatures, r: HandFeatures): number {
  if (!l.tracked || !r.tracked) return 0;
  const apart = high(l.hand.joints[J.THUMB_TIP].distanceTo(r.hand.joints[J.THUMB_TIP]), 0.08, 0.14);
  return Math.min(palmUpScore(l), palmUpScore(r), apart);
}

/**
 * The hands-only UI gestures: open palm (start / play again), palms up
 * (pause), and per-hand pinch (menu buttons).
 */
export class Gestures {
  readonly pinchL = new Pinch();
  readonly pinchR = new Pinch();
  readonly openPalm = new HoldTimer(1.0);
  readonly palmsUp = new HoldTimer(1.0);
  /** Palm centre of whichever hand is doing the open-palm gesture. */
  readonly openPalmAnchor = new Vector3();
  readonly palmsUpAnchor = new Vector3();
  openPalmConf = 0;
  palmsUpConf = 0;

  constructor(
    private readonly left: HandFeatures,
    private readonly right: HandFeatures,
  ) {}

  /**
   * @returns which hold gestures fired this frame. Each timer only charges
   * while its gesture is `allowed` in the current game state.
   */
  update(dt: number, allowOpenPalm: boolean, allowPalmsUp: boolean): { start: boolean; pause: boolean } {
    this.pinchL.update(this.left);
    this.pinchR.update(this.right);

    const ol = openPalmScore(this.left);
    const or = openPalmScore(this.right);
    this.openPalmConf = Math.max(ol, or);
    this.openPalmAnchor.copy(ol >= or ? this.left.palmCenter : this.right.palmCenter);

    this.palmsUpConf = palmsUpScore(this.left, this.right);
    this.palmsUpAnchor.addVectors(this.left.palmCenter, this.right.palmCenter).multiplyScalar(0.5);

    const start = this.openPalm.update(dt, allowOpenPalm && this.openPalmConf > 0.6);
    const pause = this.palmsUp.update(dt, allowPalmsUp && this.palmsUpConf > 0.6);
    return { start, pause };
  }
}
