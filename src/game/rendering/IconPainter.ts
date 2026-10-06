import type { DrawIcon } from '../../data/items';

/**
 * 2D canvas icons for non-block items. Simple bold shapes with a soft outline
 * so they read well at 40px in the hotbar. All original artwork.
 */
type Ctx = CanvasRenderingContext2D;

const OUT = 'rgba(40,28,18,0.85)';

function shade(hex: string, k: number): string {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((v >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((v >> 8) & 255) * k));
  const b = Math.min(255, Math.round((v & 255) * k));
  return `rgb(${r},${g},${b})`;
}

function blob(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string, rot = 0) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 2.5;
  c.strokeStyle = OUT;
  c.stroke();
  c.restore();
}

function stick(c: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, col: string) {
  c.lineCap = 'round';
  c.strokeStyle = OUT;
  c.lineWidth = w + 3;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
  c.strokeStyle = col;
  c.lineWidth = w;
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,0.25)';
  c.lineWidth = Math.max(1, w * 0.3);
  c.beginPath();
  c.moveTo(x0 - 1, y0 - 1);
  c.lineTo(x1 - 1, y1 - 1);
  c.stroke();
}

function poly(c: Ctx, pts: number[], fill: string) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = 2.5;
  c.lineJoin = 'round';
  c.strokeStyle = OUT;
  c.stroke();
}

function shine(c: Ctx, x: number, y: number, r: number) {
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath();
  c.ellipse(x, y, r, r * 0.6, -0.6, 0, Math.PI * 2);
  c.fill();
}

function bowl(c: Ctx, food: string, rim: string) {
  for (let i = 0; i < 6; i++) blob(c, 20 + i * 5, 30 - (i % 2) * 4, 6, 5, shade(food, 0.9 + (i % 3) * 0.1));
  poly(c, [10, 32, 54, 32, 46, 50, 18, 50], rim);
  c.fillStyle = 'rgba(255,255,255,0.2)';
  c.fillRect(14, 34, 34, 3);
}

