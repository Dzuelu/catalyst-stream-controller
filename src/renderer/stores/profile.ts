import { writable, derived } from 'svelte/store';
import type {
  Profile,
  Page,
  ActionConfig,
  ButtonAppearance,
  ProfileData,
  PageNavigationState,
  PageBreadcrumb,
  TriggerType,
  KnobTriggerType
} from '../../shared/types';

/** Live preview PNG data URI for the button currently being edited.
 *  When non-null, DeviceGrid overlays this rendered image on the matching ButtonCell. */
export const livePreview = writable<{ buttonIndex: number; dataUri: string } | null>(null);

/** Rendered preview images for all keys on the current page (committed state).
 *  Keyed by button index. Pushed by the main process after applyCurrentPageToDevice / reapplyKey. */
export const keyPreviews = writable<Map<number, string>>(new Map());

/** All available profiles */
export const profiles = writable<Profile[]>([]);

/** ID of the active profile for the currently selected device */
export const activeProfileId = writable<string>('');

/** The global default active profile ID from ProfileData (fallback) */
export const globalActiveProfileId = writable<string>('');

/** Per-device profile assignment map from ProfileData */
export const deviceProfileAssignment = writable<Record<string, string>>({});

/** The active profile, derived */
export const activeProfile = derived(
  [profiles, activeProfileId],
  ([$profiles, $activeId]) => $profiles.find((p) => p.id === $activeId) ?? null
);

/** Current page navigation state */
export const currentPageId = writable<string>('');
export const breadcrumbs = writable<PageBreadcrumb[]>([]);

/** The current page being displayed, derived from activeProfile + currentPageId */
export const currentPage = derived([activeProfile, currentPageId], ([$profile, $pageId]) => {
  if (!$profile || !$pageId) return null;
  return $profile.pages[$pageId] ?? null;
});

/** All pages in the active profile, as an array */
export const allPages = derived(activeProfile, ($profile) => {
  if (!$profile) return [];
  return Object.values($profile.pages);
});

/** Whether we're on the root page */
export const isOnRootPage = derived(
  [activeProfile, currentPageId],
  ([$profile, $pageId]) => $profile?.rootPageId === $pageId
);

/** Currently selected button index in the UI (for editing) */
export const selectedButtonIndex = writable<number | null>(null);

/** Currently selected knob ID in the UI (for editing) */
export const selectedKnobId = writable<string | null>(null);

/** Clear all selection (button & knob) */
export function clearSelection(): void {
  selectedButtonIndex.set(null);
  selectedKnobId.set(null);
}

/** Select a button (clears any knob selection) */
export function selectButton(index: number): void {
  selectedKnobId.set(null);
  selectedButtonIndex.set(index);
}

/** Select a knob (clears any button selection) */
export function selectKnob(knobId: string): void {
  selectedButtonIndex.set(null);
  selectedKnobId.set(knobId);
}

/** The device key of the currently selected device (cached from selectedDeviceId) */
let _currentDeviceKey: string | null = null;

/** Get the current device key */
export function getCurrentDeviceKey(): string | null {
  return _currentDeviceKey;
}

/** Set the current device key and load its profile/page state */
export async function setCurrentDeviceKey(dKey: string | null): Promise<void> {
  console.debug(`[Store:setCurrentDeviceKey] "${_currentDeviceKey}" -> "${dKey}"`);
  _currentDeviceKey = dKey;
  if (!dKey) return;

  // Load device-specific profile
  const deviceProfileId = await window.osc.deviceGetActiveProfile(dKey);
  console.debug(`[Store:setCurrentDeviceKey] dKey="${dKey}" -> profileId="${deviceProfileId}"`);
  activeProfileId.set(deviceProfileId);

  // Load device-specific page state
  const state = await window.osc.deviceGetPageState(dKey);
  applyPageState(state);
}

/** Apply profile data from the main process */
function applyProfileData(data: ProfileData): void {
  profiles.set(data.profiles);
  globalActiveProfileId.set(data.activeProfileId);
  deviceProfileAssignment.set(data.deviceProfileAssignment ?? {});

  // Update the activeProfileId for the currently selected device
  if (_currentDeviceKey) {
    const assignedProfileId = data.deviceProfileAssignment?.[_currentDeviceKey] ?? data.activeProfileId;
    activeProfileId.set(assignedProfileId);
  } else {
    activeProfileId.set(data.activeProfileId);
  }
}

/** Apply page navigation state */
function applyPageState(state: PageNavigationState): void {
  // If the state has a device key and it's not for our current device, ignore it
  if (state.deviceKey && _currentDeviceKey && state.deviceKey !== _currentDeviceKey) {
    return;
  }

  currentPageId.set(state.currentPageId);
  breadcrumbs.set(state.breadcrumbs);
  // Clear preview images — the main process will push new ones for the new page
  keyPreviews.set(new Map());
}

