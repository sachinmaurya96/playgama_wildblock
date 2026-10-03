import { AudioManager } from './AudioManager';

/** One audio engine for the whole app (menus + game) so the context is unlocked once. */
export const audio = new AudioManager();
