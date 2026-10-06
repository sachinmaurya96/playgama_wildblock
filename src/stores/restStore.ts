import { create } from 'zustand';

/** Only publish when nearby furniture changes, rather than on every frame. */
export const useRestStore = create<{ bed: string | null; chair: string | null; seated: boolean }>(() => ({
  bed: null, chair: null, seated: false,
}));
