/** English is the complete shipped translation; never advertise partial translations. */
export const SUPPORTED_LANGUAGES = [{ code: 'en', name: 'English' }] as const;
export function resolveLanguage(host: string, saved?: string | null): 'en' {
  const requested = (saved || host || 'en').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.find((l) => l.code === requested)?.code ?? 'en';
}
export const messages = {
  starting: 'Loading your saved worlds…',
  startupFailed: 'Your game could not load. Your existing saves have not been replaced.',
  retry: 'Retry loading',
  rewardOffer: 'Watch an ad to unlock the Starlight scarf',
  rewardPending: 'Waiting for the ad…',
  rewardFailed: 'No reward was earned. You can keep playing or try again.',
  rewardSaved: 'Starlight scarf unlocked!',
  saveFailed: 'Saving failed. Your changes are kept here; retry saving before leaving.',
} as const;
