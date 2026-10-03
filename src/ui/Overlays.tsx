import { useGameStore } from '../stores/gameStore';
import { InventoryScreen } from './Inventory/InventoryScreen';
import { ContainerScreen } from './Inventory/ContainerScreen';
import { JournalScreen } from './Journal/JournalScreen';
import { MapScreen } from './Map/MapScreen';
import { PauseMenu } from './PauseMenu/PauseMenu';
import { DeathScreen, LoreDialog, SleepDialog } from './PauseMenu/Dialogs';
import { SettingsScreen } from './Settings/SettingsScreen';
import { CursorStack } from './Inventory/CursorStack';
import { BuildCatalog } from './Build/BuildCatalog';
import { BuildDialogs } from './Build/BuildDialogs';

/** In-game modal layer. Opening any of these pauses the simulation. */
export function Overlays() {
  const overlay = useGameStore((s) => s.overlay);
  if (!overlay) return null;
  return (
    <>
      {overlay === 'inventory' && <InventoryScreen />}
      {overlay === 'container' && <ContainerScreen />}
      {overlay === 'journal' && <JournalScreen />}
      {overlay === 'map' && <MapScreen />}
      {overlay === 'pause' && <PauseMenu />}
      {overlay === 'settings' && <SettingsScreen inGame />}
      {overlay === 'death' && <DeathScreen />}
      {overlay === 'sleep' && <SleepDialog />}
      {overlay === 'lore' && <LoreDialog />}
      {overlay === 'catalog' && <BuildCatalog />}
      {overlay === 'buildDialog' && <BuildDialogs />}
      <CursorStack />
    </>
  );
}
