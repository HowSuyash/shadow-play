import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { JOINT_COUNT, type HandData } from '../hands/handData.js';
import { makeText } from '../ui/wallUI.js';

/** Player colours: host gold, guest violet. */
export const PLAYER_COLORS = { host: 0xffb347, guest: 0xb388ff } as const;

/** Finger bones as joint-index pairs (WebXR hand joint order). */
const BONES: [number, number][] = [];
for (let j = 1; j < 4; j++) BONES.push([j, j + 1]);
BONES.push([0, 1]);
for (let f = 0; f < 4; f++) {
  const b = 5 + f * 5;
  BONES.push([0, b]);
  for (let j = 0; j < 4; j++) BONES.push([b + j, b + j + 1]);
}
const TIPS = [4, 9, 14, 19, 24];

let glowTex: CanvasTexture | undefined;
function glow(): CanvasTexture {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new CanvasTexture(c);
  }
  return glowTex;
}

/**
 * Spirit hands: translucent glowing bones between the tracked joints, with
 * bright haloed fingertips — the magic of the shadow puppeteer made visible.
 * Used for your own hands (subtle gold, over the real hand) and for the co-op
 * partner (their colour, with a floating name). Two instanced draws + one Points.
 */
export class GlowHands {
  readonly root = new Group();
  private readonly joints: InstancedMesh;
  private readonly bones: InstancedMesh;
  private readonly tips: Points;
  private readonly tipPos: Float32BufferAttribute;
  private readonly label: ReturnType<typeof makeText>;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly d = new Vector3();
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private readonly mid = new Vector3();
  private static readonly UP = new Vector3(0, 1, 0);

  constructor(color: number, name: string) {
    const strong = !!name;
    const mat = (opacity: number) =>
      new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity, blending: AdditiveBlending, depthWrite: false });
    this.joints = new InstancedMesh(new SphereGeometry(1, 8, 6), mat(strong ? 0.85 : 0.5), JOINT_COUNT * 2);
    const bone = new CylinderGeometry(1, 1, 1, 6, 1, true);
    bone.translate(0, 0.5, 0);
    this.bones = new InstancedMesh(bone, mat(strong ? 0.4 : 0.3), BONES.length * 2);
    for (const im of [this.joints, this.bones]) {
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.zero);
    }
    const g = new BufferGeometry();
    this.tipPos = new Float32BufferAttribute(new Float32Array(TIPS.length * 2 * 3).fill(-999), 3);
    g.setAttribute('position', this.tipPos);
    this.tips = new Points(
      g,
      new PointsMaterial({ map: glow(), color, size: strong ? 0.05 : 0.035, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true }),
    );
    this.tips.frustumCulled = false;
    this.label = makeText([name || ' '], 0.035, { size: 56, color: '#fff1d6' });
    this.label.visible = strong;
    this.root.add(this.bones, this.joints, this.tips, this.label);
    this.root.visible = false;
  }

  update(hands: HandData[], time: number): void {
    let any = false;
    this.mid.set(0, 0, 0);
    let n = 0;
    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      for (let j = 0; j < JOINT_COUNT; j++) {
        const idx = h * JOINT_COUNT + j;
        if (!hand.tracked) {
          this.joints.setMatrixAt(idx, this.zero);
          continue;
        }
        any = true;
        const r = 0.0065 * (1 + 0.15 * Math.sin(time * 4 + j));
        this.joints.setMatrixAt(idx, this.m.compose(hand.joints[j], this.q.identity(), this.s.set(r, r, r)));
        if (j === 0) {
          this.mid.add(hand.joints[0]);
          n++;
        }
      }
      for (let b = 0; b < BONES.length; b++) {
        const idx = h * BONES.length + b;
        if (!hand.tracked) {
          this.bones.setMatrixAt(idx, this.zero);
          continue;
        }
        const a = hand.joints[BONES[b][0]];
        this.d.subVectors(hand.joints[BONES[b][1]], a);
        const len = this.d.length();
        if (len < 1e-5) {
          this.bones.setMatrixAt(idx, this.zero);
          continue;
        }
        this.q.setFromUnitVectors(GlowHands.UP, this.d.multiplyScalar(1 / len));
        const w = BONES[b][0] === 0 ? 0.004 : 0.0075;
        this.bones.setMatrixAt(idx, this.m.compose(a, this.q, this.s.set(w, len, w)));
      }
      for (let k = 0; k < TIPS.length; k++) {
        const p = hand.joints[TIPS[k]];
        const i = h * TIPS.length + k;
        if (hand.tracked) this.tipPos.setXYZ(i, p.x, p.y, p.z);
        else this.tipPos.setXYZ(i, 0, -999, 0);
      }
    }
    this.joints.instanceMatrix.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
    this.tipPos.needsUpdate = true;
    (this.tips.material as PointsMaterial).opacity = 0.75 + 0.2 * Math.sin(time * 3);
    this.root.visible = any;
    if (n) {
      this.label.position.copy(this.mid.multiplyScalar(1 / n));
      this.label.position.y += 0.2;
    }
  }
}
