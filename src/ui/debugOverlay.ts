import type { Gestures } from '../hands/gestures.js';
import { FINGER_LABELS, POSE_THRESHOLD, POSES, type HandFeatures, type PoseDetector } from '../hands/poseDetector.js';

/**
 * Desktop-only tuning overlay (toggle with D). Shows live per-finger curl,
 * palm normals and every pose/gesture confidence so thresholds can be tuned
 * in the emulator. It is plain DOM, so it never appears inside the headset.
 */
export class DebugOverlay {
  private readonly el: HTMLPreElement;
  visible = false;
  private acc = 0;

  constructor() {
    this.el = document.createElement('pre');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      margin: '0',
      padding: '10px 12px',
      font: '12px/1.35 Consolas, monospace',
      color: '#ffe2b0',
      background: 'rgba(20,10,4,0.82)',
      border: '1px solid #8a5a2a',
      borderRadius: '6px',
      zIndex: '20',
      pointerEvents: 'none',
      display: 'none',
      whiteSpace: 'pre',
    } as CSSStyleDeclaration);
    this.el.id = 'debug-overlay';
    document.body.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  /** Dump the latest readout to the console (readable while an XR session hides the DOM). */
  log(): void {
    console.info(this.el.textContent);
  }

  update(dt: number, state: string, poses: PoseDetector, gestures: Gestures): void {
    this.acc += dt;
    if (this.acc < 0.1) return; // 10 Hz is plenty and keeps DOM churn low
    this.acc = 0;
    const bar = (v: number) => '█'.repeat(Math.round(v * 10)).padEnd(10, '·');
    const hand = (name: string, f: HandFeatures) => {
      if (!f.tracked) return `${name}: not tracked\n`;
      let s = `${name}:\n`;
      FINGER_LABELS.forEach((label, i) => {
        s += `  ${label.padEnd(6)} curl ${bar(f.curl[i])} ${f.curl[i].toFixed(2)}\n`;
      });
      const n = f.palmNormal;
      s += `  palm n (${n.x.toFixed(2)}, ${n.y.toFixed(2)}, ${n.z.toFixed(2)})  pinch ${(f.pinchDist * 100).toFixed(1)}cm\n`;
      return s;
    };
    let out = `SHADOW PLAY debug  [D] hide  [1/2/3] dog/bird/rabbit  [Enter] start  [P] pause\n`;
    out += `state: ${state}\n\n`;
    out += hand('LEFT ', poses.left);
    out += hand('RIGHT', poses.right);
    out += `\nposes (threshold ${POSE_THRESHOLD}):\n`;
    for (const p of POSES) {
      const c = poses.confidence[p];
      out += `  ${p.padEnd(7)} ${bar(c)} ${c.toFixed(2)}${c > POSE_THRESHOLD ? '  ✓' : ''}\n`;
    }
    const r = poses.result;
    out += `  holding: ${r.charging ?? '-'} ${(r.progress * 100).toFixed(0)}%\n`;
    out += `\ngestures:\n`;
    out += `  open palm ${bar(gestures.openPalmConf)} ${gestures.openPalmConf.toFixed(2)}  hold ${(gestures.openPalm.progress * 100).toFixed(0)}%\n`;
    out += `  palms up  ${bar(gestures.palmsUpConf)} ${gestures.palmsUpConf.toFixed(2)}  hold ${(gestures.palmsUp.progress * 100).toFixed(0)}%\n`;
    out += `  pinch L ${gestures.pinchL.down ? 'DOWN' : 'up  '}  R ${gestures.pinchR.down ? 'DOWN' : 'up'}\n`;
    this.el.textContent = out; // updated even while hidden so log() works
  }
}
