import { useGameStore } from '../../stores/gameStore';

/** F3 debug overlay (always available in dev; togglable in production from Settings). */
export function DebugPanel() {
  const d = useGameStore((s) => s.debug);
  if (!d) return null;
  const rows: [string, string | number][] = [
    ['FPS', d.fps], ['Position', d.pos], ['Chunk', d.chunk], ['Biome', d.biome], ['Loaded chunks', d.chunks], ['Meshed chunks', d.meshed],
    ['Worker queue', d.queue], ['Triangles', d.triangles.toLocaleString()], ['Draw calls', d.calls], ['Entities', d.entities], ['Light', d.light],
    ['Seed', d.seed], ['Time', d.time], ['Memory', d.memory],
  ];
  return (
    <div className="debug-panel">
      <b>WildBlocks debug (F3)</b>
      {rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
