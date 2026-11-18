import { AdditiveBlending, CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Sprite } from '@iwsdk/core';
import { halo } from '../battle/fx.js';
import { EYE_Y, STAGE } from '../scene/layout.js';
import { Fader, makeText } from './wallUI.js';

/** The five lands in story order, positioned on the map (0..1 canvas coords). */
export const LANDS = [
  { name: 'The Sky Kingdom', numeral: 'I', x: 0.17, y: 0.3, icon: 'sky' },
  { name: 'The Shadow Theatre', numeral: 'II', x: 0.3, y: 0.72, icon: 'temple' },
  { name: 'The Forgotten Forest', numeral: 'III', x: 0.52, y: 0.48, icon: 'forest' },
  { name: 'The Dark Castle', numeral: 'IV', x: 0.72, y: 0.72, icon: 'castle' },
  { name: 'The Shadow Realm', numeral: 'V', x: 0.85, y: 0.3, icon: 'realm' },
] as const;

const W = 1600;
const H = 1000;
const MAP_W = 2.5;
const MAP_H = (MAP_W * H) / W;

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** Paint the parchment map; lands up to `reached` are lit in gold. */
function paintMap(reached: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = rand(7);
  // Parchment.
  const bg = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.62);
  bg.addColorStop(0, '#e9d3a4');
  bg.addColorStop(0.7, '#c9a46a');
  bg.addColorStop(1, '#5a3a1a');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${90 + r() * 60},${60 + r() * 40},${30 + r() * 20},${r() * 0.08})`;
    g.fillRect(r() * W, r() * H, 2 + r() * 6, 2 + r() * 6);
  }
  // Burnt edge.
  g.strokeStyle = 'rgba(40,20,5,0.8)';
  g.lineWidth = 18;
  g.strokeRect(9, 9, W - 18, H - 18);
  g.strokeStyle = 'rgba(120,80,30,0.7)';
  g.lineWidth = 4;
  g.strokeRect(40, 40, W - 80, H - 80);
  // Title.
  g.fillStyle = '#3a220c';
  g.textAlign = 'center';
  g.font = 'italic 700 64px Georgia, serif';
  g.fillText('The Shadow Atlas', W / 2, 110);
  g.font = 'italic 32px Georgia, serif';
  g.fillText('the road to win back the light', W / 2, 155);
  // Compass rose.
  g.save();
  g.translate(W - 150, H - 150);
  g.fillStyle = 'rgba(60,35,12,0.8)';
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -70);
    g.lineTo(14, 0);
    g.lineTo(-14, 0);
    g.fill();
  }
  g.font = '700 28px Georgia, serif';
  g.fillText('N', 0, -80);
  g.restore();
  // The road (dashed), gold where you've travelled.
  g.lineCap = 'round';
  for (let i = 0; i < LANDS.length - 1; i++) {
    const a = LANDS[i];
    const b = LANDS[i + 1];
    g.setLineDash([18, 16]);
    g.lineWidth = 7;
    g.strokeStyle = i < reached ? '#b8780e' : 'rgba(70,40,15,0.55)';
    g.beginPath();
    g.moveTo(a.x * W, a.y * H);
    g.quadraticCurveTo(((a.x + b.x) / 2) * W, ((a.y + b.y) / 2) * H + (i % 2 ? -110 : 110), b.x * W, b.y * H);
    g.stroke();
  }
  g.setLineDash([]);
  // Lands.
  LANDS.forEach((land, i) => {
    const x = land.x * W;
    const y = land.y * H;
    const lit = i <= reached;
    g.save();
    g.translate(x, y);
    if (lit) {
      const glow = g.createRadialGradient(0, 0, 10, 0, 0, 150);
      glow.addColorStop(0, 'rgba(255,200,90,0.55)');
      glow.addColorStop(1, 'rgba(255,200,90,0)');
      g.fillStyle = glow;
      g.fillRect(-150, -150, 300, 300);
    }
    const ink = lit ? '#3a220c' : 'rgba(58,34,12,0.55)';
    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.lineWidth = 5;
    drawIcon(g, land.icon, i === LANDS.length - 1);
    g.font = '700 34px Georgia, serif';
    g.fillText(`${land.numeral}`, 0, 120);
    g.font = 'italic 30px Georgia, serif';
    g.fillText(land.name, 0, 158);
    g.restore();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function drawIcon(g: CanvasRenderingContext2D, icon: string, evil: boolean): void {
  if (icon === 'sky') {
    // Floating islands and clouds.
    for (const [dx, dy, s] of [
      [-50, 10, 1],
      [40, -20, 0.8],
    ]) {
      g.beginPath();
      g.moveTo(dx - 45 * s, dy);
      g.lineTo(dx + 45 * s, dy);
      g.lineTo(dx, dy + 70 * s);
      g.closePath();
      g.fill();
      g.fillRect(dx - 8 * s, dy - 50 * s, 16 * s, 50 * s);
      g.beginPath();
      g.moveTo(dx - 14 * s, dy - 50 * s);
      g.lineTo(dx, dy - 75 * s);
      g.lineTo(dx + 14 * s, dy - 50 * s);
      g.fill();
    }
    g.beginPath();
    g.arc(-10, -70, 22, 0, Math.PI * 2);
    g.arc(15, -75, 28, 0, Math.PI * 2);
    g.arc(42, -68, 20, 0, Math.PI * 2);
    g.stroke();
  } else if (icon === 'temple') {
    // A stepped gopuram.
    for (let k = 0; k < 5; k++) {
      const w = 110 - k * 20;
      g.fillRect(-w / 2, 50 - k * 26, w, 22);
    }
    g.beginPath();
    g.arc(0, -86, 10, 0, Math.PI * 2);
    g.fill();
  } else if (icon === 'forest') {
    for (const [dx, s] of [
      [-50, 0.8],
      [0, 1.1],
      [50, 0.9],
    ]) {
      g.beginPath();
      g.moveTo(dx, -70 * s);
      g.lineTo(dx + 35 * s, 30);
      g.lineTo(dx - 35 * s, 30);
      g.closePath();
      g.fill();
      g.fillRect(dx - 5, 30, 10, 25);
    }
  } else if (icon === 'castle') {
    g.fillRect(-60, -20, 120, 75);
    for (const dx of [-60, 40]) {
      g.fillRect(dx, -70, 20, 60);
      g.beginPath();
      g.moveTo(dx - 5, -70);
      g.lineTo(dx + 10, -100);
      g.lineTo(dx + 25, -70);
      g.fill();
    }
    g.clearRect(-12, 20, 24, 35);
  } else {
    // The Shadow Realm: a dark eye in a storm.
    g.fillStyle = evil ? '#2a0e40' : g.fillStyle;
    g.beginPath();
    g.ellipse(0, -10, 80, 45, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c070ff';
    g.beginPath();
    g.ellipse(0, -10, 16, 34, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a0e40';
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * 90, -10 + Math.sin(a) * 55);
      g.lineTo(Math.cos(a) * 125, -10 + Math.sin(a) * 80);
      g.stroke();
    }
  }
}

/**
 * Between chapters the wall shows the Shadow Atlas, and a candle-flame token
 * travels along the road to the next land.
 */
export class Atlas {
  readonly root = new Group();
  private readonly plane: Mesh;
  private readonly fader: Fader;
  private readonly token: Sprite;
  private readonly tokenCore: Mesh;
  private caption: Fader | undefined;
  private from = 0;
  private to = 0;
  private t = 0;
  visible = false;

  constructor() {
    this.plane = new Mesh(new PlaneGeometry(MAP_W, MAP_H), new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    this.plane.position.set(0, EYE_Y + 0.62, STAGE.z + 0.008);
    this.fader = new Fader(this.plane, 2.5);
    this.token = halo(0xffb347, 0.32, 1);
    this.tokenCore = new Mesh(
      new PlaneGeometry(0.05, 0.08),
      new MeshBasicMaterial({ color: 0xfff1c0, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    this.token.add(this.tokenCore);
    this.token.visible = false;
    this.root.add(this.plane, this.token);
  }

  /** Show the journey from land `from` to land `to`. */
  show(from: number, to: number): void {
    const mat = this.plane.material as MeshBasicMaterial;
    mat.map?.dispose();
    mat.map = paintMap(to);
    mat.needsUpdate = true;
    this.from = from;
    this.to = to;
    this.t = 0;
    this.visible = true;
    this.fader.show();
    this.token.visible = true;
    if (this.caption) {
      this.caption.mesh.removeFromParent();
      (this.caption.mesh.material as MeshBasicMaterial).map?.dispose();
    }
    const land = LANDS[to];
    const m = makeText([`Chapter ${land.numeral} · ${land.name}`], 0.13, { size: 64, color: '#fff1d6' });
    m.position.set(0, EYE_Y + 0.62 - MAP_H / 2 - 0.12, STAGE.z + 0.01);
    this.root.add(m);
    this.caption = new Fader(m, 2).show();
  }

  hide(): void {
    this.visible = false;
    this.fader.show(false);
    this.caption?.show(false);
    this.token.visible = false;
  }

  hideNow(): void {
    this.hide();
    this.fader.hideNow();
    this.caption?.hideNow();
  }

  update(dt: number, time: number): void {
    this.fader.update(dt);
    this.caption?.update(dt);
    if (!this.visible) return;
    this.t += dt;
    // Travel along the same curve the road is painted with.
    const k = Math.min(1, Math.max(0, (this.t - 0.8) / 1.8));
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const a = LANDS[this.from];
    const b = LANDS[this.to];
    let u: number;
    let v: number;
    if (this.from === this.to) {
      u = a.x;
      v = a.y;
    } else {
      const i = this.from;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2 + (i % 2 ? -0.11 : 0.11);
      u = (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * cx + e * e * b.x;
      v = (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * cy + e * e * b.y;
    }
    this.token.position.set((u - 0.5) * MAP_W, EYE_Y + 0.62 + (0.5 - v) * MAP_H, STAGE.z + 0.03);
    this.token.scale.setScalar(0.32 + 0.05 * Math.sin(time * 8));
    this.token.material.opacity = this.fader.value;
  }
}
