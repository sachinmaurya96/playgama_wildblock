import { useEffect, useRef, useState } from 'react';
import { gameRegistry } from '../../game/registry';
import { useWorldStore } from '../../stores/worldStore';
import type { MapTileRecord } from '../../persistence/types';

/** World map of explored chunks (top-down colours captured as chunks generate). */
export function MapScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState<MapTileRecord[] | null>(null);
  const [zoom, setZoom] = useState(2);
  const [offset, setOffset] = useState({ x: 0, z: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oz: number } | null>(null);
  const ws = useWorldStore();
  const close = () => gameRegistry.current?.closeOverlay();

  useEffect(() => {
    void gameRegistry.current?.mapTiles().then(setTiles);
  }, []);

  useEffect(() => {
    const g = gameRegistry.current;
    const cv = canvasRef.current;
    if (!g || !cv || !tiles) return;
    const W = cv.width, H = cv.height;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(0, 0, W, H);
    // paper texture dots
    ctx.fillStyle = 'rgba(120,90,50,0.06)';
    for (let i = 0; i < 400; i++) ctx.fillRect((i * 97) % W, (i * 57) % H, 2, 2);
    const p = g.player.position;
    const cx = p.x + offset.x, cz = p.z + offset.z;
    const img = ctx.createImageData(16, 16);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 16;
    const tctx = tmp.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    for (const t of tiles) {
      const sx = (t.cx * 16 - cx) * zoom + W / 2, sy = (t.cz * 16 - cz) * zoom + H / 2;
      if (sx < -16 * zoom || sy < -16 * zoom || sx > W || sy > H) continue;
      for (let i = 0; i < 256; i++) {
        img.data[i * 4] = t.colors[i * 3];
        img.data[i * 4 + 1] = t.colors[i * 3 + 1];
        img.data[i * 4 + 2] = t.colors[i * 3 + 2];
        img.data[i * 4 + 3] = 255;
      }
      tctx.putImageData(img, 0, 0);
      ctx.drawImage(tmp, sx, sy, 16 * zoom, 16 * zoom);
    }
    const toScreen = (x: number, z: number) => [(x - cx) * zoom + W / 2, (z - cz) * zoom + H / 2];
    const pin = (x: number, z: number, emoji: string, label: string) => {
      const [sx, sy] = toScreen(x, z);
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(emoji, sx, sy + 6);
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#3a2c1e';
      ctx.strokeStyle = 'rgba(255,250,235,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, sx, sy + 22);
      ctx.fillText(label, sx, sy + 22);
    };
    pin(ws.camp.x, ws.camp.z, '⛺', 'Camp');
    if (ws.home) pin(ws.home.x, ws.home.z, '🏡', 'Home');
    if (ws.deathMarker) pin(ws.deathMarker.x, ws.deathMarker.z, '🍂', 'Lost satchel');
    if (ws.waypoint) pin(ws.waypoint.x, ws.waypoint.z, '📍', ws.waypoint.label);
    for (const l of ws.journal.landmarks) {
      const [, pos] = l.split('@');
      const [x, z] = pos.split(',').map(Number);
      pin(x, z, '✨', '');
    }
    // player arrow
    const [px, py] = toScreen(p.x, p.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-g.player.yaw);
    ctx.fillStyle = '#d9573f';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 9);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [tiles, zoom, offset, ws]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="panel map-panel">
        <button className="close-x" onClick={close} aria-label="Close">✕</button>
        <h2 className="panel-title">🗺️ Explorer’s Map</h2>
        <canvas
          ref={canvasRef}
          width={760}
          height={480}
          className="map-canvas"
          onWheel={(e) => setZoom((z) => Math.max(0.5, Math.min(6, z * (e.deltaY > 0 ? 0.85 : 1.18))))}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oz: offset.z };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setOffset({ x: d.ox - (e.clientX - d.x) / zoom, z: d.oz - (e.clientY - d.y) / zoom });
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={(e) => {
            const g = gameRegistry.current;
            if (!g) return;
            const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
            const sx = ((e.clientX - r.left) / r.width) * 760, sy = ((e.clientY - r.top) / r.height) * 480;
            const x = Math.round((sx - 380) / zoom + g.player.position.x + offset.x);
            const z = Math.round((sy - 240) / zoom + g.player.position.z + offset.z);
            useWorldStore.getState().setWaypoint({ x, z, label: 'Waypoint' });
          }}
        />
        <div className="map-actions">
          <button className="btn small" onClick={() => setZoom((z) => Math.min(6, z * 1.3))}>＋</button>
          <button className="btn small" onClick={() => setZoom((z) => Math.max(0.5, z / 1.3))}>－</button>
          <button className="btn small" onClick={() => setOffset({ x: 0, z: 0 })}>Center</button>
          {ws.waypoint && <button className="btn small" onClick={() => useWorldStore.getState().setWaypoint(null)}>Clear waypoint</button>}
          <span className="muted">Drag to pan · scroll to zoom · double-click to set a compass waypoint</span>
        </div>
      </div>
    </div>
  );
}
