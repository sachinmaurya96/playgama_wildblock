import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRecovery } from './AudioRecovery';
import { AudioManager } from './AudioManager';
import { FakeAudioContext } from '../../test/audioMocks';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('game audio interruption recovery', () => {
  it('recovers an interrupted context and resumes gun / effect playback', async () => {
    const am = new AudioManager();
    am.init();
    const ctx = FakeAudioContext.instances.at(-1)!;
    ctx.setState('interrupted');
    await Promise.resolve();
    expect(ctx.resume).toHaveBeenCalled();
    expect(am.ready).toBe(true);
    const sound = vi.fn();
    am.custom(sound);
    expect(sound).toHaveBeenCalledOnce();
    am.dispose();
  });

  it('keeps platform pause silent through gestures and state changes until resumed', async () => {
    const am = new AudioManager();
    am.init();
    const ctx = FakeAudioContext.instances.at(-1)!;
    am.suspend();
    am.init();
    expect(ctx.resume).not.toHaveBeenCalled();
    ctx.setState('running'); // a previously requested resume resolves late
    expect(ctx.state).toBe('suspended');
    am.resume();
    await Promise.resolve();
    expect(am.ready).toBe(true);
    am.dispose();
  });

  it('retries on a real gesture even when an autoplay resume promise is still waiting', () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume.mockImplementation(() => new Promise<void>(() => {}));
    const recovery = new AudioRecovery(ctx as unknown as AudioContext);
    recovery.wake(); // room auto-start, outside a gesture
    recovery.wake(); // first real tap
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it('handles resume rejection and retries on the next tap', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'interrupted';
    ctx.resume.mockRejectedValueOnce(new Error('Audio device busy'));
    const recovery = new AudioRecovery(ctx as unknown as AudioContext);
    recovery.wake();
    await Promise.resolve();
    recovery.wake();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(ctx.state).toBe('running');
    recovery.dispose();
  });

  it('does not resume a closed context', () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'closed';
    const recovery = new AudioRecovery(ctx as unknown as AudioContext);
    recovery.wake();
    recovery.resume();
    expect(ctx.resume).not.toHaveBeenCalled();
    recovery.dispose();
  });

  it('skips expired music notes after background timer throttling', () => {
    const am = new AudioManager();
    am.init();
    const ctx = FakeAudioContext.instances.at(-1)!;
    am.setMood('combat');
    ctx.currentTime = 3600;
    vi.advanceTimersByTime(120);
    // At most the current scheduling window, rather than one hour of notes.
    expect(ctx.createOscillator.mock.calls.length).toBeLessThan(30);
    am.dispose();
  });
});