/** Load profiles from main process */
export async function loadProfiles(): Promise<void> {
  const data = await window.osc.getAllProfiles();
  applyProfileData(data);

  // Also load the current page state for the selected device
  if (_currentDeviceKey) {
    const state = await window.osc.deviceGetPageState(_currentDeviceKey);
    applyPageState(state);
  } else {
    const state = await window.osc.getPageState();
    applyPageState(state);
  }
}

/** Save a profile */
export async function saveProfile(profile: Profile): Promise<void> {
  await window.osc.saveProfile(profile);
  // Profile data will be refreshed via the onProfileChanged listener
}

/** Update a binding on the current page of the active profile for the selected device.
 *  `action`: ActionConfig = set action, null = clear this trigger's action, undefined = leave action unchanged.
 *  `appearance`: ButtonAppearance = set appearance, null = clear appearance, undefined = leave appearance unchanged.
 */
export async function updateBinding(
  buttonIndex: number,
  action: ActionConfig | null | undefined,
  trigger: TriggerType = 'press',
  appearance?: ButtonAppearance | null
): Promise<void> {
  const data = await window.osc.getAllProfiles();
  const dKey = _currentDeviceKey;
  const profileId = dKey ? (data.deviceProfileAssignment?.[dKey] ?? data.activeProfileId) : data.activeProfileId;
  const profile = data.profiles.find((p) => p.id === profileId);
  console.debug(
    `[Store:updateBinding] btn=${buttonIndex} trigger="${trigger}" dKey="${dKey}" profileId="${profileId}"`
  );
  if (!profile) return;

  const state = dKey ? await window.osc.deviceGetPageState(dKey) : await window.osc.getPageState();
  const page = profile.pages[state.currentPageId];
  if (!page) return;

  // Ensure a ButtonBinding exists when we need to write something
  const needsBinding = action || appearance || action === null || appearance === null;
  if (needsBinding && !page.bindings[buttonIndex]) {
    page.bindings[buttonIndex] = {};
  }

  // Update action if specified (undefined = leave unchanged)
  if (action !== undefined) {
    if (action) {
      page.bindings[buttonIndex][trigger] = action;
    } else if (page.bindings[buttonIndex]) {
      delete page.bindings[buttonIndex][trigger];
    }
  }

  // Update appearance if specified (undefined = leave unchanged)
  if (appearance !== undefined) {
    if (appearance) {
      if (!page.bindings[buttonIndex]) page.bindings[buttonIndex] = {};
      page.bindings[buttonIndex].appearance = appearance;
    } else if (page.bindings[buttonIndex]) {
      delete page.bindings[buttonIndex].appearance;
    }
  }

  // Clean up: if all trigger slots and appearance are empty, remove the binding entirely
  if (page.bindings[buttonIndex]) {
    const b = page.bindings[buttonIndex];
    if (!b.press && !b.longPress && !b.doubleTap && !b.down && !b.up && !b.appearance) {
      delete page.bindings[buttonIndex];
    }
  }

  await saveProfile(profile);
}

/** Update a knob binding on the current page of the active profile for the selected device.
 *  Sets or clears the given trigger slot on the KnobBinding for the specified knob ID.
 */
export async function updateKnobBinding(
  knobId: string,
  action: ActionConfig | null,
  trigger: KnobTriggerType = 'rotateClockwise'
): Promise<void> {
  const data = await window.osc.getAllProfiles();
  const dKey = _currentDeviceKey;
  const profileId = dKey ? (data.deviceProfileAssignment?.[dKey] ?? data.activeProfileId) : data.activeProfileId;
  const profile = data.profiles.find((p) => p.id === profileId);
  if (!profile) return;

  const state = dKey ? await window.osc.deviceGetPageState(dKey) : await window.osc.getPageState();
  const page = profile.pages[state.currentPageId];
  if (!page) return;

  // Ensure knobBindings map exists
  if (!page.knobBindings) {
    page.knobBindings = {};
  }

  if (action) {
    if (!page.knobBindings[knobId]) {
      page.knobBindings[knobId] = {};
    }
    page.knobBindings[knobId][trigger] = action;
  } else {
    if (page.knobBindings[knobId]) {
      delete page.knobBindings[knobId][trigger];
      // If all trigger slots are now empty, remove the binding entirely
      const kb = page.knobBindings[knobId];
      if (!kb.rotateClockwise && !kb.rotateCounterClockwise && !kb.press) {
        delete page.knobBindings[knobId];
      }
    }
  }

  await saveProfile(profile);
}

/**
 * Swap or move bindings between two button positions on the current page.
 * - If `mode` is `'swap'`: the two buttons exchange their entire ButtonBinding.
 * - If `mode` is `'copy'`: the source binding is duplicated to the target (source unchanged).
 * Both operations persist the profile and trigger device re-render.
 */
