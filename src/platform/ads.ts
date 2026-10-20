import type bridge from '@playgama/bridge';
import { lifecycle, type Lifecycle } from './lifecycle';

export const INTERSTITIAL_PLACEMENT = 'return_to_menu';
export const REWARDED_PLACEMENT = 'starlight_scarf';
type AdApi = Pick<typeof bridge.advertisement, 'isInterstitialSupported' | 'isRewardedSupported' | 'rewardedPlacement' | 'showInterstitial' | 'showRewarded' | 'on' | 'off'>;
type Events = Pick<typeof bridge.EVENT_NAME, 'INTERSTITIAL_STATE_CHANGED' | 'REWARDED_STATE_CHANGED'>;
export interface RewardContext { readonly token: string; readonly placement: typeof REWARDED_PLACEMENT; readonly worldId: string; readonly reward: 'starlight'; }
interface Request {
  kind: 'interstitial' | 'rewarded'; context?: Readonly<RewardContext>;
  grant?: (context: Readonly<RewardContext>) => Promise<void>;
  granted: boolean; opened: boolean; fulfillment: Promise<void>;
  resolve: (earned: boolean) => void; timer?: ReturnType<typeof setTimeout>;
}

/** SDK show methods return void. Only events establish display and reward success. */
export class AdController {
  private request: Request | null = null;
  private quarantined = false;
  private lastInterstitial = Date.now();
  private unsub: (() => void) | null = null;
  constructor(private api: AdApi, private events: Events, private state: Lifecycle = lifecycle, private recoveryMs = 15000, private closeGraceMs = 2000) {}
  get busy() { return this.request !== null || this.state.has('ad') || this.quarantined; }
  get rewardedAvailable() { return this.api.isRewardedSupported && !this.busy; }
  install() {
    if (this.unsub) return;
    const interstitial = (v: string) => this.event('interstitial', v);
    const rewarded = (v: string) => this.event('rewarded', v);
    this.api.on(this.events.INTERSTITIAL_STATE_CHANGED, interstitial);
    this.api.on(this.events.REWARDED_STATE_CHANGED, rewarded);
    this.unsub = () => {
      this.api.off(this.events.INTERSTITIAL_STATE_CHANGED, interstitial);
      this.api.off(this.events.REWARDED_STATE_CHANGED, rewarded);
    };
  }
  interstitial(): Promise<boolean> {
    if (!this.api.isInterstitialSupported || this.busy || Date.now() - this.lastInterstitial < 90000) return Promise.resolve(false);
    this.lastInterstitial = Date.now();
    return this.start('interstitial');
  }
  rewarded(context: RewardContext, grant: (context: Readonly<RewardContext>) => Promise<void>): Promise<boolean> {
    if (!this.rewardedAvailable) return Promise.resolve(false);
    return this.start('rewarded', Object.freeze({ ...context }), grant);
  }
  private start(kind: Request['kind'], context?: Readonly<RewardContext>, grant?: Request['grant']): Promise<boolean> {
    this.install();
    return new Promise((resolve) => {
      const r: Request = { kind, context, grant, granted: false, opened: false, fulfillment: Promise.resolve(), resolve };
      this.request = r;
      r.timer = setTimeout(() => {
        if (this.request !== r || r.opened || this.state.has('ad')) return;
        // Never unpause a visible overlay. Ignore a late reward for this expired request.
        this.quarantined = true;
        this.finish(r);
      }, this.recoveryMs);
      try {
        if (kind === 'interstitial') this.api.showInterstitial(INTERSTITIAL_PLACEMENT);
        else this.api.showRewarded(context!.placement);
      } catch { if (!r.opened) this.finish(r); }
    });
  }
  private event(kind: Request['kind'], value: string) {
    // Even an unexpectedly late overlay must mute/pause the game.
    if (value === 'opened') this.state.set('ad', true);
    if (value === 'closed' || value === 'failed') { this.state.set('ad', false); this.quarantined = false; }
    const r = this.request;
    if (!r || r.kind !== kind) return;
    if (value === 'opened') { r.opened = true; if (r.timer) clearTimeout(r.timer); }
    if (value === 'rewarded' && r.context && !r.granted && this.api.rewardedPlacement === r.context.placement) {
      r.granted = true;
      r.fulfillment = Promise.resolve().then(() => r.grant!(r.context!)).catch((e) => console.error('[WildBlocks] earned reward save pending', e));
    }
    if (value === 'closed') {
      if (r.timer) clearTimeout(r.timer);
      // Keep context across adjacent reward/close events; block a new request.
      r.timer = setTimeout(() => this.finish(r), kind === 'rewarded' ? this.closeGraceMs : 0);
    } else if (value === 'failed') this.finish(r);
  }
  private finish(r: Request) {
    if (this.request !== r) return;
    if (r.timer) clearTimeout(r.timer);
    this.request = null;
    void r.fulfillment.then(() => r.resolve(r.granted));
  }
  dispose() { this.unsub?.(); this.unsub = null; if (this.request) this.finish(this.request); }
}
