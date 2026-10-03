import { useGameStore } from '../../stores/gameStore';

export function Toasts() {
  const toasts = useGameStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onPointerDown={() => useGameStore.getState().dismissToast(t.id)}>
          {t.icon && <span className="toast-icon">{t.icon}</span>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
