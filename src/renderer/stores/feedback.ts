/**
 * Feedback Overlay Store
 *
 * Manages temporary visual feedback overlays on buttons.
 * Plugins can trigger 'ok' (green checkmark) or 'alert' (yellow warning)
 * overlays via the showFeedback() host API method.
 */

import { writable } from 'svelte/store';
import type { FeedbackType, PluginFeedbackEvent } from '../../shared/types';

/** Active feedback state for a specific button */
export interface ActiveFeedback {
  type: FeedbackType;
  /** Timer ID for auto-clearing */
  timerId: ReturnType<typeof setTimeout>;
}

/** Map of keyIndex → active feedback overlay */
const feedbackMap = new Map<number, ActiveFeedback>();

/** Reactive store exposing the current set of active feedback overlays */
export const activeFeedbacks = writable<Map<number, FeedbackType>>(new Map());

/** Sync the internal map to the reactive store */
function sync(): void {
  const snapshot = new Map<number, FeedbackType>();
  for (const [key, value] of feedbackMap) {
    snapshot.set(key, value.type);
  }
  activeFeedbacks.set(snapshot);
}

/** Show a feedback overlay on a button, auto-clearing after durationMs */
export function showFeedback(event: PluginFeedbackEvent): void {
  const { keyIndex, feedbackType, durationMs } = event;

  // Clear any existing feedback on this key
  const existing = feedbackMap.get(keyIndex);
  if (existing) {
    clearTimeout(existing.timerId);
  }

  // Set up auto-clear timer
  const timerId = setTimeout(() => {
    feedbackMap.delete(keyIndex);
    sync();
  }, durationMs);

  feedbackMap.set(keyIndex, { type: feedbackType, timerId });
  sync();
}

/** Initialize the IPC listener for feedback events */
export function initFeedbackListener(): () => void {
  if (typeof window !== 'undefined' && window.osc?.onPluginShowFeedback) {
    return window.osc.onPluginShowFeedback(showFeedback);
  }
  return () => {};
}
