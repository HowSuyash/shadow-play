import { AdditiveBlending, Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3 } from '@iwsdk/core';
import { JOINT_COUNT, type HandData } from '../hands/handData.js';
import { makeText } from '../ui/wallUI.js';

/** Player colours: host gold, guest violet. */
export const PLAYER_COLORS = { host: 0xffb347, guest: 0xb388ff } as const;

/**
 * The co-op partner as a mysterious shadow puppeteer: two hands of glowing
 * joints (one instanced draw call) with a floating name, sitting beside you.
 * Their real shadow is cast separately by a HandShadowCasters rig.
 */
export class GlowHands {
  readonly root = new Group();
  private readonly mesh: InstancedMesh;
  private readonly label: ReturnType<typeof makeText>;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly zero = new Matrix4().makeScale(0, 0, 0);
  private readonly mid = new Vector3();

  constructor(color: number, name: string) {
    this.mesh = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: name ? 0.85 : 0.45, blending: AdditiveBlending, depthWrite: false }),
      JOINT_COUNT * 2,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, this.zero);
    this.label = makeText([name || ' '], 0.035, { size: 56, color: '#fff1d6' });
    this.label.visible = !!name;
    this.root.add(this.mesh, this.label);
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
          this.mesh.setMatrixAt(idx, this.zero);
          continue;
        }
        any = true;
        const tip = j === 4 || j === 9 || j === 14 || j === 19 || j === 24;
        const r = (tip ? 0.009 : 0.006) * (1 + 0.15 * Math.sin(time * 4 + j));
        this.s.set(r, r, r);
        this.m.compose(hand.joints[j], this.q, this.s);
        this.mesh.setMatrixAt(idx, this.m);
        if (j === 0) {
          this.mid.add(hand.joints[0]);
          n++;
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.root.visible = any;
    if (n) {
      this.label.position.copy(this.mid.multiplyScalar(1 / n));
      this.label.position.y += 0.2;
    }
  }
}
