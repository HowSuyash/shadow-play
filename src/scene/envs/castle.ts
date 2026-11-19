import {
  AdditiveBlending,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type PointsMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import { WALL_Z } from '../layout.js';
import {
  archBand,
  archShape,
  type Bake,
  Batch,
  bakedMat,
  canvas,
  glowCards,
  glowPoints,
  lathe,
  lightShaft,
  rng,
  skyDome,
  skyGradient,
  skyStars,
  stoneTex,
  tiled,
  toTex,
  wallSurface,
  type WorldSet,
} from './kit.js';

/**
 * C. THE DARK CASTLE — a gothic cathedral-keep under the Shadow Eater's
 * violet spell: clustered piers, pointed arcades, a ribbed vault lost in
 * purple haze, stained-glass lancets, a rose window over the great sealed
 * doors behind you, and an apse with a throne beyond the screen (revealed
 * when the screen sinks for battle). Trap runes smoulder in the floor.
 */

const PIER_X = 5.2;
const PIER_ZS = [-14.6, -11.4, -8.2, -5.0, -1.8, 1.4, 4.6, 7.8];
const SPRING = 9.2;
const DOOR_Z = 10.6;

/** Stained glass: leaded panes around a central medallion. */
function glassTex(seed: number, w: number, h: number, rose = false): ReturnType<typeof toTex> {
  const [c, ctx] = canvas(w, h);
  const r = rng(seed);
  const pal = ['#5a2ad8', '#2a4ad8', '#c8283a', '#e8b030', '#8a3ae0', '#2a8ad0', '#6a1a9a'];
  ctx.fillStyle = '#0a0414';
  ctx.fillRect(0, 0, w, h);
  if (rose) {
    const cx = w / 2;
    const cy = h / 2;
    for (let ring = 6; ring >= 0; ring--) {
      const R = (ring + 1) * (w / 14);
      const n = 6 + ring * 4;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = pal[(k + ring * 3) % pal.length];
        ctx.fill();
        ctx.strokeStyle = '#0a0414';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    // Petal tracery.
    ctx.strokeStyle = '#120a1a';
    ctx.lineWidth = 7;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * w * 0.3, cy + Math.sin(a) * w * 0.3, w * 0.13, w * 0.06, a, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = '#e8b030';
    ctx.fill();
    ctx.stroke();
  } else {
    const cols = 3;
    const rows = Math.round((h / w) * 3);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        ctx.fillStyle = pal[Math.floor(r() * pal.length)];
        ctx.fillRect((x * w) / cols, (y * h) / rows, w / cols, h / rows);
      }
    }
    // Central medallion with a crowned figure.
    const my = h * 0.42;
    ctx.beginPath();
    ctx.arc(w / 2, my, w * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = '#e8c060';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2, my, w * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#3a1a8a';
    ctx.fill();
    ctx.fillStyle = '#d8c8f0';
    ctx.beginPath();
    ctx.arc(w / 2, my - w * 0.1, w * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(w / 2 - w * 0.08, my - w * 0.03, w * 0.16, w * 0.22);
    ctx.fillStyle = '#e8b030';
    ctx.fillRect(w / 2 - w * 0.08, my - w * 0.2, w * 0.16, w * 0.05);
    ctx.strokeStyle = '#0a0414';
    ctx.lineWidth = 4;
    for (let y = 1; y < rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, (y * h) / rows);
      ctx.lineTo(w, (y * h) / rows);
      ctx.stroke();
    }
    for (let x = 1; x < cols; x++) {
      ctx.beginPath();
      ctx.moveTo((x * w) / cols, 0);
      ctx.lineTo((x * w) / cols, h);
      ctx.stroke();
    }
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, my, w * 0.36, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Glow falloff so the glass reads as lit from outside.
  const g = ctx.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.5, Math.max(w, h) * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return toTex(c, false);
}

/** A clustered gothic pier: core + four colonettes, moulded base and capital. */
function addPier(b: Batch, x: number, z: number, H: number): void {
  b.add(PIER_BASE, x, 0, z, 0, Math.PI / 8, 0, 1, 1, 1, 0xb0a8c0);
  b.add(CORE, x, 0.9 + (H - 0.9) / 2, z, 0, 0, 0, 1, H - 0.9, 1, 0xa098b4, [1, (H - 0.9) / 2]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(COLONETTE, x + Math.cos(a) * 0.48, 0.9 + (H - 0.9) / 2, z + Math.sin(a) * 0.48, 0, 0, 0, 1, H - 0.9, 1, 0xb8b0c8, [0.5, (H - 0.9) / 2]);
  }
  b.add(CAPITAL, x, H - 0.1, z, 0, 0, 0, 1, 1, 1, 0xc8c0d8);
}
const PIER_BASE = lathe([0, 0, 0.95, 0, 0.95, 0.3, 0.8, 0.42, 0.85, 0.55, 0.7, 0.7, 0.7, 0.9, 0, 0.9], 8);
const CORE = new CylinderGeometry(0.5, 0.5, 1, 12, 3, true);
const COLONETTE = new CylinderGeometry(0.15, 0.15, 1, 8, 3, true);
const CAPITAL = lathe([0, 0, 0.6, 0, 0.75, 0.25, 0.95, 0.4, 0.95, 0.55, 0, 0.55], 12);

export function castle(): WorldSet {
  const root = new Group();
  const r = rng(91);

  root.add(
    skyDome((ctx, w, h) => {
      skyGradient(ctx, w, h, [[90, '#020108'], [30, '#0c0620'], [5, '#2a1440'], [0, '#1a0c28'], [-90, '#020104']]);
      skyStars(ctx, w, h, 1400, 91, 5, 0.6);
    }),
  );

  const violet = 0xa070ff;
  const env: Bake = {
    sky: 0x5a4a8a,
    ground: 0x100a1a,
    amb: 0.5,
    ao: 0.5,
    aoHeight: 1.6,
    topDark: 9,
    lights: [
      // Torches on the piers.
      ...PIER_ZS.flatMap((z) => [-1, 1].map((sx) => ({ p: new Vector3(sx * (PIER_X - 0.75), 3.0, z), color: violet, k: 1.5, r: 6 }))),
      // Coloured light pouring from the lancets.
      ...PIER_ZS.slice(0, -1).flatMap((z) => [-1, 1].map((sx) => ({ p: new Vector3(sx * 7.0, 5.5, z + 1.6), color: 0x6a5aff, k: 1.0, r: 6 }))),
      // The rose window and the great doors' seam.
      { p: new Vector3(0, 9, DOOR_Z - 0.5), color: 0xc070ff, k: 2.0, r: 12 },
      // The apse: a cold violet glow around the throne.
      { p: new Vector3(0, 3, -16), color: 0xb080ff, k: 2.6, r: 12 },
      // The player's candle side.
      { p: new Vector3(0, 1.6, 0), color: 0xffb070, k: 0.5, r: 4 },
    ],
  };

  // --- Floor: marble chequer --------------------------------------------------
  const floorT = (() => {
    const [c, ctx] = canvas(512, 512);
    const base = stoneTex({ seed: 501, base: [120, 112, 130], vary: 0.4, size: 256 });
    void base;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#2a2234' : '#8a8298';
        ctx.fillRect(x * 256, y * 256, 256, 256);
      }
    }
    // Veins.
    const rr = rng(502);
    ctx.globalAlpha = 0.25;
    for (let k = 0; k < 40; k++) {
      ctx.strokeStyle = k % 2 ? '#ffffff' : '#000000';
      ctx.lineWidth = 1 + rr() * 2;
      ctx.beginPath();
      let x = rr() * 512;
      let y = rr() * 512;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (rr() - 0.5) * 120;
        y += (rr() - 0.5) * 120;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, 256, 256);
    ctx.strokeRect(256, 256, 256, 256);
    return toTex(c);
  })();
  const floor = new Batch(bakedMat(floorT));
  floor.add(new PlaneGeometry(16, 30, 32, 60), 0, 0, -3.4, -Math.PI / 2, 0, 0, 1, 1, 1, 0xffffff, [8, 15]);

  // --- Stonework ------------------------------------------------------------------
  const stoneT = stoneTex({ seed: 503, base: [104, 98, 120], vary: 0.45, rows: 6, cols: 2, mortar: 2, cracks: 5, tint2: [70, 60, 90], tint2Amt: 0.3 });
  const stone = new Batch(bakedMat(stoneT));
  for (const z of PIER_ZS) for (const sx of [-1, 1]) addPier(stone, sx * PIER_X, z, SPRING);
  // Arcade: pointed arches between piers along each side, and transverse arches across the nave.
  const arcade = archBand(3.2, 2.5, 0, 'pointed');
  const arcadeGeo = new ExtrudeGeometry(arcade, { depth: 0.9, bevelEnabled: false, curveSegments: 6 });
  for (let i = 0; i + 1 < PIER_ZS.length; i++) {
    const zc = (PIER_ZS[i] + PIER_ZS[i + 1]) / 2;
    for (const sx of [-1, 1]) stone.add(arcadeGeo, sx * PIER_X - 0.45 * sx, SPRING, zc, 0, sx * Math.PI / 2, 0, 1, 1, 1, 0xb0a8c0, [0.5, 0.5]);
  }
  const trans = archBand(2 * PIER_X + 0.6, 2 * PIER_X - 0.6, 0, 'pointed');
  const transGeo = new ExtrudeGeometry(trans, { depth: 0.5, bevelEnabled: false, curveSegments: 8 });
  for (const z of PIER_ZS) stone.add(transGeo, 0, SPRING + 3.4, z - 0.25, 0, 0, 0, 1, 0.7, 1, 0xb8b0c8, [0.4, 0.4]);
  // Clerestory wall above the arcade, and outer aisle walls.
  const len = PIER_ZS[PIER_ZS.length - 1] - PIER_ZS[0] + 1;
  const midZ = (PIER_ZS[PIER_ZS.length - 1] + PIER_ZS[0]) / 2;
  for (const sx of [-1, 1]) {
    stone.box(sx * (PIER_X + 0.1), SPRING + 3.55, midZ, 0.6, 3.6, len, 0x9890a8, 2);
    stone.box(sx * 8.2, 5.5, midZ, 0.6, 11, len, 0x6a6280, 2);
    // Aisle ceiling.
    stone.box(sx * 6.7, SPRING + 1.6, midZ, 3.2, 0.3, len, 0x5a5270, 2);
  }
  // Pointed barrel vault over the nave, and diagonal ribs.
  const vault = archBand(2 * PIER_X + 0.8, 2 * PIER_X + 0.3, 0, 'pointed');
  stone.add(new ExtrudeGeometry(vault, { depth: len, bevelEnabled: false, curveSegments: 10 }), 0, SPRING + 3.4, PIER_ZS[0] - 0.5, 0, 0, 0, 1, 0.7, 1, 0x6a6280, [0.3, 3]);
  const ribH = SPRING + 3.4 + (2 * PIER_X + 0.8) * 0.866 * 0.7;
  for (let i = 0; i + 1 < PIER_ZS.length; i++) {
    for (const sx of [-1, 1]) {
      const a = new Vector3(sx * PIER_X, SPRING + 3.4, PIER_ZS[i]);
      const b = new Vector3(-sx * PIER_X, SPRING + 3.4, PIER_ZS[i + 1]);
      const m = a.clone().lerp(b, 0.5).setY(ribH - 0.35);
      const q1 = a.clone().lerp(m, 0.5).setY(SPRING + 3.4 + (ribH - SPRING - 3.4) * 0.8);
      const q2 = b.clone().lerp(m, 0.5).setY(SPRING + 3.4 + (ribH - SPRING - 3.4) * 0.8);
      stone.add(new TubeGeometry(new CatmullRomCurve3([a, q1, m, q2, b]), 16, 0.11, 5, false), 0, 0, 0, 0, 0, 0, 1, 1, 1, 0xc8c0d8);
    }
  }

  // --- The screen's gothic frame (a rood screen of tracery) ---------------------
  const frame = new Shape();
  frame.moveTo(-PIER_X + 0.3, -0.4);
  frame.lineTo(PIER_X - 0.3, -0.4);
  frame.lineTo(PIER_X - 0.3, SPRING);
  frame.lineTo(-PIER_X + 0.3, SPRING);
  frame.lineTo(-PIER_X + 0.3, -0.4);
  const opening = new Shape();
  opening.moveTo(-3.52, -0.3);
  opening.lineTo(3.52, -0.3);
  opening.lineTo(3.52, 4.27);
  opening.lineTo(-3.52, 4.27);
  opening.lineTo(-3.52, -0.3);
  frame.holes.push(opening);
  stone.add(new ExtrudeGeometry(frame, { depth: 0.4, bevelEnabled: false }), 0, 0, WALL_Z - 0.5, 0, 0, 0, 1, 1, 1, 0x8a82a0, [0.4, 0.4]);
  // Pinnacles and a gable over the screen.
  const gable = archBand(7.6, 7.0, 4.3, 'pointed');
  stone.add(new ExtrudeGeometry(gable, { depth: 0.25, bevelEnabled: false }), 0, 0, WALL_Z - 0.08, 0, 0, 0, 1, 0.62, 1, 0xd0c8e0, [0.5, 0.5]);
  for (const sx of [-1, 1]) {
    stone.box(sx * 3.85, 2.6, WALL_Z - 0.05, 0.36, 5.2, 0.36, 0xc8c0d8, 1);
    stone.add(new CylinderGeometry(0, 0.26, 1.2, 4), sx * 3.85, 5.8, WALL_Z - 0.05, 0, Math.PI / 4, 0, 1, 1, 1, 0xd0c8e0);
  }

  // --- Behind the player: the great sealed doors and the rose window -------------
  const westWall = new Shape();
  westWall.moveTo(-8.5, 0);
  westWall.lineTo(8.5, 0);
  westWall.lineTo(8.5, 20);
  westWall.lineTo(-8.5, 20);
  westWall.lineTo(-8.5, 0);
  westWall.holes.push(archShape(4.2, 4.6, 'pointed'));
  const roseHole = new Shape();
  roseHole.absarc(0, 11.6, 2.6, 0, Math.PI * 2, true);
  westWall.holes.push(roseHole);
  stone.add(new ExtrudeGeometry(westWall, { depth: 0.8, bevelEnabled: false, curveSegments: 24 }), 0, 0, DOOR_Z + 0.8, 0, Math.PI, 0, 1, 1, 1, 0x7a7290, [0.3, 0.3]);
  // Recessed archivolts around the doorway.
  for (let k = 0; k < 3; k++) {
    const ar = archBand(4.2 + 0.5 * (k + 1), 4.2 + 0.5 * k + 0.05, 4.6, 'pointed');
    stone.add(new ExtrudeGeometry(ar, { depth: 0.25, bevelEnabled: false }), 0, 0, DOOR_Z - 0.2 - k * 0.12, 0, Math.PI, 0, 1, 1, 1, k % 2 ? 0xc0b8d0 : 0xa8a0bc, [0.4, 0.4]);
  }
  const roseMat = new MeshBasicMaterial({ map: glassTex(505, 512, 512, true), fog: false });
  const rose = new Mesh(new CircleGeometry(2.6, 48), roseMat);
  rose.rotation.y = Math.PI;
  rose.position.set(0, 11.6, DOOR_Z + 0.5);
  root.add(rose);
  stone.add(new TorusGeometry(2.7, 0.18, 6, 40), 0, 11.6, DOOR_Z - 0.05, 0, 0, 0, 1, 1, 1, 0xc0b8d0);

  // Oak doors studded with iron, sealed with a violet seam.
  const woodT = stoneTex({ seed: 506, base: [70, 48, 36], vary: 0.6, rows: 1, cols: 7, mortar: 2 });
  const wood = new Batch(bakedMat(woodT));
  wood.add(new ShapeGeometry(archShape(4.2, 4.6, 'pointed')), 0, 0, DOOR_Z + 0.35, 0, Math.PI, 0, 1, 1, 1, 0xffffff, [0.4, 0.4]);
  const iron = new MeshStandardMaterial({ color: 0x2a2a34, metalness: 0.9, roughness: 0.45 });
  const studs = new Batch(iron);
  for (let row = 0; row < 9; row++) for (let col = -3; col <= 3; col++) if (col) studs.add(new SphereGeometry(0.05, 6, 4), col * 0.28, 0.5 + row * 0.55, DOOR_Z + 0.3);
  for (const y of [1.2, 3.2]) studs.box(0, y, DOOR_Z + 0.31, 4.0, 0.12, 0.04);
  const seam = new Mesh(new PlaneGeometry(0.07, 6.2), new MeshBasicMaterial({ color: 0xc890ff, fog: false }));
  seam.position.set(0, 3.1, DOOR_Z + 0.25);
  seam.rotation.y = Math.PI;
  root.add(seam, glowCards([[0, 3.2, DOOR_Z - 0.1, 2.4]], 0xb070ff, 0.45));

  // --- Lancet windows in the aisle walls ---------------------------------------
  const lancetMats = [0, 1, 2].map((k) => new MeshBasicMaterial({ map: glassTex(510 + k, 128, 384), fog: false }));
  const lancet = new ShapeGeometry(archShape(1.3, 4.2, 'pointed'), 8);
  // Map UVs from shape coordinates to 0..1.
  const uv = lancet.attributes.uv;
  const pp = lancet.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / 1.3 + 0.5, pp.getY(i) / 5.4);
  for (let i = 0; i + 1 < PIER_ZS.length; i++) {
    const zc = (PIER_ZS[i] + PIER_ZS[i + 1]) / 2;
    for (const sx of [-1, 1]) {
      const w = new Mesh(lancet, lancetMats[(i + (sx > 0 ? 1 : 0)) % 3]);
      w.position.set(sx * 7.88, 2.6, zc);
      w.rotation.y = -sx * Math.PI / 2;
      root.add(w);
      // Clerestory lancet above.
      const c2 = new Mesh(lancet, lancetMats[(i + 2) % 3]);
      c2.scale.setScalar(0.6);
      c2.position.set(sx * (PIER_X - 0.22), SPRING + 1.7, zc);
      c2.rotation.y = -sx * Math.PI / 2;
      root.add(c2);
      root.add(lightShaft(new Vector3(sx * 7.8, 6, zc), new Vector3(sx * 2.4, 0, zc - 1.2), 0.5, 1.2, i % 2 ? 0x8a6aff : 0x6a8aff, 0.06));
    }
  }

  // --- The apse beyond the screen: a dais and the empty throne --------------------
  for (let k = 0; k < 4; k++) stone.box(0, 0.1 + k * 0.2, -14.2 - k * 0.35, 6 - k * 0.8, 0.2 + k * 0.4, 1.6, 0xb0a8c0, 1.2);
  stone.box(0, 2.2, -15.6, 1.6, 2.4, 0.4, 0x5a4a78, 1);
  stone.add(new CylinderGeometry(0, 0.5, 1.6, 4), 0, 4.2, -15.6, 0, Math.PI / 4, 0, 1, 1, 0.3, 0x5a4a78);
  stone.box(0, 1.2, -15.1, 1.6, 0.25, 1.0, 0x6a5a88, 1);
  stone.box(0, 7, -17.2, 12, 14, 0.8, 0x6a6280, 2);
  const apseGlass = new Mesh(new ShapeGeometry(archShape(2.6, 6, 'pointed'), 8), new MeshBasicMaterial({ map: glassTex(520, 256, 640), fog: false }));
  const ag = apseGlass.geometry.attributes;
  for (let i = 0; i < ag.uv.count; i++) ag.uv.setXY(i, ag.position.getX(i) / 2.6 + 0.5, ag.position.getY(i) / 8.3);
  apseGlass.position.set(0, 5.0, -16.75);
  root.add(apseGlass);

  // --- Banners, torches, chandeliers, trap runes ------------------------------
  const bannerT = (() => {
    const [c, ctx] = canvas(64, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#3a1460');
    g.addColorStop(1, '#1a0830');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    ctx.fillStyle = '#d8a84a';
    ctx.fillRect(0, 0, 64, 6);
    ctx.strokeStyle = '#d8a84a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 90, 18, 0, Math.PI * 2);
    ctx.moveTo(32, 60);
    ctx.lineTo(32, 130);
    ctx.moveTo(14, 112);
    ctx.lineTo(50, 112);
    ctx.stroke();
    // Swallow-tail cut.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(0, 256);
    ctx.lineTo(32, 220);
    ctx.lineTo(64, 256);
    ctx.fill();
    return toTex(c, false);
  })();
  const banners = new Batch(bakedMat(bannerT, { side: DoubleSide, alphaTest: 0.5 }));
  for (const z of PIER_ZS.slice(2, 7)) for (const sx of [-1, 1]) banners.add(new PlaneGeometry(0.9, 3.4, 1, 6), sx * (PIER_X - 0.62), 6.0, z, 0, sx * Math.PI / 2, 0);

  const torchFlames: number[] = [];
  const sconce = new Batch(iron);
  for (const z of PIER_ZS) {
    for (const sx of [-1, 1]) {
      sconce.add(lathe([0, -0.25, 0.04, -0.2, 0.14, 0.05, 0.16, 0.12, 0, 0.1], 8), sx * (PIER_X - 0.72), 2.9, z);
      torchFlames.push(sx * (PIER_X - 0.72), 3.12, z);
    }
  }
  // Iron chandeliers on chains, ringed with candles.
  const chand = new Batch(iron);
  const chandFlames: number[] = [];
  for (const z of [-6.6, 3.0]) {
    chand.add(new TorusGeometry(1.1, 0.04, 6, 32), 0, 6.5, z, Math.PI / 2, 0, 0);
    chand.add(new TorusGeometry(0.6, 0.03, 6, 24), 0, 6.9, z, Math.PI / 2, 0, 0);
    chand.add(new CylinderGeometry(0.015, 0.015, 1, 4), 0, 6.9 + (ribH - 6.9) / 2, z, 0, 0, 0, 1, ribH - 6.9, 1);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      chandFlames.push(Math.cos(a) * 1.1, 6.65, z + Math.sin(a) * 1.1);
    }
    env.lights.push({ p: new Vector3(0, 6.3, z), color: 0xffd0a0, k: 0.9, r: 7 });
  }

  root.add(floor.build(env), stone.build(env), wood.build(env), studs.build(), banners.build(env), sconce.build(), chand.build());
  const torches = glowPoints(torchFlames, 0xc08aff, 0.35, 0.95);
  root.add(torches, glowPoints(torchFlames, 0x8a4aff, 1.3, 0.35), glowPoints(chandFlames, 0xffd8a0, 0.1), glowPoints(chandFlames, 0xff9a50, 0.4, 0.25));

  // Trap glyphs smouldering in the floor.
  const runeT = (() => {
    const [c, ctx] = canvas(256);
    ctx.translate(128, 128);
    ctx.strokeStyle = '#c08aff';
    ctx.shadowColor = '#c08aff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 5;
    for (const R of [112, 86]) {
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    for (let k = 0; k < 16; k++) {
      ctx.save();
      ctx.rotate((k / 16) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, -92);
      ctx.lineTo(7, -104);
      ctx.lineTo(-6, -106);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    for (let k = 0; k <= 7; k++) {
      const a = ((k * 3) / 7) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * 80, Math.sin(a) * 80);
    }
    ctx.stroke();
    return toTex(c, false);
  })();
  const runeMat = new MeshBasicMaterial({ map: runeT, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const runes: Mesh[] = [];
  for (const [x, z, s] of [[-2.4, 1.2, 1.6], [2.4, 1.2, 1.6], [0, 5.2, 2.2], [0, -8, 2.6]]) {
    const g = new Mesh(new PlaneGeometry(s, s), runeMat);
    g.rotation.x = -Math.PI / 2;
    g.position.set(x, 0.01, z);
    runes.push(g);
    root.add(g);
  }
  // Violet haze and motes.
  const mist: [number, number, number, number][] = [];
  for (let k = 0; k < 30; k++) mist.push([(r() - 0.5) * 10, 0.3 + r() * 1.2, -16 + r() * 26, 2.5 + r() * 3]);
  root.add(glowCards(mist, 0x5a2a9a, 0.12));
  const motes: number[] = [];
  for (let k = 0; k < 120; k++) motes.push((r() - 0.5) * 10, r() * 12, -16 + r() * 26);
  const motePts = glowPoints(motes, 0xb88aff, 0.05, 0.7);
  root.add(motePts);
  root.add(glowCards([[0, 11.6, DOOR_Z - 0.3, 7]], 0x9a60ff, 0.3), glowCards([[0, 4.5, -16.5, 9]], 0x8a60ff, 0.35));

  const wallMap = wallSurface(507, [214, 208, 226], 0.16, (ctx, w, h) => {
    // Ashlar blocks faintly scored into the pale screen.
    ctx.strokeStyle = 'rgba(60,50,80,0.25)';
    ctx.lineWidth = 3;
    const rows = 5;
    for (let y = 1; y < rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, (y * h) / rows);
      ctx.lineTo(w, (y * h) / rows);
      ctx.stroke();
      for (let x = (y % 2) * 100; x < w; x += 200) {
        ctx.beginPath();
        ctx.moveTo(x, ((y - 1) * h) / rows);
        ctx.lineTo(x, (y * h) / rows);
        ctx.stroke();
      }
    }
  });

  let flare = 0;
  return {
    root,
    look: { wallTint: 0xe0d8ee, wallMap, hemiSky: 0x6a4a9a, hemiGround: 0x08060e, hemiIntensity: 0.55, fog: new FogExp2(0x0c0618, 0.04) },
    envLights: [[-4, 3, 0, violet, 6], [4, 3, 0, violet, 6], [0, 11, 10, 0xc070ff, 6], [0, 6, -3, 0xffd0a0, 3]],
    react: () => (flare = 1),
    update(dt, t) {
      flare = Math.max(0, flare - dt * 0.8);
      runes.forEach((g, i) => (g.rotation.z = t * (0.12 + i * 0.04) * (i % 2 ? -1 : 1)));
      runeMat.opacity = 0.5 + 0.2 * Math.sin(t * 1.7) + flare * 0.45;
      (torches.material as PointsMaterial).size = 0.35 * (1 + 0.1 * Math.sin(t * 11) + flare * 0.8);
      motePts.position.y = Math.sin(t * 0.1) * 0.3;
    },
  };
}
