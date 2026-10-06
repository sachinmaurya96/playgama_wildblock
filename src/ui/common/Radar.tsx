import { useEffect, useRef, useState } from 'react';
import { gameRegistry } from '../../game/registry';

/** One player on the radar (world position). */
export interface RadarBlip {
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
}

export const RADAR_RANGE = 60; // blocks from the centre to the rim

/**
 * Player radar (top-left): you in the middle, facing up. Other players are
 * coloured dots; players further away sit on the rim as arrows with their
 * distance. ▲ / ▼ = well above / below you (on a cliff, down in a cave).
 */
export function PlayerRadar({ blips, range = RADAR_RANGE, title = 'Player radar — you are the white arrow, facing up', empty = 'No one nearby yet' }: { blips: () => RadarBlip[] | null; range?: number; title?: string; empty?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [nearest, setNearest] = useState<string>('');
  useEffect(() => {
    let raf = 0;
    let textTimer = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const c = ref.current;
      const g = gameRegistry.current;
      const list = g ? blips() : null;
      if (!c || !g || !list) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = c.clientWidth;
      if (c.width !== Math.round(size * dpr)) {
        c.width = Math.round(size * dpr);
        c.height = Math.round(size * dpr);
      }
      const x = c.getContext('2d')!;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const R = size / 2;
      x.clearRect(0, 0, size, size);
      // disc
      x.fillStyle = 'rgba(30, 24, 16, 0.55)';
      x.beginPath();
      x.arc(R, R, R - 1, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = 'rgba(255, 246, 224, 0.55)';
      x.lineWidth = 2;
      x.stroke();
      x.strokeStyle = 'rgba(255, 246, 224, 0.18)';
      x.lineWidth = 1;
      for (const f of [1 / 3, 2 / 3]) {
        x.beginPath();
        x.arc(R, R, (R - 6) * f, 0, Math.PI * 2);
        x.stroke();
      }
      x.beginPath();
      x.moveTo(R, 6);
      x.lineTo(R, size - 6);
      x.moveTo(6, R);
      x.lineTo(size - 6, R);
      x.stroke();
      const p = g.player.position;
      const yaw = g.player.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      // north marker on the rim
      {
        const sx = 0 * rx + -1 * rz, sy = -(0 * fx + -1 * fz);
        const l = Math.hypot(sx, sy) || 1;
        x.fillStyle = '#ffe08a';
        x.font = `900 ${Math.max(9, size * 0.09)}px Nunito, sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText('N', R + (sx / l) * (R - 9), R + (sy / l) * (R - 9));
      }
      const scale = (R - 10) / range;
      let best: { name: string; d: number } | null = null;
      for (const r of list) {
        const dx = r.x - p.x, dz = r.z - p.z, dy = r.y - p.y;
        const d = Math.hypot(dx, dz);
        if (!best || d < best.d) best = { name: r.name, d };
        let sx = (dx * rx + dz * rz) * scale, sy = -(dx * fx + dz * fz) * scale;
        const far = d > range;
        if (far) {
          const l = Math.hypot(sx, sy) || 1;
          sx = (sx / l) * (R - 10);
          sy = (sy / l) * (R - 10);
        }
        const px = R + sx, py = R + sy;
        x.fillStyle = r.color;
        x.strokeStyle = 'rgba(20, 12, 6, 0.9)';
        x.lineWidth = 2;
        if (far) {
          // arrow pointing outwards
          const a = Math.atan2(sy, sx);
          x.save();
          x.translate(px, py);
          x.rotate(a);
          x.beginPath();
          x.moveTo(7, 0);
          x.lineTo(-5, -5.5);
          x.lineTo(-5, 5.5);
          x.closePath();
          x.fill();
          x.stroke();
          x.restore();
          x.fillStyle = '#fff6e0';
          x.font = `800 ${Math.max(8, size * 0.075)}px Nunito, sans-serif`;
          const tx = R + sx * 0.72, ty = R + sy * 0.72;
          x.fillText(`${Math.round(d)}m`, tx, ty);
        } else {
          x.beginPath();
          x.arc(px, py, 5, 0, Math.PI * 2);
          x.fill();
          x.stroke();
          if (Math.abs(dy) > 4) {
            x.fillStyle = '#fff6e0';
            x.font = `900 ${Math.max(8, size * 0.08)}px Nunito, sans-serif`;
            x.fillText(dy > 0 ? '▲' : '▼', px, py - 10);
          }
        }
      }
      // you
      x.fillStyle = '#ffffff';
      x.strokeStyle = 'rgba(20, 12, 6, 0.9)';
      x.lineWidth = 2;
      x.beginPath();
      x.moveTo(R, R - 8);
      x.lineTo(R - 6, R + 6);
      x.lineTo(R, R + 3);
      x.lineTo(R + 6, R + 6);
      x.closePath();
      x.fill();
      x.stroke();
      textTimer -= 1;
      if (textTimer <= 0) {
        textTimer = 15;
        setNearest(best ? `${best.name} · ${Math.round(best.d)}m` : '');
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="pvp-radar" title={title}>
      <canvas ref={ref} />
      <small>{nearest ? `Nearest: ${nearest}` : empty}</small>
    </div>
  );
}
