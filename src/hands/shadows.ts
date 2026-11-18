import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { FINGERS, JOINT_COUNT, type HandData } from './handData.js';

/** Bones along each finger, plus extra "webbing" segments that fill the palm. */
function buildSegments(): { a: number; b: number; palm: boolean }[] {
  const segs: { a: number; b: number; palm: boolean }[] = [];
  for (const chain of FINGERS) {
    // Skip metacarpal→proximal on fingers (inside the palm, covered below).
    const start = chain.length === 4 ? 0 : 1;
    for (let i = start; i < chain.length - 1; i++) {
      segs.push({ a: chain[i], b: chain[i + 1], palm: false });
    }
  }
  const palm: [number, number][] = [
    [0, 1], // wrist → thumb base
    [1, 6], // thumb web
    [0, 6],
    [0, 11],
    [0, 16],
    [0, 21],
    [6, 11],
    [11, 16],
    [16, 21],
    [5, 21], // across the lower palm
    [10, 20],
  ];
  for (const [a, b] of palm) segs.push({ a, b, palm: true });
  return segs;
}

const SEGMENTS = buildSegments();
const PALM_RADIUS = 0.019;
const FINGER_RADIUS_SCALE = 1.15;

/**
 * Invisible stand-ins for the player's real hands that only exist in the
 * shadow map. `colorWrite:false` keeps them out of the eye buffer while the
 * shadow pass (which uses its own depth material) still sees them.
 *
 * Two InstancedMeshes (capsule bodies + joint spheres) cover both hands, so the
 * whole rig costs 2 draw calls in the shadow pass and ~0 in the color pass.
 */
export class HandShadowCasters {
  readonly root = new Group();
  private readonly bones: InstancedMesh;
  private readonly knuckles: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();
  private readonly dir = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly zero = new Matrix4().makeScale(0, 0, 0);

  constructor() {
    const mat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.bones = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8, 1), mat, SEGMENTS.length * 2);
    this.knuckles = new InstancedMesh(new SphereGeometry(1, 8, 6), mat, JOINT_COUNT * 2);
    for (const mesh of [this.bones, this.knuckles]) {
      mesh.castShadow = true;
      mesh.frustumCulled = false; // instance bounds change every frame
      mesh.renderOrder = -1;
      this.root.add(mesh);
    }
    this.root.name = 'HandShadowCasters';
  }

  update(hands: HandData[]): void {
    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      const segBase = h * SEGMENTS.length;
      const jointBase = h * JOINT_COUNT;
      if (!hand.tracked) {
        for (let i = 0; i < SEGMENTS.length; i++) this.bones.setMatrixAt(segBase + i, this.zero);
        for (let j = 0; j < JOINT_COUNT; j++) this.knuckles.setMatrixAt(jointBase + j, this.zero);
        continue;
      }
      for (let i = 0; i < SEGMENTS.length; i++) {
        const seg = SEGMENTS[i];
        const a = hand.joints[seg.a];
        const b = hand.joints[seg.b];
        this.dir.subVectors(b, a);
        const len = this.dir.length();
        if (len < 1e-5) {
          this.bones.setMatrixAt(segBase + i, this.zero);
          continue;
        }
        const r = seg.palm
          ? PALM_RADIUS
          : Math.max(hand.radii[seg.a], hand.radii[seg.b]) * FINGER_RADIUS_SCALE;
        this.q.setFromUnitVectors(this.up, this.dir.multiplyScalar(1 / len));
        this.p.addVectors(a, b).multiplyScalar(0.5);
        this.s.set(r, len, r);
        this.m.compose(this.p, this.q, this.s);
        this.bones.setMatrixAt(segBase + i, this.m);
      }
      this.q.identity();
      for (let j = 0; j < JOINT_COUNT; j++) {
        const r = hand.radii[j] * FINGER_RADIUS_SCALE;
        this.s.set(r, r, r);
        this.m.compose(hand.joints[j], this.q, this.s);
        this.knuckles.setMatrixAt(jointBase + j, this.m);
      }
    }
    this.bones.instanceMatrix.needsUpdate = true;
    this.knuckles.instanceMatrix.needsUpdate = true;
  }
}
