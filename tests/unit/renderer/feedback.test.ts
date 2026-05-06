import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { activeFeedbacks, showFeedback } from '../../../src/renderer/stores/feedback';

describe('feedback store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Clear any lingering feedback
    const current = get(activeFeedbacks);
    current.clear();
  });

  it('showFeedback sets an active feedback on a key', () => {
    showFeedback({ keyIndex: 3, feedbackType: 'ok', durationMs: 1000 });

    const state = get(activeFeedbacks);
    expect(state.get(3)).toBe('ok');
  });

  it('showFeedback auto-clears after durationMs', () => {
    showFeedback({ keyIndex: 5, feedbackType: 'alert', durationMs: 500 });

    expect(get(activeFeedbacks).get(5)).toBe('alert');

    vi.advanceTimersByTime(500);

    expect(get(activeFeedbacks).has(5)).toBe(false);
  });

  it('multiple keys can have feedback simultaneously', () => {
    showFeedback({ keyIndex: 0, feedbackType: 'ok', durationMs: 1000 });
    showFeedback({ keyIndex: 7, feedbackType: 'alert', durationMs: 2000 });

    const state = get(activeFeedbacks);
    expect(state.get(0)).toBe('ok');
    expect(state.get(7)).toBe('alert');
  });

  it('new feedback on same key replaces previous and resets timer', () => {
    showFeedback({ keyIndex: 2, feedbackType: 'ok', durationMs: 1000 });
    vi.advanceTimersByTime(800);

    // Replace with alert before ok expires
    showFeedback({ keyIndex: 2, feedbackType: 'alert', durationMs: 1000 });

    expect(get(activeFeedbacks).get(2)).toBe('alert');

    // Original timer would have expired at 200ms more, but the new one has 1000ms
    vi.advanceTimersByTime(200);
    expect(get(activeFeedbacks).has(2)).toBe(true); // Still active

    vi.advanceTimersByTime(800);
    expect(get(activeFeedbacks).has(2)).toBe(false); // Now cleared
  });

  it('each key clears independently', () => {
    showFeedback({ keyIndex: 1, feedbackType: 'ok', durationMs: 500 });
    showFeedback({ keyIndex: 4, feedbackType: 'alert', durationMs: 1000 });

    vi.advanceTimersByTime(500);

    expect(get(activeFeedbacks).has(1)).toBe(false);
    expect(get(activeFeedbacks).get(4)).toBe('alert');

    vi.advanceTimersByTime(500);
    expect(get(activeFeedbacks).has(4)).toBe(false);
  });
});