export function drawIcon(c: Ctx, icon: DrawIcon): void {
  const [a, b] = icon.colors;
  c.clearRect(0, 0, 64, 64);
  switch (icon.shape) {
    case 'meat':
      blob(c, 31, 33, 22, 15, a, -0.55);
      blob(c, 30, 32, 14, 8, b, -0.55);
      blob(c, 30, 32, 9, 5, a, -0.55);
      break;
    case 'bone':
      stick(c, 18, 47, 47, 18, 8, a);
      for (const [x, y] of [[14, 44], [21, 50], [44, 14], [50, 21]]) blob(c, x, y, 6, 6, a);
      break;
    case 'stick':
      stick(c, 16, 50, 48, 14, 6, a);
      stick(c, 34, 30, 42, 36, 3, b);
      break;
    case 'fiber':
      for (let i = 0; i < 5; i++) {
        c.strokeStyle = i % 2 ? b : a;
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(18 + i * 6, 52);
        c.quadraticCurveTo(22 + i * 4, 30, 14 + i * 9, 12);
        c.stroke();
      }
      break;
    case 'rope':
      c.lineWidth = 7;
      c.strokeStyle = OUT;
      c.beginPath();
      c.ellipse(32, 34, 17, 13, 0, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 5;
      c.strokeStyle = a;
      c.stroke();
      c.setLineDash([3, 3]);
      c.strokeStyle = b;
      c.lineWidth = 2;
      c.stroke();
      c.setLineDash([]);
      stick(c, 46, 42, 52, 54, 4, a);
      break;
    case 'flint':
      poly(c, [18, 44, 26, 16, 44, 14, 50, 36, 36, 52], a);
      poly(c, [26, 18, 42, 16, 36, 30], b);
      break;
    case 'clay':
      blob(c, 32, 36, 18, 14, a);
      blob(c, 26, 32, 7, 5, b);
      break;
    case 'nugget':
      poly(c, [14, 40, 20, 22, 36, 16, 50, 26, 48, 44, 30, 50], a);
      blob(c, 26, 30, 5, 4, b);
      blob(c, 40, 38, 4, 3, b);
      shine(c, 24, 24, 3);
      break;
    case 'ingot':
      poly(c, [10, 40, 20, 26, 54, 26, 46, 40], a);
      poly(c, [10, 40, 46, 40, 46, 48, 10, 48], b);
      poly(c, [46, 40, 54, 26, 54, 34, 46, 48], shade(b, 0.8));
      shine(c, 28, 31, 5);
      break;
    case 'gem':
      poly(c, [32, 8, 48, 26, 32, 56, 16, 26], a);
      poly(c, [32, 8, 40, 26, 32, 56, 24, 26], b);
      shine(c, 27, 20, 3);
      break;
    case 'fleece':
      for (let i = 0; i < 7; i++) blob(c, 18 + (i % 4) * 9, 26 + Math.floor(i / 4) * 12, 9, 8, i % 2 ? a : b);
      break;
    case 'feather':
      c.save();
      c.translate(32, 32);
      c.rotate(-0.7);
      blob(c, 0, 0, 8, 22, a);
      for (let i = -3; i <= 3; i++) {
        c.strokeStyle = b;
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(-7, i * 5);
        c.lineTo(7, i * 5 - 3);
        c.stroke();
      }
      stick(c, 0, 18, 0, 28, 2, b);
      c.restore();
      break;
    case 'thorn':
      poly(c, [14, 50, 36, 30, 50, 10, 42, 36], a);
      poly(c, [24, 44, 36, 30, 40, 38], b);
      break;
    case 'wisp':
      for (let i = 0; i < 4; i++) blob(c, 24 + i * 6, 44 - i * 8, 10 - i * 2, 7 - i, i % 2 ? b : a);
      blob(c, 34, 24, 3, 3, '#ffffff');
      break;
    case 'plate':
      poly(c, [12, 30, 32, 14, 52, 30, 44, 50, 20, 50], a);
      poly(c, [20, 32, 32, 22, 44, 32, 38, 42, 26, 42], b);
      break;
    case 'shell':
      blob(c, 32, 34, 18, 14, a);
      for (let i = 0; i < 3; i++) {
        c.strokeStyle = b;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(32, 34, 5 + i * 5, Math.PI, Math.PI * 2);
        c.stroke();
      }
      break;
    case 'seed':
      for (let i = 0; i < 5; i++) blob(c, 20 + (i % 3) * 11, 26 + Math.floor(i / 3) * 12 + (i % 2) * 3, 5, 7, i % 2 ? b : a, 0.4 * (i - 2));
      break;
    case 'berry':
      for (const [x, y] of [[24, 36], [38, 34], [31, 24], [30, 44]]) {
        blob(c, x, y, 8, 8, a);
        blob(c, x - 2, y - 2, 3, 3, b);
      }
      stick(c, 31, 16, 36, 8, 2, '#4f7a38');
      break;
    case 'apple':
      blob(c, 32, 36, 17, 16, a);
      c.fillStyle = b;
      c.beginPath();
      c.ellipse(38, 40, 9, 9, 0, 0, Math.PI * 2);
      c.globalAlpha = 0.5;
      c.fill();
      c.globalAlpha = 1;
      stick(c, 32, 21, 34, 12, 3, '#6b4424');
      blob(c, 40, 15, 7, 3.5, '#5f9a3a', -0.4);
      shine(c, 25, 30, 4);
      break;
    case 'coconut':
      blob(c, 32, 34, 18, 17, a);
      blob(c, 26, 30, 7, 6, b);
      for (const [x, y] of [[36, 26], [40, 32], [34, 32]]) blob(c, x, y, 2, 2, '#3a2a1a');
      break;
    case 'root':
      poly(c, [20, 22, 44, 22, 36, 54, 30, 58], a);
      for (let i = 0; i < 3; i++) stick(c, 32, 22, 22 + i * 10, 6, 3, b);
      break;
    case 'herb':
      stick(c, 32, 56, 32, 20, 3, b);
      for (let i = 0; i < 3; i++) {
        blob(c, 24, 44 - i * 10, 8, 4.5, a, 0.5);
        blob(c, 40, 40 - i * 10, 8, 4.5, a, -0.5);
      }
      break;
    case 'gourd':
      blob(c, 32, 38, 20, 16, a);
      c.strokeStyle = shade(a, 0.75);
      c.lineWidth = 2;
      for (const x of [24, 32, 40]) {
        c.beginPath();
        c.moveTo(x, 24);
        c.quadraticCurveTo(x + (x - 32) * 0.4, 38, x, 52);
        c.stroke();
      }
      stick(c, 32, 22, 36, 12, 4, b);
      break;
    case 'grain':
      stick(c, 22, 56, 38, 12, 2, b);
      stick(c, 30, 56, 44, 14, 2, b);
      for (let i = 0; i < 5; i++) {
        blob(c, 36 - i * 2, 16 + i * 5, 3, 5, a, 0.4);
        blob(c, 42 - i * 2, 18 + i * 5, 3, 5, a, 0.4);
      }
      break;
    case 'flour':
      poly(c, [16, 54, 18, 24, 26, 16, 38, 16, 46, 24, 48, 54], a);
      stick(c, 22, 20, 42, 20, 3, b);
      c.fillStyle = b;
      c.font = 'bold 14px sans-serif';
      c.fillText('✿', 26, 44);
      break;
    case 'mushroom':
      poly(c, [26, 36, 38, 36, 36, 54, 28, 54], b);
      c.beginPath();
      c.ellipse(32, 34, 20, 14, 0, Math.PI, Math.PI * 2);
      c.closePath();
      c.fillStyle = a;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = OUT;
      c.stroke();
      for (const [x, y] of [[24, 28], [36, 24], [42, 30]]) blob(c, x, y, 3, 2.5, '#fff6e6');
      break;
    case 'bowl':
      bowl(c, a, b);
      break;
    case 'pie':
      poly(c, [8, 36, 56, 36, 50, 50, 14, 50], b);
      c.beginPath();
      c.ellipse(32, 34, 24, 10, 0, 0, Math.PI * 2);
      c.fillStyle = shade(b, 1.1);
      c.fill();
      c.strokeStyle = OUT;
      c.lineWidth = 2.5;
      c.stroke();
      for (let i = 0; i < 4; i++) stick(c, 16 + i * 10, 30, 22 + i * 10, 38, 2, a);
      break;
    case 'bread':
      blob(c, 32, 36, 22, 13, a);
      for (let i = 0; i < 3; i++) stick(c, 22 + i * 9, 30, 26 + i * 9, 40, 2, b);
      shine(c, 24, 30, 4);
      break;
    case 'mug':
      poly(c, [16, 22, 42, 22, 40, 52, 18, 52], b);
      c.beginPath();
      c.arc(44, 36, 8, -Math.PI / 2, Math.PI / 2);
      c.lineWidth = 4;
      c.strokeStyle = OUT;
      c.stroke();
      c.fillStyle = a;
      c.fillRect(18, 24, 22, 6);
      for (let i = 0; i < 2; i++) {
        c.strokeStyle = 'rgba(255,255,255,0.7)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(24 + i * 8, 18);
        c.quadraticCurveTo(28 + i * 8, 12, 24 + i * 8, 6);
        c.stroke();
      }
      break;
    case 'mix':
      poly(c, [14, 26, 50, 26, 46, 54, 18, 54], '#c9a66b');
      for (let i = 0; i < 8; i++) blob(c, 20 + (i % 4) * 8, 22 + Math.floor(i / 4) * 5, 4, 3.5, i % 2 ? a : b);
      break;
    case 'axe':
      stick(c, 18, 54, 44, 14, 5, b);
      poly(c, [36, 10, 52, 14, 54, 30, 44, 26, 38, 22], a);
      shine(c, 46, 18, 3);
      break;
    case 'pick':
      stick(c, 18, 54, 40, 18, 5, b);
      poly(c, [14, 18, 30, 8, 50, 12, 58, 26, 46, 20, 30, 16], a);
      shine(c, 34, 12, 3);
      break;
    case 'shovel':
      stick(c, 20, 54, 38, 22, 5, b);
      poly(c, [34, 20, 44, 8, 56, 14, 50, 28, 40, 28], a);
      break;
    case 'hoe':
      stick(c, 18, 54, 42, 14, 5, b);
      poly(c, [40, 10, 54, 12, 54, 24, 46, 20, 40, 18], a);
      break;
    case 'club':
      stick(c, 16, 54, 36, 26, 6, shade(a, 0.85));
      blob(c, 40, 20, 11, 9, a, -0.8);
      for (const [x, y] of [[36, 16], [44, 22]]) blob(c, x, y, 2, 2, b);
      break;
    case 'hammer':
      stick(c, 18, 54, 38, 22, 5, b);
      poly(c, [26, 14, 44, 6, 54, 20, 36, 28], a);
      break;
    case 'spear':
      stick(c, 12, 56, 44, 18, 4, b);
      poly(c, [42, 20, 52, 6, 50, 22], a);
      stick(c, 38, 24, 42, 20, 5, '#c9a66b');
      break;
    case 'blade':
      poly(c, [22, 42, 48, 10, 54, 10, 54, 16, 28, 48], a);
      stick(c, 18, 38, 30, 50, 4, shade(b, 1.2));
      stick(c, 12, 56, 24, 44, 5, b);
      shine(c, 44, 18, 3);
      break;
    case 'sword':
      // long straight blade with fuller, crossguard and round pommel
      poly(c, [24, 44, 50, 10, 56, 8, 54, 14, 28, 48], a);
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(28, 42);
      c.lineTo(50, 14);
      c.stroke();
      stick(c, 16, 36, 34, 52, 5, shade(b, 1.35));
      stick(c, 13, 55, 25, 44, 5, b);
      blob(c, 11, 57, 3.5, 3.5, shade(b, 1.35));
      shine(c, 46, 18, 2.5);
      break;
    case 'helmet':
      c.beginPath();
      c.moveTo(12, 44);
      c.quadraticCurveTo(10, 10, 32, 10);
      c.quadraticCurveTo(54, 10, 52, 44);
      c.closePath();
      c.fillStyle = a;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = OUT;
      c.stroke();
      poly(c, [10, 42, 54, 42, 54, 50, 10, 50], shade(a, 0.8));
      poly(c, [29, 14, 35, 14, 35, 44, 29, 44], b);
      shine(c, 22, 20, 3);
      break;
    case 'chest':
      poly(c, [14, 12, 24, 10, 32, 16, 40, 10, 50, 12, 56, 26, 48, 28, 48, 56, 16, 56, 16, 28, 8, 26], a);
      poly(c, [22, 24, 42, 24, 40, 40, 24, 40], shade(a, 1.15));
      stick(c, 18, 46, 46, 46, 3, b);
      shine(c, 26, 28, 2.5);
      break;
    case 'leggings':
      poly(c, [14, 10, 50, 10, 52, 56, 38, 56, 32, 26, 26, 56, 12, 56], a);
      stick(c, 14, 14, 50, 14, 4, b);
      poly(c, [14, 44, 26, 44, 26, 50, 13, 50], shade(a, 0.8));
      poly(c, [38, 44, 50, 44, 51, 50, 38, 50], shade(a, 0.8));
      break;
    case 'shield':
      c.beginPath();
      c.moveTo(32, 6);
      c.lineTo(54, 14);
      c.quadraticCurveTo(54, 44, 32, 58);
      c.quadraticCurveTo(10, 44, 10, 14);
      c.closePath();
      c.fillStyle = a;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = OUT;
      c.stroke();
      poly(c, [29, 10, 35, 10, 35, 52, 29, 52], b);
      poly(c, [14, 24, 50, 24, 49, 30, 15, 30], b);
      blob(c, 32, 27, 5, 5, shade(b, 1.3));
      break;
    case 'bow':
      c.beginPath();
      c.moveTo(16, 8);
      c.quadraticCurveTo(58, 32, 16, 56);
      c.lineWidth = 7.5;
      c.strokeStyle = OUT;
      c.stroke();
      c.lineWidth = 4.5;
      c.strokeStyle = a;
      c.stroke();
      c.lineWidth = 1.4;
      c.strokeStyle = '#f2ead8';
      c.beginPath();
      c.moveTo(16, 8);
      c.lineTo(16, 56);
      c.stroke();
      stick(c, 30, 26, 30, 38, 4, b);
      break;
    case 'arrow':
      stick(c, 12, 52, 48, 16, 3, a);
      poly(c, [44, 12, 56, 8, 52, 20], b);
      poly(c, [10, 46, 16, 48, 18, 56, 12, 58, 8, 50], '#e8e2d2');
      break;
    case 'hide':
      poly(c, [14, 14, 24, 18, 32, 10, 40, 18, 52, 14, 50, 30, 56, 40, 44, 50, 32, 46, 20, 52, 8, 40, 14, 30], a);
      for (const [x, y] of [[24, 28], [38, 32], [30, 38]]) blob(c, x, y, 3, 2, shade(a, 0.75));
      break;
    case 'fang':
      c.beginPath();
      c.moveTo(18, 12);
      c.quadraticCurveTo(48, 14, 46, 56);
      c.quadraticCurveTo(34, 30, 18, 24);
      c.closePath();
      c.fillStyle = a;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = OUT;
      c.stroke();
      poly(c, [14, 10, 22, 10, 22, 26, 14, 26], b);
      break;
    case 'boat':
      poly(c, [6, 30, 58, 30, 50, 46, 14, 46], a);
      poly(c, [10, 30, 54, 30, 52, 34, 12, 34], shade(a, 0.75));
      for (const x of [22, 32, 42]) {
        c.fillStyle = shade(b, 1.1);
        c.fillRect(x - 1, 34, 2, 11);
      }
      stick(c, 18, 14, 40, 44, 3, b);
      blob(c, 41, 45, 4, 2.5, b, 0.9);
      c.fillStyle = 'rgba(80,150,210,0.75)';
      c.fillRect(4, 48, 56, 4);
      break;
    case 'corn':
      blob(c, 32, 30, 9, 18, a, 0.35);
      for (let i = 0; i < 5; i++) for (let k = 0; k < 2; k++) blob(c, 28 + k * 7 + i * 1.2, 18 + i * 6, 2.4, 2.2, shade(a, 1.12));
      poly(c, [16, 54, 26, 26, 32, 50], b);
      poly(c, [46, 52, 40, 26, 34, 50], shade(b, 0.85));
      break;
    case 'tomato':
      blob(c, 32, 36, 17, 15, a);
      blob(c, 26, 30, 4, 3, 'rgba(255,255,255,0.45)');
      poly(c, [24, 22, 32, 26, 40, 22, 36, 28, 32, 30, 28, 28], b);
      stick(c, 32, 22, 33, 14, 3, b);
      break;
    case 'hay':
      poly(c, [10, 20, 54, 20, 54, 50, 10, 50], a);
      for (let y = 24; y < 48; y += 5) {
        c.strokeStyle = shade(a, 0.8);
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(12, y);
        c.lineTo(52, y + 2);
        c.stroke();
      }
      c.fillStyle = b;
      c.fillRect(20, 19, 4, 32);
      c.fillRect(40, 19, 4, 32);
      break;
    case 'can':
      poly(c, [14, 28, 40, 28, 40, 52, 14, 52], a);
      stick(c, 40, 34, 54, 22, 4, a);
      c.beginPath();
      c.arc(27, 26, 10, Math.PI, 0);
      c.lineWidth = 4;
      c.strokeStyle = OUT;
      c.stroke();
      for (let i = 0; i < 3; i++) blob(c, 56 + i, 28 + i * 7, 1.6, 2.4, b);
      break;
    case 'pack':
      poly(c, [14, 20, 50, 20, 52, 56, 12, 56], a);
      poly(c, [18, 34, 46, 34, 44, 50, 20, 50], shade(a, 0.85));
      blob(c, 32, 16, 18, 6, b);
      stick(c, 22, 20, 22, 12, 3, '#6b4424');
      stick(c, 42, 20, 42, 12, 3, '#6b4424');
      break;
    case 'boots':
      poly(c, [10, 22, 24, 22, 26, 44, 34, 48, 34, 56, 10, 56], a);
      poly(c, [32, 18, 46, 18, 48, 40, 56, 44, 56, 54, 32, 54], shade(a, 1.1));
      stick(c, 10, 26, 24, 26, 3, b);
      stick(c, 32, 22, 46, 22, 3, b);
      break;
    case 'vest':
      poly(c, [18, 12, 28, 18, 36, 18, 46, 12, 54, 24, 48, 54, 16, 54, 10, 24], a);
      poly(c, [28, 18, 36, 18, 34, 54, 30, 54], b);
      break;
    case 'hood':
      c.beginPath();
      c.moveTo(12, 52);
      c.quadraticCurveTo(10, 10, 32, 8);
      c.quadraticCurveTo(54, 10, 52, 52);
      c.closePath();
      c.fillStyle = a;
      c.fill();
      c.lineWidth = 2.5;
      c.strokeStyle = OUT;
      c.stroke();
      blob(c, 32, 36, 12, 13, b);
      break;
  }
}
