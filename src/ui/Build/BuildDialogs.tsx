import { useState } from 'react';
import { gameRegistry } from '../../game/registry';
import { useBuildStore } from '../../stores/buildStore';

/** Small Build Home dialogs: room label text, blueprint name, "are you sure?" for big deletions. */
export function BuildDialogs() {
  const labelEdit = useBuildStore((s) => s.labelEdit);
  const naming = useBuildStore((s) => s.blueprintNaming);
  const confirm = useBuildStore((s) => s.confirm);
  const set = useBuildStore((s) => s.set);
  const close = () => {
    set({ labelEdit: null, blueprintNaming: false, confirm: null });
    gameRegistry.current?.closeOverlay();
  };
  if (labelEdit) return <LabelDialog id={labelEdit.id} initial={labelEdit.text} onDone={close} />;
  if (naming) return <BlueprintDialog onDone={close} />;
  if (confirm)
    return (
      <div className="modal-backdrop">
        <div className="panel confirm-panel">
          <button className="close-x" onClick={close} aria-label="Cancel">✕</button>
          <h2 className="panel-title">Are you sure?</h2>
          <p>{confirm.text}</p>
          <div className="menu-buttons row">
            <button className="btn" autoFocus onClick={close}>Cancel</button>
            <button className="btn danger" onClick={() => { const f = confirm.onYes; close(); f(); }}>Delete</button>
          </div>
        </div>
      </div>
    );
  return null;
}

const ROOMS = ['Living Room', 'Kitchen', 'Dining', 'Bedroom', 'Main Bedroom', 'Kids Room', 'Bathroom', 'Office', 'Hallway', 'Laundry', 'Garage', 'Patio'];

function LabelDialog({ id, initial, onDone }: { id: number; initial: string; onDone: () => void }) {
  const [text, setText] = useState(initial);
  const save = (t: string) => {
    gameRegistry.current?.build?.setLabelText(id, t);
    onDone();
  };
  return (
    <div className="modal-backdrop">
      <form className="panel confirm-panel" onSubmit={(e) => { e.preventDefault(); save(text); }}>
        <button type="button" className="close-x" onClick={onDone} aria-label="Cancel">✕</button>
        <h2 className="panel-title">🏷️ Room label</h2>
        <input className="search" autoFocus maxLength={18} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="label-chips">
          {ROOMS.map((r) => <button type="button" key={r} className="btn small" onClick={() => save(r)}>{r}</button>)}
        </div>
        <div className="menu-buttons row">
          <button type="button" className="btn" onClick={onDone}>Cancel</button>
          <button type="submit" className="btn build-home-btn">Save</button>
        </div>
      </form>
    </div>
  );
}

function BlueprintDialog({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('My Blueprint');
  return (
    <div className="modal-backdrop">
      <form className="panel confirm-panel" onSubmit={(e) => { e.preventDefault(); void gameRegistry.current?.build?.saveRegionAsBlueprint(name); onDone(); }}>
        <button type="button" className="close-x" onClick={onDone} aria-label="Cancel">✕</button>
        <h2 className="panel-title">📐 Save as blueprint</h2>
        <p className="muted">Blueprints are shared by all your Build Home projects (Catalog → Presets → My Blueprints).</p>
        <input className="search" autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="menu-buttons row">
          <button type="button" className="btn" onClick={onDone}>Cancel</button>
          <button type="submit" className="btn build-home-btn">Save blueprint</button>
        </div>
      </form>
    </div>
  );
}
