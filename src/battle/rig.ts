import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { J } from '../hands/handData.js';
import type { HandFeatures } from '../hands/poseDetector.js';

/**
 * Everything a weapon needs to know about one hand: a grip point, an
 * orientation frame, a velocity and a pinch. Filled from a tracked hand (VR)
 * or from the mouse (desktop), so every weapon works the same in both.
 */
export class HandRig {
  tracked = false;
  /** Grip point (palm centre), room space. */
  readonly pos = new Vector3();
  /** Wrist → middle knuckle (along the hand). */
  readonly fwd = new Vector3(0, 0, -1);
  /** Pinky knuckle → index knuckle (toward the thumb side). */
  readonly side = new Vector3(0, 1, 0);
  /** Out of the palm. */
  readonly normal = new Vector3(1, 0, 0);
  /** Smoothed velocity of the grip point, m/s. */
  readonly vel = new Vector3();
  speed = 0;
  pinch = false;
  pinchStarted = false;
  /** Grip orientation: +Y along `side` (a held blade), +Z out of the palm. */
  readonly quat = new Quaternion();

  private readonly prev = new Vector3();
  private hasPrev = false;
  private readonly m = new Matrix4();
  private readonly x = new Vector3();
  private readonly y = new Vector3();
  private readonly z = new Vector3();
  private readonly tmp = new Vector3();

  constructor(readonly handedness: 'left' | 'right') {}

  /** From a tracked hand. */
  fromHand(f: HandFeatures, pinchDown: boolean, pinchStarted: boolean, dt: number): void {
    if (!f.tracked) {
      this.lose();
      return;
    }
    const j = f.hand.joints;
    this.pos.copy(f.palmCenter);
    this.fwd.subVectors(j[J.MIDDLE_PROX], j[J.WRIST]).normalize();
    this.side.subVectors(j[J.INDEX_PROX], j[J.PINKY_PROX]).normalize();
    this.normal.copy(f.palmNormal);
    this.finish(pinchDown, pinchStarted, dt);
  }

  /** From an explicit frame (desktop mouse hand). */
  fromFrame(pos: Vector3, fwd: Vector3, side: Vector3, normal: Vector3, pinchDown: boolean, pinchStarted: boolean, dt: number): void {
    this.pos.copy(pos);
    this.fwd.copy(fwd).normalize();
    this.side.copy(side).normalize();
    this.normal.copy(normal).normalize();
    this.finish(pinchDown, pinchStarted, dt);
  }

  lose(): void {
    this.tracked = false;
    this.hasPrev = false;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.pinch = this.pinchStarted = false;
  }

  private finish(pinchDown: boolean, pinchStarted: boolean, dt: number): void {
    this.tracked = true;
    this.pinch = pinchDown;
    this.pinchStarted = pinchStarted;
    if (this.hasPrev && dt > 0) {
      this.tmp.subVectors(this.pos, this.prev).divideScalar(dt);
      // Light smoothing: responsive swings, no single-frame tracking spikes.
      this.vel.lerp(this.tmp, 0.55);
      if (this.vel.length() > 12) this.vel.setLength(12);
    } else this.vel.set(0, 0, 0);
    this.speed = this.vel.length();
    this.prev.copy(this.pos);
    this.hasPrev = true;
    // Orthonormal grip frame.
    this.y.copy(this.side);
    this.z.copy(this.normal).addScaledVector(this.y, -this.normal.dot(this.y)).normalize();
    this.x.crossVectors(this.y, this.z);
    this.m.makeBasis(this.x, this.y, this.z);
    this.quat.setFromRotationMatrix(this.m);
  }
}
