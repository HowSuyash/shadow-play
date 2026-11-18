import { Group } from '@iwsdk/core';
import { STAGE } from '../scene/layout.js';
import { backdropMaterial, capsule, circle, ellipse, magicGlow, part, poly } from './shapes.js';

/**
 * Distant scenery drawn as faint silhouettes behind each chapter, like the
 * painted back-cloths of a shadow theatre. One mesh per backdrop.
 */
export type BackdropKind = 'village' | 'forest' | 'castle' | 'moon';

const G = STAGE.groundY;

function village(): Group {
  const shapes = [];
  const houses: [number, number, number][] = [
    [-1.25, 0.32, 0.36],
    [-0.75, 0.24, 0.3],
    [-0.35, 0.36, 0.34],
    [0.62, 0.28, 0.3],
    [1.05, 0.4, 0.38],
  ];
  for (const [x, w, h] of houses) {
    shapes.push(poly([x - w / 2, G, x + w / 2, G, x + w / 2, G + h, x, G + h + w * 0.45, x - w / 2, G + h]));
    shapes.push(poly([x + w * 0.18, G + h + 0.02, x + w * 0.3, G + h + 0.02, x + w * 0.3, G + h + w * 0.42, x + w * 0.18, G + h + w * 0.42])); // chimney
  }
  const g = new Group();
  g.add(part(shapes, backdropMaterial()));
  return g;
}

function forest(): Group {
  const shapes = [];
  const trees = [-1.35, -1.05, -0.62, -0.2, 0.85, 1.25];
  trees.forEach((x, i) => {
    const h = 0.75 + (i % 3) * 0.18;
    shapes.push(poly([x - 0.03, G, x + 0.03, G, x + 0.02, G + h * 0.5, x - 0.02, G + h * 0.5]));
    for (let k = 0; k < 3; k++) {
      const y = G + h * (0.35 + k * 0.22);
      const w = 0.24 - k * 0.06;
      shapes.push(poly([x - w, y, x + w, y, x, y + 0.26]));
    }
  });
  // Roots creeping across the ground.
  for (const x of [-0.95, 0.05, 1.0]) {
    shapes.push(capsule(x - 0.2, G + 0.01, x + 0.2, G + 0.04, 0.025), capsule(x, G + 0.04, x + 0.28, G + 0.01, 0.02));
  }
  const g = new Group();
  g.add(part(shapes, backdropMaterial()));
  return g;
}

function castle(): Group {
  const shapes = [];
  // Distant keep with towers and battlements.
  const tower = (x: number, w: number, h: number) => {
    shapes.push(poly([x - w / 2, G, x + w / 2, G, x + w / 2, G + h, x - w / 2, G + h]));
    for (let mx = x - w / 2; mx < x + w / 2 - 0.02; mx += 0.07) {
      shapes.push(poly([mx, G + h - 0.01, mx + 0.04, G + h - 0.01, mx + 0.04, G + h + 0.05, mx, G + h + 0.05]));
    }
    shapes.push(poly([x - w / 2 - 0.02, G + h + 0.05, x + w / 2 + 0.02, G + h + 0.05, x, G + h + 0.28])); // spire
  };
  tower(-1.15, 0.22, 0.95);
  tower(-0.55, 0.3, 0.7);
  tower(1.15, 0.24, 1.0);
  shapes.push(poly([-1.3, G, 1.35, G, 1.35, G + 0.42, -1.3, G + 0.42]));
  const g = new Group();
  g.add(part(shapes, backdropMaterial(0.3)));
  return g;
}

function moon(): Group {
  const g = new Group();
  // A huge pale moon behind everything, and floating islands.
  const glowMoon = magicGlow(1.5, 0xc9b6ff, 0.45);
  glowMoon.position.set(-0.55, G + 1.0, -0.004);
  const disc = part([circle(-0.55, G + 1.0, 0.36)], backdropMaterial(0.22));
  const islands = [];
  for (const [x, y, w] of [
    [-1.15, G + 0.62, 0.3],
    [0.05, G + 1.05, 0.22],
    [1.1, G + 0.82, 0.28],
  ] as const) {
    islands.push(ellipse(x, y, w, 0.035), poly([x - w * 0.8, y, x + w * 0.8, y, x + 0.04, y - 0.22]));
  }
  g.add(glowMoon, disc, part(islands, backdropMaterial(0.5)));
  return g;
}

export function makeBackdrop(kind: BackdropKind): Group {
  const g = kind === 'village' ? village() : kind === 'forest' ? forest() : kind === 'castle' ? castle() : moon();
  g.position.z = -0.003; // behind the stage silhouettes
  return g;
}
