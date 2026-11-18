import { Matrix4, Object3D, Vector3, type World } from '@iwsdk/core';

/** The 25 WebXR hand joints, in spec order. */
export const JOINT_NAMES: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];

export const JOINT_COUNT = 25;

/** Named joint indices. */
export const J = {
  WRIST: 0,
  THUMB_MC: 1,
  THUMB_PROX: 2,
  THUMB_DIST: 3,
  THUMB_TIP: 4,
  INDEX_MC: 5,
  INDEX_PROX: 6,
  INDEX_TIP: 9,
  MIDDLE_MC: 10,
  MIDDLE_PROX: 11,
  MIDDLE_TIP: 14,
  RING_MC: 15,
  RING_PROX: 16,
  RING_TIP: 19,
  PINKY_MC: 20,
  PINKY_PROX: 21,
  PINKY_TIP: 24,
} as const;

/** Per finger: [metacarpal, proximal, ..., tip]. Thumb first. */
export const FINGERS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
];

/** Bulk joint queries from the WebXR Hand Input spec (missing from some typings). */
interface XRFrameBulk {
  fillPoses?(spaces: XRSpace[], base: XRSpace, out: Float32Array): boolean;
  fillJointRadii?(spaces: XRJointSpace[], out: Float32Array): boolean;
}

/** Frames in the moving-average window. ~55 ms at 72 Hz: steady but responsive. */
const SMOOTH_N = 4;

export type Handedness = 'left' | 'right';

/** One tracked hand: smoothed joint positions in room-local space. */
export class HandData {
  readonly joints: Vector3[] = Array.from({ length: JOINT_COUNT }, () => new Vector3());
  readonly radii = new Float32Array(JOINT_COUNT).fill(0.008);
  tracked = false;

  private readonly history = new Float32Array(SMOOTH_N * JOINT_COUNT * 3);
  private filled = 0;
  private head = 0;

  constructor(readonly handedness: Handedness) {}

  /** Push one raw frame (75 floats, room-local) and recompute the average. */
  push(raw: Float32Array): void {
    this.history.set(raw, this.head * JOINT_COUNT * 3);
    this.head = (this.head + 1) % SMOOTH_N;
    this.filled = Math.min(SMOOTH_N, this.filled + 1);
    const inv = 1 / this.filled;
    for (let j = 0; j < JOINT_COUNT; j++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let f = 0; f < this.filled; f++) {
        const o = (f * JOINT_COUNT + j) * 3;
        x += this.history[o];
        y += this.history[o + 1];
        z += this.history[o + 2];
      }
      this.joints[j].set(x * inv, y * inv, z * inv);
    }
    this.tracked = true;
  }

  lost(): void {
    this.tracked = false;
    this.filled = 0;
    this.head = 0;
  }

  /** Test/debug hook: write joint positions directly (bypasses smoothing). */
  setJoints(points: ArrayLike<number>): void {
    for (let j = 0; j < JOINT_COUNT; j++) {
      this.joints[j].set(points[j * 3], points[j * 3 + 1], points[j * 3 + 2]);
    }
    this.tracked = true;
  }
}

/**
 * Reads both hands from the raw WebXR Hand Input API each frame
 * (`XRFrame.fillPoses` / `getJointPose`) and converts them into the room's
 * local space so every downstream consumer works in one coordinate frame.
 */
export class HandTracker {
  readonly left = new HandData('left');
  readonly right = new HandData('right');

  private readonly spaces = new WeakMap<XRHand, XRJointSpace[]>();
  private readonly poseBuf = new Float32Array(JOINT_COUNT * 16);
  private readonly radiusBuf = new Float32Array(JOINT_COUNT);
  private readonly raw = new Float32Array(JOINT_COUNT * 3);
  private readonly toRoom = new Matrix4();
  private readonly tmp = new Vector3();

  hand(h: Handedness): HandData {
    return h === 'left' ? this.left : this.right;
  }

  update(world: World, room: Object3D): void {
    const frame = world.xrFrame;
    const ref = world.xrReferenceSpace;
    const session = world.session;
    let sawLeft = false;
    let sawRight = false;

    if (frame && ref && session) {
      // Reference space is local to the player rig; map rig → world → room.
      this.toRoom.copy(room.matrixWorld).invert().multiply(world.player.matrixWorld);
      for (const source of session.inputSources) {
        const hand = source.hand;
        if (!hand) continue;
        if (source.handedness !== 'left' && source.handedness !== 'right') continue;
        if (!this.readHand(frame, ref, hand)) continue;
        const data = this.hand(source.handedness);
        data.push(this.raw);
        data.radii.set(this.radiusBuf);
        if (source.handedness === 'left') sawLeft = true;
        else sawRight = true;
      }
    }
    if (!sawLeft) this.left.lost();
    if (!sawRight) this.right.lost();
  }

  private readHand(frame: XRFrame, ref: XRReferenceSpace, hand: XRHand): boolean {
    let spaces = this.spaces.get(hand);
    if (!spaces) {
      spaces = JOINT_NAMES.map((n) => hand.get(n)!).filter(Boolean);
      this.spaces.set(hand, spaces);
    }
    if (spaces.length !== JOINT_COUNT) return false;

    let ok = false;
    const bulk = frame as XRFrameBulk;
    try {
      if (typeof bulk.fillPoses === 'function') {
        ok = bulk.fillPoses(spaces, ref, this.poseBuf);
        if (ok && typeof bulk.fillJointRadii === 'function') {
          bulk.fillJointRadii(spaces, this.radiusBuf);
        }
      } else {
        ok = true;
        for (let j = 0; j < JOINT_COUNT; j++) {
          const pose = frame.getJointPose?.(spaces[j], ref);
          if (!pose) {
            ok = false;
            break;
          }
          const m = pose.transform.matrix;
          this.poseBuf[j * 16 + 12] = m[12];
          this.poseBuf[j * 16 + 13] = m[13];
          this.poseBuf[j * 16 + 14] = m[14];
          this.radiusBuf[j] = pose.radius ?? 0.008;
        }
      }
    } catch {
      ok = false;
    }
    if (!ok) return false;

    for (let j = 0; j < JOINT_COUNT; j++) {
      const o = j * 16;
      this.tmp
        .set(this.poseBuf[o + 12], this.poseBuf[o + 13], this.poseBuf[o + 14])
        .applyMatrix4(this.toRoom);
      this.raw[j * 3] = this.tmp.x;
      this.raw[j * 3 + 1] = this.tmp.y;
      this.raw[j * 3 + 2] = this.tmp.z;
    }
    return true;
  }
}
