import {
  CatmullRomCurve3,
  Color,
  ConeGeometry,
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
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from '@iwsdk/core';
import { EYE_Y, WALL_Z } from '../layout.js';
import {
  archBand,
  azX,
  type Bake,
  Batch,
  bakedMat,
  canvas,
  elY,
  glowCards,
  glowPoints,
  islandRock,
  noise3,
  rng,
  skyBlob,
  skyDome,
  skyGradient,
  skyStars,
  stoneTex,
  toTex,
  wallSurface,
  type WorldSet,
} from './kit.js';

/**
 * D. THE SKY KINGDOM — floating islands above a sea of clouds at golden hour:
 * white-and-gold palaces with teal spires, waterfalls pouring off island rims
 * into the clouds, arched bridges, blossom trees and drifting crystals. You
 * sit on a marble terrace at the edge of your own island; the shadow wall is a
 * marble gateway, and beyond it a meadow island where battles are fought.
 */

const SUN = new Vector3(-0.42, 0.22, -0.88).normalize();

/** Painted cloud card: soft billows, sunlit tops, lavender undersides. */
function cloudTex(seed: number): ReturnType<typeof toTex> {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const r = rng(seed);
  const puffs: [number, number, number][] = [];
  for (let k = 0; k < 26; k++) {
    const x = W * (0.15 + r() * 0.7);
    const rr = 30 + r() * 60;
    const y = H * 0.62 - Math.sin(((x / W) - 0.15) / 0.7 * Math.PI) * H * 0.25 * r() - rr * 0.2;
    puffs.push([x, y, rr]);
  }
  // Shadowed base layer, then lit layer shifted up.
  for (const [pass, dy, col] of [[0, 8, '200,190,235'], [1, -6, '255,248,240']] as const) {
    for (const [x, y, rr] of puffs) {
      const g = ctx.createRadialGradient(x, y + dy, 0, x, y + dy, rr);
      g.addColorStop(0, `rgba(${col},${pass ? 0.9 : 0.95})`);
      g.addColorStop(0.6, `rgba(${col},${pass ? 0.5 : 0.7})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y + dy, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Warm sunlit rim on top.
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,214,170,0.55)');
  g.addColorStop(0.5, 'rgba(255,214,170,0)');
  g.addColorStop(1, 'rgba(170,150,220,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return toTex(c, false);
}

/** Waterfall streaks (scrolling). */
function fallTex(): ReturnType<typeof toTex> {
  const [c, ctx] = canvas(128, 256);
  const r = rng(9);
  ctx.fillStyle = 'rgba(200,235,255,0.35)';
  ctx.fillRect(0, 0, 128, 256);
  for (let k = 0; k < 90; k++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.6})`;
    ctx.fillRect(r() * 128, r() * 256, 1 + r() * 4, 30 + r() * 90);
  }
  // Soft side edges.
  ctx.globalCompositeOperation = 'destination-out';
  const e = ctx.createLinearGradient(0, 0, 128, 0);
  e.addColorStop(0, 'rgba(0,0,0,1)');
  e.addColorStop(0.2, 'rgba(0,0,0,0)');
  e.addColorStop(0.8, 'rgba(0,0,0,0)');
  e.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = e;
  ctx.fillRect(0, 0, 128, 256);
  const t = toTex(c, false);
  t.wrapT = RepeatWrapping;
  return t;
}

/** Grassy island top: a lumpy disc, slightly domed, radius 1 at y = 0. */
function islandTop(seed: number): CylinderGeometry {
  const g = new CylinderGeometry(1, 1, 0.22, 28, 1, false);
  g.translate(0, -0.11, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const rr = Math.hypot(x, z);
    if (rr < 1e-4) {
      p.setY(i, p.getY(i) + 0.05);
      continue;
    }
    const a = Math.atan2(z, x);
    const k = 1 + noise3(Math.cos(a) * 2 + seed, seed, Math.sin(a) * 2) * 0.12;
    p.setXYZ(i, x * k, p.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

export function sky(): WorldSet {
  const root = new Group();
  const r = rng(101);

  // --- The painted sky ---------------------------------------------------------
  root.add(
    skyDome((ctx, w, h) => {
      skyGradient(ctx, w, h, [[90, '#1c2a78'], [55, '#3a5ab8'], [28, '#7a9ae0'], [12, '#e8b8d8'], [4, '#ffd2a8'], [0, '#ffe2c0'], [-8, '#d8b8e0'], [-30, '#8a8ad0'], [-90, '#4a4a9a']]);
      skyStars(ctx, w, h, 500, 103, 50, 0.5);
      // Golden sun low in the sky, and its haze.
      skyBlob(ctx, w, h, -25, 13, 90, 40, 'rgba(255,200,140,A)', 0.55);
      skyBlob(ctx, w, h, -25, 13, 14, 10, 'rgba(255,250,230,A)', 1);
      skyBlob(ctx, w, h, 140, 20, 120, 40, 'rgba(240,150,210,A)', 0.3);
      // A great ringed planet and a pale crescent moon.
      const px = azX(48, w);
      const py = elY(38, h);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(1, 1.15);
      const pg = ctx.createRadialGradient(-20, -20, 10, 0, 0, 70);
      pg.addColorStop(0, '#f8e0f0');
      pg.addColorStop(0.7, '#b890e0');
      pg.addColorStop(1, '#6a5ab8');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(0, 0, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,235,250,0.7)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(0, 0, 130, 22, -0.35, 0.2, Math.PI * 2 - 0.2);
      ctx.stroke();
      ctx.restore();
      const mx = azX(-70, w);
      const my = elY(48, h);
      ctx.fillStyle = 'rgba(255,250,240,0.9)';
      ctx.beginPath();
      ctx.arc(mx, my, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a72c8';
      ctx.beginPath();
      ctx.arc(mx + 9, my - 4, 20, 0, Math.PI * 2);
      ctx.fill();
      // A band of painted clouds around the horizon.
      const rr = rng(104);
      for (let k = 0; k < 260; k++) {
        const x = rr() * w;
        const el = -6 + Math.pow(rr(), 1.6) * 16;
        const y = elY(el, h);
        const s = 20 + rr() * 70;
        for (const [dy, col] of [[6, 'rgba(190,170,230,0.5)'], [-4, 'rgba(255,240,235,0.55)']] as const) {
          const g = ctx.createRadialGradient(x, y + dy, 0, x, y + dy, s);
          g.addColorStop(0, col);
          g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
          ctx.fillStyle = g;
          ctx.fillRect(x - s, y + dy - s, s * 2, s * 2);
        }
      }
    }),
  );

  // --- Materials -------------------------------------------------------------------
  const grassT = stoneTex({ seed: 601, base: [96, 168, 82], vary: 0.4, tint2: [170, 200, 90], tint2Amt: 0.35, size: 256 });
  const rockT = stoneTex({
    seed: 602,
    base: [168, 140, 128],
    vary: 0.5,
    tint2: [120, 108, 150],
    tint2Amt: 0.4,
    cracks: 14,
    paint: (ctx, s) => {
      // Sedimentary strata.
      const rr = rng(607);
      for (let y = 0; y < s; y += 6 + rr() * 18) {
        ctx.fillStyle = rr() < 0.5 ? 'rgba(90,60,70,0.22)' : 'rgba(255,230,210,0.16)';
        ctx.fillRect(0, y, s, 2 + rr() * 6);
      }
    },
  });
  const marbleT = stoneTex({
    seed: 603,
    base: [252, 248, 242],
    vary: 0.1,
    size: 256,
    paint: (ctx, s) => {
      const rr = rng(608);
      ctx.globalAlpha = 0.18;
      for (let k = 0; k < 10; k++) {
        ctx.strokeStyle = k % 2 ? '#b8b0c8' : '#d8b870';
        ctx.lineWidth = 1 + rr() * 2;
        ctx.beginPath();
        let x = rr() * s;
        let y = rr() * s;
        ctx.moveTo(x, y);
        for (let j = 0; j < 6; j++) {
          x += (rr() - 0.5) * 80;
          y += (rr() - 0.3) * 60;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  });
  const grass = new Batch(bakedMat(grassT));
  const stone = new Batch(bakedMat(rockT));
  const marble = new Batch(bakedMat(marbleT));
  const roofMat = new MeshStandardMaterial({ color: 0x2aa8c0, roughness: 0.35, metalness: 0.3, emissive: 0x0a3a50, emissiveIntensity: 0.6 });
  const roofs = new Batch(roofMat);
  const goldMat = new MeshStandardMaterial({ color: 0xf0c050, metalness: 0.9, roughness: 0.25, emissive: 0x7a5010, emissiveIntensity: 0.6 });
  const gold = new Batch(goldMat);
  const leafMat = new MeshBasicMaterial({ vertexColors: true });
  const foliage = new Batch(leafMat);
  const env: Bake = {
    sky: 0xc8d4ff,
    ground: 0x7a6a9a,
    amb: 0.8,
    ao: 0.2,
    aoHeight: 0.6,
    sun: { dir: SUN, color: 0xffd0a0, k: 0.75 },
    lights: [{ p: new Vector3(0, 1.5, 0), color: 0xffd8a8, k: 0.3, r: 5 }],
  };
  const falls: { x: number; y: number; z: number; h: number; w: number; ry: number }[] = [];
  const windows: number[] = [];
  const mistSpots: [number, number, number, number][] = [];

  const island = (x: number, y: number, z: number, rad: number, depth: number, seed: number, trees = 0) => {
    grass.add(islandTop(seed), x, y, z, 0, seed, 0, rad, 1, rad);
    stone.add(islandRock(seed, depth), x, y - 0.2, z, 0, seed, 0, rad * 1.02, 1, rad * 1.02, 0xffffff, [3, 2]);
    for (let k = 0; k < trees; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * rad * 0.7;
      const tx = x + Math.cos(a) * d;
      const tz = z + Math.sin(a) * d;
      const s = 0.4 + r() * 0.6;
      stone.add(new CylinderGeometry(0.06, 0.1, 1, 6), tx, y + 0.5 * s, tz, 0, 0, 0, s, s, s, 0x9a7a60);
      const pink = r() < 0.4;
      foliage.add(new IcosahedronGeometry(0.55, 1), tx, y + 1.25 * s, tz, 0, r() * 6, 0, s, s * 0.85, s, pink ? 0xf0a0d0 : 0x5aa850);
      foliage.add(new IcosahedronGeometry(0.4, 1), tx + 0.25 * s, y + 1.0 * s, tz + 0.2 * s, 0, 0, 0, s, s, s, pink ? 0xe880c0 : 0x4a9440);
    }
  };
  const fall = (x: number, y: number, z: number, h: number, w = 1.2) => {
    falls.push({ x, y, z, h, w, ry: Math.atan2(x, z) });
    mistSpots.push([x, y - h + 0.5, z, w * 3]);
  };
  const palace = (x: number, y: number, z: number, s: number, seed: number) => {
    island(x, y, z, 7 * s, 9 * s, seed, 3);
    // Curtain wall ring with crenels.
    const ring = 12;
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      marble.box(x + Math.cos(a) * 4.6 * s, y + 1.0 * s, z + Math.sin(a) * 4.6 * s, 2.5 * s, 2.0 * s, 0.5 * s, 0xf4eee4, 2, -a + Math.PI / 2);
      marble.box(x + Math.cos(a) * 4.6 * s, y + 2.15 * s, z + Math.sin(a) * 4.6 * s, 0.6 * s, 0.4 * s, 0.6 * s, 0xffffff, 1, -a);
    }
    // Keep with a grand central spire.
    marble.box(x, y + 2.6 * s, z, 4 * s, 5.2 * s, 4 * s, 0xf0e8dc, 2);
    marble.add(new CylinderGeometry(1, 1.1, 1, 16), x, y + 8.5 * s, z, 0, 0, 0, 1.1 * s, 7 * s, 1.1 * s, 0xf8f2ea);
    roofs.add(new ConeGeometry(1, 1, 16), x, y + 14 * s, z, 0, 0, 0, 1.5 * s, 4.5 * s, 1.5 * s);
    gold.add(new SphereGeometry(0.25, 10, 8), x, y + 16.4 * s, z, 0, 0, 0, s, s, s);
    gold.add(new CylinderGeometry(0.03, 0.03, 1.4, 4), x, y + 17.2 * s, z, 0, 0, 0, s, s, s);
    gold.add(new SphereGeometry(1.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, y + 5.2 * s, z, 0, 0, 0, s, s, s);
    // Towers around.
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + seed;
      const tx = x + Math.cos(a) * 4.6 * s;
      const tz = z + Math.sin(a) * 4.6 * s;
      const th = (3.5 + ((k * 7 + seed * 3) % 5)) * s;
      const tr = (0.55 + (k % 3) * 0.12) * s;
      marble.add(new CylinderGeometry(1, 1.08, 1, 12), tx, y + th / 2, tz, 0, 0, 0, tr, th, tr, 0xfaf4ec);
      gold.add(new CylinderGeometry(1, 1, 1, 12), tx, y + th, tz, 0, 0, 0, tr * 1.12, 0.12 * s, tr * 1.12);
      roofs.add(new ConeGeometry(1, 1, 12), tx, y + th + tr * 1.3, tz, 0, 0, 0, tr * 1.3, tr * 2.6, tr * 1.3);
      gold.add(new SphereGeometry(0.12, 6, 4), tx, y + th + tr * 2.7, tz, 0, 0, 0, s, s, s);
      for (let j = 1; j <= 3; j++) windows.push(tx + Math.cos(a) * tr, y + (th * j) / 4, tz + Math.sin(a) * tr);
    }
    for (let j = 1; j <= 4; j++) windows.push(x, y + 5 * s + j * 1.4 * s, z + 1.12 * s);
    // Waterfalls pouring off the rim toward the clouds.
    for (let k = 0; k < 3; k++) {
      const a = seed * 1.7 + k * 2.1;
      fall(x + Math.cos(a) * 7 * s, y - 0.1, z + Math.sin(a) * 7 * s, 12 * s + 6, 1.6 * s);
    }
  };

  // --- The player's island and terrace ------------------------------------------
  island(0, 0, 1.2, 4.6, 7, 3);
  const terrace = new CylinderGeometry(3.3, 3.3, 0.12, 48, 1);
  marble.add(terrace, 0, 0.05, 0.4, 0, 0, 0, 1, 1, 1, 0xffffff, [1.6, 1.6]);
  // Gold inlay ring and a compass rose.
  gold.add(new CylinderGeometry(3.32, 3.32, 0.02, 64, 1, true), 0, 0.11, 0.4);
  // Balustrade around the back of the terrace.
  for (let k = 0; k <= 26; k++) {
    const a = Math.PI * 0.08 + (k / 26) * Math.PI * 0.84;
    const bx = Math.cos(a) * 3.15;
    const bz = 0.4 + Math.sin(a) * 3.15;
    marble.add(BALUSTER, bx, 0.11, bz, 0, 0, 0, 1, 1, 1, 0xf8f2ea);
  }
  for (let k = 0; k < 26; k++) {
    const a0 = Math.PI * 0.08 + (k / 26) * Math.PI * 0.84;
    const a1 = Math.PI * 0.08 + ((k + 1) / 26) * Math.PI * 0.84;
    const mx = (Math.cos(a0) + Math.cos(a1)) * 0.5 * 3.15;
    const mz = 0.4 + (Math.sin(a0) + Math.sin(a1)) * 0.5 * 3.15;
    marble.box(mx, 0.86, mz, 0.42, 0.08, 0.18, 0xffffff, 1, -(a0 + a1) / 2 + Math.PI / 2);
  }
  // Urns with flowers on the balustrade ends.
  for (const sx of [-1, 1]) {
    gold.add(URN, sx * 3.1, 0.12, 0.65, 0, 0, 0, 1, 1, 1);
    foliage.add(new IcosahedronGeometry(0.22, 1), sx * 3.1, 0.82, 0.65, 0, 0, 0, 1, 0.8, 1, 0xff90c8);
  }
  fall(-3.2, -0.1, 4.2, 14, 1.2);

  // --- The marble gateway framing the shadow wall -------------------------------
  marble.box(0, -0.12, WALL_Z - 0.2, 8.6, 0.5, 1.4, 0xf0e8dc, 2);
  for (const sx of [-1, 1]) {
    marble.box(sx * 3.95, 2.2, WALL_Z - 0.2, 0.8, 4.4, 0.8, 0xf8f2ea, 1.5);
    gold.box(sx * 3.95, 4.45, WALL_Z - 0.2, 0.95, 0.12, 0.95);
    gold.box(sx * 3.95, 0.2, WALL_Z - 0.2, 0.95, 0.12, 0.95);
  }
  marble.add(new ExtrudeGeometry(archBand(8.7, 7.1, 0, 'round'), { depth: 0.7, bevelEnabled: false, curveSegments: 20 }), 0, 4.5, WALL_Z - 0.55, 0, 0, 0, 1, 0.45, 1, 0xfaf4ec, [0.5, 0.5]);
  gold.add(new ExtrudeGeometry(archBand(7.2, 7.0, 0, 'round'), { depth: 0.75, bevelEnabled: false, curveSegments: 20 }), 0, 4.5, WALL_Z - 0.58, 0, 0, 0, 1, 0.45, 1);
  gold.add(new OctahedronGeometry(0.35, 0), 0, 4.5 + 4.35 * 0.45 + 0.4, WALL_Z - 0.2, 0, 0, 0, 1, 1.6, 1);

  // --- The meadow island beyond the gateway (battleground) ------------------------
  island(0, -0.03, -9.5, 8.5, 9, 11, 0);
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2;
    const d = 6 + r() * 2.2;
    const x = Math.cos(a) * d;
    const z = -9.5 + Math.sin(a) * d;
    if (Math.abs(x) < 4.5 && z > -14) continue;
    island(x, 0, z, 0.01, 0.01, 0, 1);
  }
  fall(6.5, -0.1, -13, 18, 2);
  fall(-7.8, -0.1, -7, 16, 1.6);

  // --- Palaces and floating islands -------------------------------------------------
  palace(28, 3, -30, 1.25, 1);
  palace(-34, 10, 14, 0.9, 2);
  palace(0, 6, -62, 1.6, 3);
  palace(40, -2, 26, 0.8, 4);
  const smalls: { x: number; y: number; z: number; s: number }[] = [];
  let guard = 0;
  while (smalls.length < 16 && guard++ < 2000) {
    const a = r() * Math.PI * 2;
    const d = 12 + r() * 34;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x) < 9 && z < 0 && z > -20) continue;
    smalls.push({ x, y: -4 + r() * 16, z, s: 1 + r() * 2.6 });
  }
  smalls.forEach((it, i) => {
    island(it.x, it.y, it.z, it.s * 1.6, it.s * 2.6, 20 + i, Math.floor(it.s));
    if (i % 3 === 0) fall(it.x + it.s * 1.5, it.y - 0.1, it.z, it.s * 5, 0.6 * it.s);
  });
  // Arched bridges linking palace islands, and a rope bridge to the left islet.
  const bridge = (a: Vector3, b: Vector3, arch: number) => {
    const n = 18;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const p = a.clone().lerp(b, u);
      p.y += Math.sin(u * Math.PI) * arch;
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      marble.box(p.x, p.y, p.z, 1.6, 0.3, a.distanceTo(b) / n + 0.05, 0xf4eee4, 1, yaw);
      if (k % 3 === 0) gold.add(new SphereGeometry(0.12, 6, 4), p.x + Math.cos(yaw) * 0.75, p.y + 0.6, p.z - Math.sin(yaw) * 0.75);
    }
  };
  bridge(new Vector3(20, 3, -26), new Vector3(10, 1, -14), 2.5);
  bridge(new Vector3(-26, 10, 10), new Vector3(-14, 6, 2), 2);
  const planks = new InstancedMesh(new PlaneGeometry(0.9, 0.24), new MeshBasicMaterial({ side: DoubleSide }), 30);
  const lanterns: number[] = [];
  const pa = new Vector3(-3.6, 0.05, 2.2);
  const pb = new Vector3(-10.5, 0.8, 6.2);
  const m4 = new Matrix4();
  const q = new Quaternion();
  for (let k = 0; k < 30; k++) {
    const u = k / 29;
    const p = pa.clone().lerp(pb, u);
    p.y -= Math.sin(u * Math.PI) * 0.6;
    q.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(pb.x - pa.x, pb.z - pa.z) + Math.PI / 2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
    planks.setMatrixAt(k, m4.compose(p, q, new Vector3(1, 1, 1)));
    planks.setColorAt(k, new Color(k % 2 ? 0x9a6a48 : 0x8a5a3a));
    if (k % 6 === 0) lanterns.push(p.x, p.y + 0.7, p.z);
  }
  planks.instanceMatrix.needsUpdate = true;
  const ropeCurve = new CatmullRomCurve3([pa.clone().setY(0.6), pa.clone().lerp(pb, 0.5).setY(0.3), pb.clone().setY(1.4)]);
  root.add(planks, new Mesh(new TubeGeometry(ropeCurve, 24, 0.02, 4, false), new MeshBasicMaterial({ color: 0x6a4a30 })));
  island(-11.5, 0.8, 6.8, 2.2, 3.2, 40, 2);

  // --- Build ------------------------------------------------------------------------
  // Islands bob gently: the far ones in two groups.
  root.add(grass.build(env), stone.build(env), marble.build(env), roofs.build(), gold.build(), foliage.build(env));
  root.add(glowPoints(windows, 0x9af0ff, 0.6, 0.85), glowPoints(lanterns, 0xffc860, 0.4));

  // Waterfalls: curved sheets scrolling downward, mist where they meet the clouds.
  const fallT = fallTex();
  const fallMat = new MeshBasicMaterial({ map: fallT, transparent: true, depthWrite: false, side: DoubleSide, color: 0xf0f8ff });
  const fallB = new Batch(fallMat);
  for (const f of falls) {
    const g = new PlaneGeometry(f.w, f.h, 1, 8);
    g.translate(0, -f.h / 2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, -p.getY(i) / f.h);
      p.setZ(i, Math.sqrt(t) * f.w * 1.2);
    }
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (f.h / 6));
    fallB.add(g, f.x, f.y, f.z, 0, f.ry, 0);
  }
  root.add(fallB.build());
  root.add(glowCards(mistSpots, 0xffffff, 0.45));

  // Cloud sea below and cloud banks around.
  const cloudMats = [0, 1, 2].map((k) => new MeshBasicMaterial({ map: cloudTex(610 + k), transparent: true, depthWrite: false, blending: NormalBlending, fog: false, side: DoubleSide }));
  const cloudRoot = new Group();
  for (let k = 0; k < 54; k++) {
    const a = r() * Math.PI * 2;
    const d = 9 + r() * 55;
    const below = k < 34;
    const y = below ? -10 - r() * 6 : -2 + r() * 10;
    const c = new Mesh(new PlaneGeometry(1, 0.5), cloudMats[k % 3]);
    const s = below ? 22 + r() * 18 : 12 + r() * 14;
    c.scale.set(s, s, s);
    c.position.set(Math.cos(a) * d, y, Math.sin(a) * d);
    c.lookAt(0, below ? y + 25 : EYE_Y, 0);
    c.renderOrder = -5;
    cloudRoot.add(c);
  }
  root.add(cloudRoot);

  // Drifting crystals and golden motes.
  const crystals = new InstancedMesh(new OctahedronGeometry(0.22, 0), new MeshStandardMaterial({ color: 0xa8f0ff, emissive: 0x4ac0f0, emissiveIntensity: 1.3, roughness: 0.15, metalness: 0.2 }), 14);
  const crystalHome: Vector3[] = [];
  for (let k = 0; k < 14; k++) {
    const a = r() * Math.PI * 2;
    const d = 3.5 + r() * 6;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d + 1;
    if (z < WALL_Z && Math.abs(x) < 5) {
      k--;
      continue;
    }
    crystalHome.push(new Vector3(x, 1.4 + r() * 3, z));
  }
  root.add(crystals);
  const motes: number[] = [];
  for (let k = 0; k < 120; k++) motes.push((r() - 0.5) * 20, r() * 8, (r() - 0.5) * 20);
  const motePts = glowPoints(motes, 0xffe2a0, 0.06, 0.8);
  root.add(motePts);

  const wallMap = wallSurface(605, [244, 238, 228], 0.1, (ctx, w, h) => {
    const rr = rng(606);
    ctx.globalAlpha = 0.35;
    for (let k = 0; k < 14; k++) {
      ctx.strokeStyle = k % 3 ? 'rgba(180,170,190,0.8)' : 'rgba(210,170,80,0.9)';
      ctx.lineWidth = 1 + rr() * 2.5;
      ctx.beginPath();
      let x = rr() * w;
      let y = rr() * h;
      ctx.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += (rr() - 0.4) * 140;
        y += (rr() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(210,160,60,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);
  });

  let sparkle = 0;
  const pq = new Quaternion();
  const ps = new Vector3(1, 1, 1);
  const pv = new Vector3();
  return {
    root,
    look: { wallTint: 0xfff6ea, wallMap, hemiSky: 0xffe2c8, hemiGround: 0x5a6aa0, hemiIntensity: 0.95, fog: new FogExp2(0xd8c0d8, 0.0075) },
    envLights: [[-20, 10, -40, 0xffd0a0, 10], [0, 30, 0, 0xb8c8ff, 4], [30, 5, 20, 0xf0a0d0, 3]],
    react: () => (sparkle = 1),
    update(dt, t) {
      sparkle = Math.max(0, sparkle - dt * 0.6);
      fallT.offset.y = (fallT.offset.y + dt * 0.8) % 1;
      cloudRoot.rotation.y = t * 0.003;
      for (let i = 0; i < crystalHome.length; i++) {
        const h = crystalHome[i];
        pq.setFromAxisAngle(pv.set(0, 1, 0), t * 0.6 + i);
        crystals.setMatrixAt(i, m4.compose(pv.set(h.x, h.y + Math.sin(t * 0.7 + i) * 0.15, h.z), pq, ps.setScalar(1 + sparkle * 0.6)));
      }
      crystals.instanceMatrix.needsUpdate = true;
      motePts.position.y = Math.sin(t * 0.15) * 0.3;
    },
  };
}

const BALUSTER = (() => {
  const g = new CylinderGeometry(0.06, 0.06, 0.7, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + 0.6 * Math.exp(-((y + 0.12) ** 2) * 40);
    p.setXYZ(i, p.getX(i) * k, y + 0.38, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
})();
const URN = (() => {
  const g = new CylinderGeometry(0.16, 0.1, 0.62, 12);
  g.translate(0, 0.31, 0);
  return g;
})();
