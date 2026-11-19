import {
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  FogExp2,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type PointsMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
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
  skyBlob,
  skyDome,
  skyGradient,
  skyStars,
  stoneTex,
  tiled,
  toTex,
  wallSurface,
  type WorldSet,
  azX,
  elY,
} from './kit.js';

/**
 * A. THE SHADOW THEATRE — the game's home: an ancient Dravidian temple hall
 * where shadow puppetry (Tholu Bommalata / Tholpavakoothu) was performed.
 *
 * Seated at the centre of a pillared mandapa: the great cloth screen in its
 * carved stone proscenium ahead, backlit leather-puppet screens along the
 * aisles, hanging brass lamps, and behind you a candlelit stair rising to a
 * moonlit keyhole arch. Beyond the screen lies a moonlit gopuram courtyard,
 * revealed when the screen sinks away for battle.
 */

const HALL_H = 7.6;
const FRONT_Z = WALL_Z - 0.12;
const BACK_Z = 12.6;

/** Painted backlit leather puppet on a glowing cloth screen. */
function puppetTexture(variant: number): ReturnType<typeof toTex> {
  const W = 256;
  const H = 384;
  const [c, ctx] = canvas(W, H);
  // Glowing cloth: lamp-lit centre, burnt edges.
  const g = ctx.createRadialGradient(W / 2, H * 0.48, 10, W / 2, H * 0.5, H * 0.62);
  g.addColorStop(0, '#fff0c8');
  g.addColorStop(0.45, '#f4b25a');
  g.addColorStop(0.8, '#a2481a');
  g.addColorStop(1, '#2a0d04');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#5a2a0a';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(W / 2, H * 0.56);
  if (variant % 2) ctx.scale(-1, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const ink = '#2a0c02';
  const shape = (pts: number[], fill: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.stroke();
  };
  const limb = (pts: number[], w: number, fill: string) => {
    for (const [col, lw] of [[ink, w + 5], [fill, w]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.stroke();
    }
  };
  const dots = (x0: number, y0: number, x1: number, y1: number, n: number, col = '#fff6d0') => {
    ctx.fillStyle = col;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.arc(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const skin = variant < 2 ? 'rgba(178,58,26,0.92)' : 'rgba(54,96,150,0.92)';
  const gold = 'rgba(232,170,48,0.95)';
  const cloth = variant < 2 ? 'rgba(196,40,40,0.9)' : 'rgba(40,120,60,0.9)';
  // Legs and feet (profile stance).
  limb([-14, 60, -24, 120, -34, 140], 13, skin);
  limb([14, 60, 30, 118, 44, 136], 13, skin);
  dots(-30, 132, -18, 132, 3, gold);
  // Flared dhoti / sari with bands.
  shape([-34, -14, 36, -14, 58, 74, -56, 74], cloth);
  for (let k = 0; k < 3; k++) dots(-48 + k * 4, 20 + k * 18, 48 - k * 4, 20 + k * 18, 12);
  shape([-36, -18, 38, -18, 40, -4, -38, -4], gold);
  // Torso, necklace.
  shape([-30, -96, 30, -98, 26, -16, -26, -16], skin);
  ctx.strokeStyle = gold;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(2, -96, 22, 0.2, Math.PI - 0.2);
  ctx.stroke();
  dots(-18, -60, 20, -60, 6);
  // Arms: one raised with a bow / a mudra, one forward.
  if (variant === 0 || variant === 2) {
    limb([24, -90, 58, -110, 78, -140], 11, skin);
    ctx.strokeStyle = gold;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(64, -142, 46, -1.2, 1.4);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(-1.2) * 46, -142 + Math.sin(-1.2) * 46);
    ctx.lineTo(64 + Math.cos(1.4) * 46, -142 + Math.sin(1.4) * 46);
    ctx.stroke();
    limb([-24, -88, -50, -60, -40, -30], 11, skin);
  } else {
    limb([24, -90, 52, -70, 70, -86], 10, skin);
    limb([-24, -88, -46, -110, -30, -132], 10, skin);
    dots(66, -90, 74, -82, 2, gold);
  }
  // Head in profile, big almond eye, ear ornament.
  ctx.beginPath();
  ctx.ellipse(4, -124, 21, 25, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.stroke();
  shape([22, -128, 32, -118, 22, -114], skin);
  ctx.fillStyle = '#fff6e0';
  ctx.beginPath();
  ctx.ellipse(12, -128, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(14, -128, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.arc(-8, -116, 6, 0, Math.PI * 2);
  ctx.fill();
  // Crown (kireedam) or hair bun.
  if (variant === 1) {
    ctx.beginPath();
    ctx.ellipse(-16, -146, 16, 14, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,14,8,0.95)';
    ctx.fill();
    dots(-28, -150, -4, -156, 5, gold);
  } else {
    shape([-20, -144, 24, -144, 16, -176, 4, -214, -10, -178], gold);
    dots(-14, -150, 18, -150, 6, '#c02a1a');
    dots(2, -160, 4, -200, 5, '#c02a1a');
  }
  // The puppeteer's rods.
  ctx.strokeStyle = 'rgba(40,16,6,0.8)';
  ctx.lineWidth = 2;
  for (const [x, y] of [[0, 70], [78, -140], [-40, -30]]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x * 0.6, 210);
    ctx.stroke();
  }
  ctx.restore();
  // Burnt vignette edge.
  const v = ctx.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(20,6,0,0.6)');
  v.addColorStop(0.12, 'rgba(20,6,0,0)');
  v.addColorStop(0.88, 'rgba(20,6,0,0)');
  v.addColorStop(1, 'rgba(20,6,0,0.7)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  return toTex(c, false);
}

/** Carved stone: masonry with a frieze of lotus/diamond carving every other row. */
function templeStone(seed: number, base: [number, number, number], rows = 4): ReturnType<typeof stoneTex> {
  return stoneTex({
    seed,
    base,
    vary: 0.5,
    rows,
    cols: 2,
    mortar: 2,
    cracks: 6,
    tint2: [70, 74, 58],
    tint2Amt: 0.25,
    paint: (ctx, s) => {
      // Carved bands: lotus petals and a diamond chain.
      const band = s / rows;
      ctx.lineWidth = 2;
      for (let row = 1; row < rows; row += 2) {
        const y = row * band + band / 2;
        for (let x = 0; x < s; x += 32) {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.beginPath();
          ctx.ellipse(x + 16, y + 2, 10, 16, 0, Math.PI, 0);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,230,190,0.18)';
          ctx.beginPath();
          ctx.ellipse(x + 16, y, 10, 16, 0, Math.PI, 0);
          ctx.stroke();
        }
      }
    },
  });
}

/** A Dravidian temple pillar: plinth, carved block, octagonal shaft, pot capital, bracket corbels. */
function addPillar(stone: Batch, brass: Batch, x: number, z: number, H: number, s = 1): void {
  stone.box(x, 0.22 * s, z, 1.05 * s, 0.44 * s, 1.05 * s, 0xb8a38c, 1.2);
  stone.box(x, 0.5 * s, z, 0.92 * s, 0.14 * s, 0.92 * s, 0xd0bca0, 1.2);
  stone.box(x, 1.25 * s, z, 0.78 * s, 1.36 * s, 0.78 * s, 0xc8b49a, 1.2);
  stone.box(x, 1.98 * s, z, 0.86 * s, 0.1 * s, 0.86 * s, 0xd8c4a8, 1.2);
  const shaftH = H - 2.03 * s - 1.65 * s;
  stone.add(OCT, x, 2.03 * s + shaftH / 2, z, 0, Math.PI / 8, 0, 0.62 * s, shaftH, 0.62 * s, 0xc0aa90, [1, shaftH / 1.2]);
  // Brass bands on the shaft.
  for (const k of [0.25, 0.7]) brass.add(RING, x, 2.03 * s + shaftH * k, z, 0, 0, 0, 0.7 * s, 0.08 * s, 0.7 * s);
  // Kalasa pot, abacus plate.
  stone.add(POT, x, H - 1.65 * s, z, 0, 0, 0, s, s, s, 0xcab69c);
  stone.box(x, H - 0.98 * s, z, 1.0 * s, 0.1 * s, 1.0 * s, 0xd8c4a8, 1.2);
  // Pushpa-potika bracket corbels in four directions, with lotus-bud pendants.
  stone.box(x, H - 0.66 * s, z, 2.0 * s, 0.26 * s, 0.44 * s, 0xc4ae94, 1.2);
  stone.box(x, H - 0.66 * s, z, 0.44 * s, 0.26 * s, 2.0 * s, 0xc4ae94, 1.2);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    stone.add(BUD, x + dx * 0.88 * s, H - 0.92 * s, z + dz * 0.88 * s, 0, 0, 0, s, s, s, 0xd8c4a8);
  }
  stone.box(x, H - 0.26 * s, z, 0.7 * s, 0.52 * s, 0.7 * s, 0xb09a80, 1.2);
}

const OCT = new CylinderGeometry(0.5, 0.5, 1, 8, 4, true);
const RING = new CylinderGeometry(0.5, 0.5, 1, 16, 1, false);
const POT = lathe([0.0, 0, 0.3, 0, 0.42, 0.18, 0.46, 0.36, 0.38, 0.52, 0.3, 0.6, 0.36, 0.64, 0.36, 0.68, 0.0, 0.68], 16);
const BUD = lathe([0, -0.22, 0.06, -0.18, 0.1, -0.08, 0.08, 0, 0, 0.02], 10);

/** A gopuram: a tiered temple gateway tower with niches, crowned by a barrel-vault and kalashas. */
function addGopuram(stone: Batch, brass: Batch, glow: number[], x: number, z: number, s: number, tiers = 7): void {
  // Two-storey stone base with a tall doorway (glowing).
  stone.box(x, 2.2 * s, z, 9 * s, 4.4 * s, 4.2 * s, 0xb09a82, 2);
  stone.box(x, 4.6 * s, z, 9.6 * s, 0.4 * s, 4.8 * s, 0xc8b49a, 2);
  let y = 4.8 * s;
  let w = 8.4 * s;
  let d = 3.8 * s;
  for (let k = 0; k < tiers; k++) {
    const h = 1.15 * s;
    stone.box(x, y + h / 2, z, w, h, d, k % 2 ? 0xb8a288 : 0xa89278, 2);
    // Cornice overhang.
    stone.box(x, y + h, z, w + 0.35 * s, 0.16 * s, d + 0.35 * s, 0xd0bca2, 2);
    // Niches (kudus) with tiny lit windows on the front and back faces.
    const n = Math.max(2, Math.round(w / (1.1 * s)));
    for (let j = 0; j < n; j++) {
      const nx = x - w / 2 + ((j + 0.5) * w) / n;
      for (const sz of [1, -1]) {
        stone.box(nx, y + h * 0.5, z + sz * (d / 2 + 0.06 * s), 0.42 * s, 0.7 * s, 0.14 * s, 0x6a5444, 1);
        if ((j + k) % 3 === 0 && sz === 1) glow.push(nx, y + h * 0.5, z + sz * (d / 2 + 0.16 * s));
      }
    }
    y += h + 0.16 * s;
    w *= 0.86;
    d *= 0.9;
  }
  // Shala barrel-vault crown with a row of kalashas.
  stone.add(new CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI), x, y, z, 0, 0, Math.PI / 2, d * 0.5, w * 1.05, d * 0.5, 0xb8a288);
  for (let j = -2; j <= 2; j++) brass.add(KALASHA, x + j * w * 0.18, y + d * 0.5, z, 0, 0, 0, s * 1.4, s * 1.4, s * 1.4);
  // The doorway.
  glow.push(x, 1.6 * s, z + 2.15 * s);
}
const KALASHA = lathe([0, 0, 0.2, 0.02, 0.26, 0.2, 0.12, 0.38, 0.06, 0.62, 0, 0.72], 12);

export function theatre(): WorldSet {
  const root = new Group();
  const r = rng(11);

  // --- Materials -----------------------------------------------------------
  const stoneT = templeStone(301, [150, 118, 88]);
  const stone = new Batch(bakedMat(stoneT));
  const darkStone = new Batch(bakedMat(templeStone(302, [96, 76, 62], 6)));
  const brassMat = new MeshStandardMaterial({ color: 0xd9a441, metalness: 0.85, roughness: 0.3, emissive: 0x6a3f0c, emissiveIntensity: 0.55 });
  const brass = new Batch(brassMat);
  const floorT = stoneTex({ seed: 303, base: [70, 52, 42], vary: 0.4, rows: 2, cols: 2, mortar: 2 });
  const floorB = new Batch(bakedMat(tiled(floorT, 1, 1)));

  // --- Baked lighting --------------------------------------------------------
  const warm = 0xffa84a;
  const lampSpots: Vector3[] = [];
  for (const z of [1.6, 4.4, 7.2]) for (const x of [-5.6, 0, 5.6]) lampSpots.push(new Vector3(x, 5.4, z));
  const hall: Bake = {
    sky: 0x3a4466,
    ground: 0x1c120c,
    amb: 0.42,
    ao: 0.55,
    aoHeight: 1.1,
    topDark: 4.5,
    lights: [
      // The two great kuthuvilakku lamps beside the screen.
      { p: new Vector3(-2.6, 2.2, WALL_Z + 0.5), color: warm, k: 2.2, r: 8 },
      { p: new Vector3(2.6, 2.2, WALL_Z + 0.5), color: warm, k: 2.2, r: 8 },
      // Hanging brass lamps.
      ...lampSpots.map((p) => ({ p, color: 0xffb35a, k: 0.9, r: 5.5 })),
      // Moonlight through the keyhole arch and the candles on the stair.
      { p: new Vector3(0, 3, BACK_Z - 0.3), color: 0x9ec4ff, k: 2.4, r: 11 },
      { p: new Vector3(0, 1.2, 10.4), color: warm, k: 1.6, r: 5 },
      // Puppet screens glowing in the aisles.
      ...[-1, 1].flatMap((sx) => [1.2, 4.6, 8].map((z) => ({ p: new Vector3(sx * 8.8, 2.6, z), color: 0xff9a3a, k: 1.0, r: 4.5 }))),
    ],
  };
  const yard: Bake = {
    sky: 0x5a6e9e,
    ground: 0x1a120c,
    amb: 0.42,
    ao: 0.4,
    sun: { dir: new Vector3(0.3, 0.8, -0.5).normalize(), color: 0x9ab8ff, k: 0.35 },
    lights: [
      { p: new Vector3(-2.6, 1.4, -3.2), color: warm, k: 1.6, r: 6 },
      { p: new Vector3(2.6, 1.4, -3.2), color: warm, k: 1.6, r: 6 },
      { p: new Vector3(0, 2, -20), color: warm, k: 2.5, r: 14 },
      ...[-1, 1].flatMap((sx) => [-6, -10, -14].map((z) => ({ p: new Vector3(sx * 5.4, 2.4, z), color: warm, k: 1.3, r: 5 }))),
    ],
  };

  // --- Sky (seen through the arch, the clerestory, and over the courtyard) ---
  root.add(
    skyDome((ctx, w, h) => {
      skyGradient(ctx, w, h, [[90, '#02030a'], [40, '#070c22'], [12, '#1a2346'], [0, '#3a3450'], [-10, '#0a0a12'], [-90, '#020203']]);
      skyBlob(ctx, w, h, -30, 30, 70, 22, 'rgba(90,60,160,A)', 0.18);
      skyBlob(ctx, w, h, 40, 18, 80, 16, 'rgba(60,90,170,A)', 0.2);
      skyStars(ctx, w, h, 2600, 7, 4);
      // A low warm moon over the courtyard gopuram.
      const mx = azX(8, w);
      const my = elY(24, h);
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 90);
      g.addColorStop(0, 'rgba(255,244,214,1)');
      g.addColorStop(0.18, 'rgba(255,236,200,1)');
      g.addColorStop(0.22, 'rgba(255,200,140,0.35)');
      g.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx - 90, my - 90, 180, 180);
      // The other side: a cold moon glow behind the keyhole.
      skyBlob(ctx, w, h, 180, 12, 40, 26, 'rgba(170,205,255,A)', 0.55);
    }),
  );

  // --- The hall --------------------------------------------------------------
  // Polished granite floor (subdivided so the light pools bake smoothly).
  const floorGeo = new PlaneGeometry(24, BACK_Z - FRONT_Z, 48, 30);
  floorB.add(floorGeo, 0, 0, (BACK_Z + FRONT_Z) / 2, -Math.PI / 2, 0, 0, 1, 1, 1, 0xffffff, [12, 7]);
  // Golden rangoli inlay around the player (a separate decal).
  const [rc, rctx] = canvas(512);
  rctx.translate(256, 256);
  rctx.strokeStyle = 'rgba(255,196,96,0.9)';
  rctx.fillStyle = 'rgba(255,196,96,0.9)';
  rctx.lineWidth = 3;
  for (let ring = 1; ring <= 5; ring++) {
    const R = ring * 46;
    rctx.beginPath();
    rctx.arc(0, 0, R, 0, Math.PI * 2);
    rctx.stroke();
    const n = 8 * ring;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      rctx.save();
      rctx.rotate(a);
      rctx.beginPath();
      rctx.ellipse(R - 20, 0, 16, 6, 0, 0, Math.PI * 2);
      rctx.stroke();
      if (ring % 2) {
        rctx.beginPath();
        rctx.arc(R + 6, 0, 2.5, 0, Math.PI * 2);
        rctx.fill();
      }
      rctx.restore();
    }
  }
  const rangoli = new Mesh(new PlaneGeometry(5.2, 5.2), new MeshBasicMaterial({ map: toTex(rc, false), transparent: true, opacity: 0.55, depthWrite: false, color: 0xffd08a }));
  rangoli.rotation.x = -Math.PI / 2;
  rangoli.position.set(0, 0.004, 0.6);
  root.add(rangoli);

  // Pillar rows: inner nave and outer aisles.
  for (const z of [0.3, 3.0, 5.8, 8.6]) {
    for (const sx of [-1, 1]) {
      addPillar(stone, brass, sx * 3.9, z, HALL_H);
      addPillar(stone, brass, sx * 7.2, z, HALL_H, 0.92);
    }
  }
  // The proscenium pillars flanking the screen.
  for (const sx of [-1, 1]) addPillar(stone, brass, sx * 4.15, WALL_Z + 0.25, HALL_H, 1.05);
  // Beams along the rows and across the nave; coffered ceiling slabs.
  for (const x of [-7.2, -3.9, 3.9, 7.2]) darkStone.box(x, HALL_H + 0.25, (BACK_Z + FRONT_Z) / 2 - 0.6, 0.8, 0.5, BACK_Z - FRONT_Z - 1.5, 0xa08870, 2);
  for (const z of [WALL_Z + 0.25, 0.3, 3.0, 5.8, 8.6]) darkStone.box(0, HALL_H + 0.25, z, 15.2, 0.5, 0.7, 0xa08870, 2);
  darkStone.box(0, HALL_H + 0.62, 5.4, 21, 0.25, 15, 0x6a5848, 3);
  // Lotus medallions in the ceiling coffers.
  for (const z of [1.65, 4.4, 7.2]) {
    for (const x of [-5.55, 0, 5.55]) {
      stone.add(new CylinderGeometry(0.9, 0.9, 0.08, 16), x, HALL_H + 0.45, z, 0, 0, 0, 1, 1, 1, 0x8a6e52);
      brass.add(new SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), x, HALL_H + 0.42, z);
    }
  }

  // Front wall: carved stone around the screen opening, with a cusped torana relief.
  const front = new Shape();
  front.moveTo(-11, -0.5);
  front.lineTo(11, -0.5);
  front.lineTo(11, HALL_H + 0.8);
  front.lineTo(-11, HALL_H + 0.8);
  front.lineTo(-11, -0.5);
  const hole = new Shape();
  hole.moveTo(-3.52, -0.3);
  hole.lineTo(3.52, -0.3);
  hole.lineTo(3.52, 4.27);
  hole.lineTo(-3.52, 4.27);
  hole.lineTo(-3.52, -0.3);
  front.holes.push(hole);
  const frontGeo = new ExtrudeGeometry(front, { depth: 0.6, bevelEnabled: false });
  stone.add(frontGeo, 0, 0, FRONT_Z - 0.6, 0, 0, 0, 1, 1, 1, 0x9a8470, [0.4, 0.4]);
  // Torana: a cusped arch band over the screen, with makara-head ends.
  // Built tall then squashed so the cusped head stays under the ceiling.
  const TOR_SQ = 0.6;
  const tor = archBand(8.2, 7.3, 4.35 / TOR_SQ, 'cusped');
  stone.add(new ExtrudeGeometry(tor, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 }), 0, 0, FRONT_Z, 0, 0, 0, 1, TOR_SQ, 1, 0xd8c0a0, [0.5, 0.5]);
  // Kirtimukha face at the crown of the torana.
  const crownY = 4.35 + 4.1 * 1.15 * TOR_SQ;
  stone.add(new SphereGeometry(0.42, 14, 10), 0, crownY - 0.05, FRONT_Z + 0.25, 0, 0, 0, 1, 1.1, 0.5, 0xe0c8a6);
  brass.add(new SphereGeometry(0.08, 8, 6), -0.15, crownY, FRONT_Z + 0.45);
  brass.add(new SphereGeometry(0.08, 8, 6), 0.15, crownY, FRONT_Z + 0.45);
  // A carved frieze band of dancing figures along the wall top.
  for (let k = 0; k < 22; k++) {
    const x = -10.5 + k;
    if (Math.abs(x) < 4.6) continue;
    stone.box(x, 5.6, FRONT_Z + 0.1, 0.5, 0.9, 0.2, k % 2 ? 0xd2baa0 : 0xc0a88e, 1);
  }

  // Side walls with clerestory windows (moon shafts) and backlit puppet screens.
  const puppetMats = [0, 1, 2, 3].map((v) => new MeshBasicMaterial({ map: puppetTexture(v), side: DoubleSide }));
  for (const sx of [-1, 1]) {
    darkStone.box(sx * 9.5, (HALL_H + 0.8) / 2, (BACK_Z + FRONT_Z) / 2, 0.6, HALL_H + 0.8, BACK_Z - FRONT_Z, 0x8a7460, 2.2);
    [1.65, 4.4, 7.2].forEach((z, i) => {
      const p = new Mesh(new PlaneGeometry(2.0, 3.0), puppetMats[(i + (sx > 0 ? 1 : 0)) % 4]);
      p.position.set(sx * 9.18, 2.65, z);
      p.rotation.y = -sx * Math.PI / 2;
      root.add(p);
      // Carved frame around each screen.
      for (const [dx, dy, w, h] of [[0, 1.6, 2.4, 0.2], [0, 1.0, 2.4, 0.2], [-1.1, 2.65, 0.2, 3.2], [1.1, 2.65, 0.2, 3.2]] as const) {
        const yy = dx === 0 ? (dy === 1.6 ? 4.25 : 1.05) : dy;
        darkStone.box(sx * 9.15, yy, z + dx * -sx, 0.14, h, w, 0xc8b090, 1);
      }
    });
  }

  // Back: a candlelit stair rising to the moonlit keyhole arch.
  const backWall = new Shape();
  backWall.moveTo(-11, 0);
  backWall.lineTo(11, 0);
  backWall.lineTo(11, HALL_H + 0.8);
  backWall.lineTo(-11, HALL_H + 0.8);
  backWall.lineTo(-11, 0);
  const door = archShape(2.8, 4.4, 'keyhole', new Shape());
  backWall.holes.push(door);
  darkStone.add(new ExtrudeGeometry(backWall, { depth: 0.6, bevelEnabled: false }), 0, 0, BACK_Z + 0.6, 0, Math.PI, 0, 1, 1, 1, 0x8a7460, [0.4, 0.4]);
  const doorLight = new Mesh(new ShapeGeometry(archShape(2.8, 4.4, 'keyhole')), new MeshBasicMaterial({ color: 0xd8e8ff, fog: false }));
  doorLight.position.set(0, 0, BACK_Z + 0.5);
  doorLight.rotation.y = Math.PI;
  root.add(doorLight);
  const steps: number[] = [];
  for (let k = 0; k < 8; k++) {
    const z = 9.6 + k * 0.38;
    const y = 0.12 + k * 0.14;
    stone.box(0, y / 2 + 0.0, z + 0.19, 6.4 - k * 0.25, y, 0.4, k % 2 ? 0xc8b49a : 0xb8a48a, 1.2);
    for (let c = 0; c < 6; c++) {
      for (const sx of [-1, 1]) steps.push(sx * (1.6 + c * 0.24 - k * 0.04 + (r() - 0.5) * 0.05), y, z + 0.06 + r() * 0.2);
    }
  }
  // Candles at the feet of the nave pillars too.
  for (const z of [0.3, 3.0, 5.8, 8.6]) for (const sx of [-1, 1]) for (let c = 0; c < 5; c++) steps.push(sx * (3.9 + (c - 2) * 0.22), 0, z + 0.62 + (c % 2) * 0.12);

  // --- The courtyard beyond the screen --------------------------------------
  const yardStone = new Batch(bakedMat(stoneT));
  const yardBrass = new Batch(brassMat);
  const yardFloor = new Batch(bakedMat(tiled(floorT, 1, 1)));
  yardFloor.add(new PlaneGeometry(40, 30, 40, 30), 0, 0, FRONT_Z - 15.02, -Math.PI / 2, 0, 0, 1, 1, 1, 0xd0c0b0, [16, 12]);
  for (const z of [-4.5, -8, -11.5, -15]) for (const sx of [-1, 1]) addPillar(yardStone, yardBrass, sx * 7, z, 5.4, 0.85);
  for (const sx of [-1, 1]) yardStone.box(sx * 7, 5.65, -9.75, 0.8, 0.5, 12, 0xa08870, 2);
  const towerGlow: number[] = [];
  addGopuram(yardStone, yardBrass, towerGlow, 0, -24, 1.25, 8);
  addGopuram(yardStone, yardBrass, towerGlow, -17, -19, 0.75, 6);
  addGopuram(yardStone, yardBrass, towerGlow, 17, -19, 0.75, 6);
  // Courtyard walls.
  for (const sx of [-1, 1]) yardStone.box(sx * 12, 2.2, -12, 0.8, 4.4, 20, 0x907a64, 2.5);
  // Lamp posts (deepastambha) lining the processional path.
  const yardFlames: number[] = [];
  for (const z of [-6, -10, -14, -18]) {
    for (const sx of [-1, 1]) {
      yardStone.add(new CylinderGeometry(0.1, 0.16, 2.2, 8), sx * 5.4, 1.1, z, 0, 0, 0, 1, 1, 1, 0xb8a48a);
      yardBrass.add(new CylinderGeometry(0.22, 0.1, 0.12, 12), sx * 5.4, 2.26, z);
      yardFlames.push(sx * 5.4, 2.42, z);
    }
  }

  // --- Build the baked meshes --------------------------------------------------
  root.add(floorB.build(hall), stone.build(hall), darkStone.build(hall), brass.build());
  root.add(yardFloor.build(yard), yardStone.build(yard), yardBrass.build());
  root.add(glowPoints(towerGlow, 0xffb050, 0.9, 0.9), glowPoints(yardFlames, 0xffb24a, 0.32), glowPoints(yardFlames, 0xff8a30, 1.4, 0.35));

  // --- Lamps and flames -------------------------------------------------------
  // Kuthuvilakku: tall brass lamps beside the screen.
  const tallLamp = lathe([0, 0, 0.26, 0, 0.28, 0.06, 0.1, 0.12, 0.06, 0.3, 0.05, 1.2, 0.09, 1.26, 0.04, 1.32, 0.035, 1.9, 0.24, 1.98, 0.22, 2.04, 0.05, 2.08, 0.03, 2.4, 0.07, 2.5, 0.0, 2.62], 18);
  const flames: number[] = [];
  for (const sx of [-1, 1]) {
    const l = new Mesh(tallLamp, brassMat);
    l.position.set(sx * 2.6, 0, WALL_Z + 0.5);
    root.add(l);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      flames.push(sx * 2.6 + Math.cos(a) * 0.21, 2.1, WALL_Z + 0.5 + Math.sin(a) * 0.21);
    }
  }
  // Hanging brass lamps on chains.
  const hanging = new Batch(brassMat);
  const chainMat = new MeshBasicMaterial({ color: 0x3a2a18 });
  const chains = new Batch(chainMat);
  for (const p of lampSpots) {
    hanging.add(lathe([0, 0, 0.28, 0.04, 0.34, 0.12, 0.3, 0.16, 0.0, 0.18], 16), p.x, p.y - 0.2, p.z);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      chains.add(new CylinderGeometry(0.008, 0.008, 1, 4), p.x + Math.cos(a) * 0.12, p.y + 0.35, p.z + Math.sin(a) * 0.12, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2, 1, 0.8, 1);
    }
    chains.add(new CylinderGeometry(0.01, 0.01, 1, 4), p.x, (p.y + 0.75 + HALL_H) / 2, p.z, 0, 0, 0, 1, HALL_H - p.y - 0.75, 1);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      flames.push(p.x + Math.cos(a) * 0.26, p.y - 0.06, p.z + Math.sin(a) * 0.26);
    }
  }
  root.add(hanging.build(), chains.build());

  // Floating brass diyas drifting around the player (the magic of the place).
  const diyaGeo = lathe([0, 0, 0.06, 0.005, 0.078, 0.028, 0.074, 0.034, 0.05, 0.02, 0, 0.02], 12);
  const diyaCount = 22;
  const diyas = new InstancedMesh(diyaGeo, brassMat, diyaCount);
  const diyaHome: Vector3[] = [];
  while (diyaHome.length < diyaCount) {
    const a = r() * Math.PI * 2;
    const d = 1.4 + r() * 2.4;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d + 0.8;
    if (z < WALL_Z + 0.6) continue;
    diyaHome.push(new Vector3(x, 1.9 + r() * 2.2, z));
  }
  const diyaFlameStart = flames.length / 3;
  for (const h of diyaHome) flames.push(h.x, h.y + 0.05, h.z);
  const flamePts = glowPoints(flames, 0xffc25a, 0.12);
  const flameHalo = glowPoints(flames, 0xff8a30, 0.55, 0.28);
  root.add(diyas, flamePts, flameHalo);

  // Candles: wax stubs (one instanced draw) + flames.
  const wax = new MeshBasicMaterial({ color: 0xf0dcb8 });
  const candles = new InstancedMesh(new CylinderGeometry(0.024, 0.027, 1, 7), wax, steps.length / 3);
  const candleFlames: number[] = [];
  const mtx = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const pp = new Vector3();
  for (let i = 0; i < steps.length / 3; i++) {
    const h = 0.07 + ((i * 37) % 10) * 0.014;
    const x = steps[i * 3];
    const y = steps[i * 3 + 1];
    const z = steps[i * 3 + 2];
    candles.setMatrixAt(i, mtx.compose(pp.set(x, y + h / 2, z), q, sc.set(1, h, 1)));
    candleFlames.push(x, y + h + 0.025, z);
  }
  candles.instanceMatrix.needsUpdate = true;
  root.add(candles, glowPoints(candleFlames, 0xffb04a, 0.09), glowPoints(candleFlames, 0xff7a20, 0.42, 0.22));

  // Marigold toran garlands draped across the top of the screen.
  const marigold = new InstancedMesh(new IcosahedronGeometry(0.05, 0), new MeshBasicMaterial({ color: 0xffa020 }), 120);
  let mi = 0;
  for (const [y0, sag, z] of [[4.42, 0.32, FRONT_Z + 0.35], [4.32, 0.18, FRONT_Z + 0.4]] as const) {
    for (let k = 0; k < 60; k++) {
      const u = k / 59;
      const x = -3.6 + u * 7.2;
      const y = y0 - Math.sin(u * Math.PI * 4) ** 2 * sag;
      marigold.setMatrixAt(mi, mtx.compose(pp.set(x, y, z), q, sc.set(1, 1, 1)));
      marigold.setColorAt(mi++, new Color(k % 3 ? 0xffa020 : 0xff6a10));
    }
  }
  marigold.instanceMatrix.needsUpdate = true;
  root.add(marigold);
  // Brass bells hanging from the torana.
  const bell = lathe([0, 0.1, 0.03, 0.09, 0.05, 0.02, 0.07, -0.04, 0.0, -0.04], 10);
  const bells = new Batch(brassMat);
  for (const x of [-3.0, -1.8, 1.8, 3.0]) bells.add(bell, x, 4.0, FRONT_Z + 0.42);
  root.add(bells.build());

  // --- Light and atmosphere ----------------------------------------------------
  root.add(
    lightShaft(new Vector3(0, 3.6, BACK_Z), new Vector3(0, 0, 6.5), 1.0, 2.6, 0x9ec4ff, 0.1),
    lightShaft(new Vector3(-9.2, 7.4, 3), new Vector3(-4.2, 0, 4.4), 0.5, 1.4, 0x8ab0ff, 0.06),
    lightShaft(new Vector3(9.2, 7.4, 6), new Vector3(4.2, 0, 6.6), 0.5, 1.4, 0x8ab0ff, 0.06),
    glowCards([[0, 2.2, BACK_Z - 0.5, 7]], 0xa8c8ff, 0.5),
  );
  // Clerestory window glow high in the side walls.
  const clere: [number, number, number, number][] = [];
  for (const sx of [-1, 1]) for (const z of [1.65, 4.4, 7.2]) clere.push([sx * 9.1, 6.6, z, 1.4]);
  root.add(glowCards(clere, 0x7a9cff, 0.35));
  // Golden dust motes drifting in the hall.
  const motes: number[] = [];
  for (let k = 0; k < 160; k++) motes.push((r() - 0.5) * 14, 0.6 + r() * 6.5, -1 + r() * 12);
  const motePts = glowPoints(motes, 0xffd27a, 0.045, 0.75);
  root.add(motePts);

  // The great screen: hand-woven cotton, lamp-warmed, with a stitched hem and seams.
  const cloth = wallSurface(305, [236, 214, 180], 0.12, (ctx, w, h) => {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#6a4020';
    for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
    for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
    ctx.globalAlpha = 1;
    // Panel seams where the cloth was sewn together.
    for (const x of [w / 3, (2 * w) / 3]) {
      ctx.fillStyle = 'rgba(120,80,40,0.16)';
      ctx.fillRect(x - 2, 0, 4, h);
      ctx.fillStyle = 'rgba(255,240,210,0.12)';
      ctx.fillRect(x + 2, 0, 2, h);
    }
    // A darker turned hem with a running stitch.
    ctx.strokeStyle = 'rgba(110,60,25,0.55)';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.strokeStyle = 'rgba(150,40,20,0.6)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, w - 44, h - 44);
    ctx.setLineDash([]);
    // Soft lamp-warmed falloff toward the edges.
    const g = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.2, w / 2, h * 0.55, w * 0.62);
    g.addColorStop(0, 'rgba(255,240,210,0)');
    g.addColorStop(1, 'rgba(90,40,10,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  let flare = 0;
  const flameMat = flamePts.material as PointsMaterial;
  const tmp = new Vector3();
  return {
    root,
    look: { wallTint: 0xffffff, wallMap: cloth, hemiSky: 0x7a5232, hemiGround: 0x0a0c18, hemiIntensity: 0.5, fog: new FogExp2(0x0a0a14, 0.028) },
    envLights: [[-2.6, 2.2, -1, warm, 6], [2.6, 2.2, -1, warm, 6], [0, 2, 12, 0x9ec4ff, 8], [0, 6, 4, 0xffb35a, 3]],
    react: () => (flare = 1),
    update(dt, t) {
      flare = Math.max(0, flare - dt * 0.8);
      const fp = flamePts.geometry.attributes.position;
      const hp = flameHalo.geometry.attributes.position;
      for (let i = 0; i < diyaHome.length; i++) {
        const h = diyaHome[i];
        const y = h.y + Math.sin(t * 0.8 + i * 1.7) * 0.07;
        diyas.setMatrixAt(i, mtx.compose(tmp.set(h.x, y, h.z), q, sc.set(1, 1, 1)));
        fp.setXYZ(diyaFlameStart + i, h.x, y + 0.05, h.z);
        hp.setXYZ(diyaFlameStart + i, h.x, y + 0.05, h.z);
      }
      diyas.instanceMatrix.needsUpdate = true;
      fp.needsUpdate = true;
      hp.needsUpdate = true;
      flameMat.size = 0.12 * (1 + 0.08 * Math.sin(t * 9) + flare * 0.9);
      motePts.rotation.y = Math.sin(t * 0.05) * 0.1;
      motePts.position.y = Math.sin(t * 0.13) * 0.15;
    },
  };
}