export async function swapBindings(fromIndex: number, toIndex: number, mode: 'swap' | 'copy' = 'swap'): Promise<void> {
  if (fromIndex === toIndex) return;

  const data = await window.osc.getAllProfiles();
  const dKey = _currentDeviceKey;
  const profileId = dKey ? (data.deviceProfileAssignment?.[dKey] ?? data.activeProfileId) : data.activeProfileId;
  const profile = data.profiles.find((p) => p.id === profileId);
  if (!profile) return;

  const state = dKey ? await window.osc.deviceGetPageState(dKey) : await window.osc.getPageState();
  const page = profile.pages[state.currentPageId];
  if (!page) return;

  const fromBinding = page.bindings[fromIndex];
  const toBinding = page.bindings[toIndex];

  if (mode === 'copy') {
    // Deep-copy from → to (give new IDs to avoid collisions)
    if (fromBinding) {
      page.bindings[toIndex] = structuredClone(fromBinding);
    }
  } else {
    // Swap: move both directions
    if (fromBinding && toBinding) {
      page.bindings[fromIndex] = toBinding;
      page.bindings[toIndex] = fromBinding;
    } else if (fromBinding) {
      page.bindings[toIndex] = fromBinding;
      delete page.bindings[fromIndex];
    } else if (toBinding) {
      page.bindings[fromIndex] = toBinding;
      delete page.bindings[toIndex];
    }
  }

  await saveProfile(profile);
}

/** Switch the active profile for the current device */
export async function switchProfile(id: string): Promise<void> {
  if (_currentDeviceKey) {
    await window.osc.deviceSetActiveProfile(_currentDeviceKey, id);
  } else {
    await window.osc.setActiveProfile(id);
  }
  clearSelection();
  // Profile + page state will be refreshed via listeners
}

/** Create a new profile */
export async function createProfile(name: string): Promise<Profile> {
  const profile = await window.osc.createProfile(name);
  return profile;
}

/** Delete a profile */
export async function deleteProfile(id: string): Promise<boolean> {
  const success = await window.osc.deleteProfile(id);
  if (success) {
    clearSelection();
  }
  return success;
}

/** Rename a profile */
export async function renameProfile(id: string, newName: string): Promise<boolean> {
  return window.osc.renameProfile(id, newName);
}

// ─── Page Navigation ─────────────────────────────────────────

/** Navigate to a specific page on the selected device */
export async function navigateToPage(pageId: string): Promise<void> {
  if (_currentDeviceKey) {
    const state = await window.osc.deviceNavigatePage(_currentDeviceKey, pageId);
    if (state) {
      clearSelection();
    }
  } else {
    const state = await window.osc.navigatePage(pageId);
    if (state) {
      clearSelection();
    }
  }
}

/** Navigate back one level on the selected device */
export async function navigateBack(): Promise<void> {
  if (_currentDeviceKey) {
    const state = await window.osc.deviceNavigateBack(_currentDeviceKey);
    if (state) {
      clearSelection();
    }
  } else {
    const state = await window.osc.navigateBack();
    if (state) {
      clearSelection();
    }
  }
}

/** Navigate to root page on the selected device */
export async function navigateToRoot(): Promise<void> {
  if (_currentDeviceKey) {
    const state = await window.osc.deviceNavigateRoot(_currentDeviceKey);
    if (state) {
      clearSelection();
    }
  } else {
    const state = await window.osc.navigateRoot();
    if (state) {
      clearSelection();
    }
  }
}

// ─── Page CRUD ───────────────────────────────────────────────

/** Create a new page */
export async function createPage(name: string): Promise<Page | null> {
  return window.osc.createPage(name, _currentDeviceKey ?? undefined);
}

/** Delete a page */
export async function deletePage(pageId: string): Promise<boolean> {
  const success = await window.osc.deletePage(pageId, _currentDeviceKey ?? undefined);
  if (success) {
    clearSelection();
  }
  return success;
}

/** Rename a page */
export async function renamePage(pageId: string, newName: string): Promise<boolean> {
  return window.osc.renamePage(pageId, newName, _currentDeviceKey ?? undefined);
}

import type { KeyPreviewUpdate } from '../../shared/types';

/** Subscribe to profile changes from main process. Returns cleanup function. */
export function initProfileListener(): () => void {
  const cleanupProfile = window.osc.onProfileChanged((data: ProfileData) => {
    applyProfileData(data);
  });

  const cleanupPage = window.osc.onPageChanged((state: PageNavigationState) => {
    applyPageState(state);
  });

  // Listen for key preview image updates from the main process
  const cleanupPreview = window.osc.onKeyPreviewUpdate((update: KeyPreviewUpdate) => {
    // Only apply previews for the currently selected device
    if (update.deviceKey && _currentDeviceKey && update.deviceKey !== _currentDeviceKey) {
      return;
    }
    keyPreviews.update((map) => {
      const next = new Map(map);
      if (update.dataUri) {
        next.set(update.keyIndex, update.dataUri);
      } else {
        // Null dataUri means the key is unbound — remove stale preview
        next.delete(update.keyIndex);
      }
      return next;
    });
  });

  return () => {
    cleanupProfile();
    cleanupPage();
    cleanupPreview();
  };
}
