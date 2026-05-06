import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ActionConfig,
  ButtonBinding,
  InteractionSettings,
  Page,
  PageBreadcrumb,
  PageNavigationState,
  Profile,
  ProfileData,
  SafeAreaInsets
} from '../../shared/types';
import { DEFAULT_INTERACTION_SETTINGS } from '../../shared/types';
import type { AppSwitchSettings } from '../../shared/app-switch-types';
import { DEFAULT_APP_SWITCH_SETTINGS } from '../../shared/app-switch-types';

const PROFILES_FILE = 'profiles.json';

function generateId(): string {
  // Simple ID generation without external deps
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/** V1 profile shape (flat bindings, no pages) for migration */
interface ProfileV1 {
  id: string;
  name: string;
  bindings: Record<number, unknown>;
}

interface ProfileDataV1 {
  version: 1;
  activeProfileId: string;
  profiles: ProfileV1[];
}

/** V2 page shape (bindings were ActionConfig directly) */
interface PageV2 {
  id: string;
  name: string;
  bindings: Record<number, ActionConfig>;
}

interface ProfileV2 {
  id: string;
  name: string;
  rootPageId: string;
  pages: Record<string, PageV2>;
}

interface ProfileDataV2 {
  version: 2;
  activeProfileId: string;
  profiles: ProfileV2[];
}

/** Migrate a v1 profile (flat bindings) to v2 (pages) */
function migrateProfileV1toV2(old: ProfileV1): ProfileV2 {
  const rootPageId = generateId();
  return {
    id: old.id,
    name: old.name,
    rootPageId,
    pages: {
      [rootPageId]: {
        id: rootPageId,
        name: 'Main',
        bindings: old.bindings as PageV2['bindings']
      }
    }
  };
}

/** Migrate a v2 page (ActionConfig bindings) to v3 (ButtonBinding) */
function migratePageV2toV3(oldPage: PageV2): Page {
  const newBindings: Record<number, ButtonBinding> = {};
  for (const [key, action] of Object.entries(oldPage.bindings)) {
    newBindings[Number(key)] = { press: action };
  }
  return {
    id: oldPage.id,
    name: oldPage.name,
    bindings: newBindings
  };
}

/** Migrate a v2 profile to v3 */
function migrateProfileV2toV3(old: ProfileV2): Profile {
  const newPages: Record<string, Page> = {};
  for (const [pageId, page] of Object.entries(old.pages)) {
    newPages[pageId] = migratePageV2toV3(page);
  }
  return {
    id: old.id,
    name: old.name,
    rootPageId: old.rootPageId,
    pages: newPages
  };
}

export class ProfileManager extends EventEmitter {
  private dataPath: string;
  private data: ProfileData;

  // Navigation state: track the current page per profile (legacy / fallback)
  private currentPageIds: Map<string, string> = new Map();
  // Navigation history for breadcrumb support (stack of page IDs)
  private navigationStacks: Map<string, string[]> = new Map();

  // Per-device navigation state: overrides the per-profile state when present
  private deviceCurrentPageIds: Map<string, string> = new Map();
  private deviceNavigationStacks: Map<string, string[]> = new Map();

  constructor() {
    super();
    this.dataPath = path.join(app.getPath('userData'), PROFILES_FILE);
    this.data = this.defaultData();
  }

  private defaultData(): ProfileData {
    const rootPageId = generateId();
    const defaultProfile: Profile = {
      id: generateId(),
      name: 'Default',
      rootPageId,
      pages: {
        [rootPageId]: {
          id: rootPageId,
          name: 'Main',
          bindings: {}
        }
      }
    };

    return {
      version: 3,
      activeProfileId: defaultProfile.id,
      profiles: [defaultProfile]
    };
  }

  /** Initialize: load existing profiles or create defaults */
  async init(): Promise<void> {
    try {
      const raw = await fs.readFile(this.dataPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed.version === 1) {
        // v1 → v2 → v3
        console.log('[ProfileManager] Migrating v1 profiles to v3 (pages + triggers)');
        const v1 = parsed as ProfileDataV1;
        const v2Profiles = v1.profiles.map(migrateProfileV1toV2);
        this.data = {
          version: 3,
          activeProfileId: v1.activeProfileId,
          profiles: v2Profiles.map(migrateProfileV2toV3)
        };
        await this.save();
      } else if (parsed.version === 2) {
        // v2 → v3
        console.log('[ProfileManager] Migrating v2 profiles to v3 (triggers)');
        const v2 = parsed as ProfileDataV2;
        this.data = {
          version: 3,
          activeProfileId: v2.activeProfileId,
          profiles: v2.profiles.map(migrateProfileV2toV3)
        };
        await this.save();
      } else {
        this.data = parsed as ProfileData;
      }

      // Fixup: migrate obsConnectionSettings → pluginSettings.obs (idempotent)
      const dataWithObs = this.data as ProfileData & { obsConnectionSettings?: Record<string, unknown> };
      if (dataWithObs.obsConnectionSettings) {
        console.log('[ProfileManager] Migrating obsConnectionSettings to pluginSettings.obs');
        if (!this.data.pluginSettings) {
          this.data.pluginSettings = {};
        }
        this.data.pluginSettings['obs'] = { ...dataWithObs.obsConnectionSettings };
        delete dataWithObs.obsConnectionSettings;
        await this.save();
      }

      // Fixup: migrate discordConnectionSettings → pluginSettings.discord (idempotent)
      const dataWithDiscord = this.data as ProfileData & { discordConnectionSettings?: Record<string, unknown> };
      if (dataWithDiscord.discordConnectionSettings) {
        console.log('[ProfileManager] Migrating discordConnectionSettings to pluginSettings.discord');
        if (!this.data.pluginSettings) {
          this.data.pluginSettings = {};
        }
        this.data.pluginSettings['discord'] = { ...dataWithDiscord.discordConnectionSettings };
        delete dataWithDiscord.discordConnectionSettings;
        await this.save();
      }

      // Initialize navigation state for all profiles
      for (const profile of this.data.profiles) {
        this.currentPageIds.set(profile.id, profile.rootPageId);
        this.navigationStacks.set(profile.id, [profile.rootPageId]);
      }

      console.log(`[ProfileManager] Loaded ${this.data.profiles.length} profile(s)`);
    } catch {
      // File doesn't exist yet — use defaults
      console.log('[ProfileManager] No profiles found, using defaults');
      for (const profile of this.data.profiles) {
        this.currentPageIds.set(profile.id, profile.rootPageId);
        this.navigationStacks.set(profile.id, [profile.rootPageId]);
      }
      await this.save();
    }
  }

  // ─── Profile CRUD ────────────────────────────────────────────

  /** Get all profile data */
  getData(): ProfileData {
    return { ...this.data };
  }

  /** Get a specific profile by ID */
  getProfile(id: string): Profile | null {
    return this.data.profiles.find((p) => p.id === id) ?? null;
  }

  /** Get the active profile */
  getActiveProfile(): Profile | null {
    return this.getProfile(this.data.activeProfileId);
  }

  /** Save or update a profile */
  async saveProfile(profile: Profile): Promise<void> {
    const idx = this.data.profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      this.data.profiles[idx] = profile;
    } else {
      this.data.profiles.push(profile);
    }
    await this.save();
  }

  /** Set the active profile */
  async setActiveProfile(id: string): Promise<boolean> {
    if (this.data.profiles.some((p) => p.id === id)) {
      this.data.activeProfileId = id;
      // Reset navigation to root page when switching profiles
      const profile = this.getProfile(id)!;
      this.currentPageIds.set(id, profile.rootPageId);
      this.navigationStacks.set(id, [profile.rootPageId]);
      await this.save();
      console.log(`[ProfileManager] Active profile → "${profile.name}" (${id})`);
      this.emit('profile-changed', id);
      this.emit('page-changed', profile.rootPageId);
      return true;
    }
    return false;
  }

  /** Create a new profile with a given name and an empty root page */
  async createProfile(name: string): Promise<Profile> {
    const rootPageId = generateId();
    const profile: Profile = {
      id: generateId(),
      name,
      rootPageId,
      pages: {
        [rootPageId]: {
          id: rootPageId,
          name: 'Main',
          bindings: {}
        }
      }
    };
    this.data.profiles.push(profile);
    this.currentPageIds.set(profile.id, rootPageId);
    this.navigationStacks.set(profile.id, [rootPageId]);
    await this.save();
    console.log(`[ProfileManager] Created profile "${name}" (${profile.id})`);
    return profile;
  }

  /** Import a profile from exported data, assigning fresh IDs to avoid conflicts */
  async importProfile(incoming: Profile): Promise<Profile> {
    // Assign a fresh profile ID
    const newProfileId = generateId();

    // Deduplicate name if needed
    let name = incoming.name;
    const existingNames = new Set(this.data.profiles.map((p) => p.name));
    if (existingNames.has(name)) {
      let counter = 2;
      while (existingNames.has(`${incoming.name} (${counter})`)) counter++;
      name = `${incoming.name} (${counter})`;
    }

    // Re-key pages with fresh IDs, preserving internal page references
    const oldToNewPageId = new Map<string, string>();
    for (const oldPageId of Object.keys(incoming.pages)) {
      oldToNewPageId.set(oldPageId, generateId());
    }

    const newPages: Record<string, Page> = {};
    for (const [oldPageId, page] of Object.entries(incoming.pages)) {
      const newPageId = oldToNewPageId.get(oldPageId)!;

      // Remap go-to-page references in bindings
      const newBindings: Record<number, ButtonBinding> = {};
      for (const [key, binding] of Object.entries(page.bindings)) {
        const newBinding: ButtonBinding = {};
        for (const trigger of ['press', 'longPress', 'doubleTap', 'down', 'up'] as const) {
          const action = binding[trigger];
          if (!action) continue;
          const cloned = structuredClone(action);
          cloned.id = `action-${newProfileId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          if (cloned.type === 'go-to-page' && cloned.config) {
            const cfg = cloned.config as Record<string, unknown>;
            const oldTargetId = cfg.pageId as string;
            if (oldTargetId && oldToNewPageId.has(oldTargetId)) {
              cfg.pageId = oldToNewPageId.get(oldTargetId);
            }
          }
          newBinding[trigger] = cloned;
        }
        newBindings[Number(key)] = newBinding;
      }

      newPages[newPageId] = {
        id: newPageId,
        name: page.name,
        bindings: newBindings
      };
    }

    const newRootPageId = oldToNewPageId.get(incoming.rootPageId) ?? Object.keys(newPages)[0];

    const profile: Profile = {
      id: newProfileId,
      name,
      rootPageId: newRootPageId,
      pages: newPages
    };

    this.data.profiles.push(profile);
    this.currentPageIds.set(profile.id, newRootPageId);
    this.navigationStacks.set(profile.id, [newRootPageId]);
    await this.save();
    console.log(`[ProfileManager] Imported profile "${profile.name}" (${profile.id})`);
    return profile;
  }

  /** Delete a profile by ID. Cannot delete the last remaining profile. */
  async deleteProfile(id: string): Promise<boolean> {
    if (this.data.profiles.length <= 1) {
      console.warn('[ProfileManager] Cannot delete the last profile');
      return false;
    }
    const idx = this.data.profiles.findIndex((p) => p.id === id);
    if (idx < 0) return false;

    this.data.profiles.splice(idx, 1);
    this.currentPageIds.delete(id);
    this.navigationStacks.delete(id);

    // If the deleted profile was active, switch to the first remaining profile
    if (this.data.activeProfileId === id) {
      this.data.activeProfileId = this.data.profiles[0].id;
      const newActive = this.data.profiles[0];
      this.currentPageIds.set(newActive.id, newActive.rootPageId);
      this.navigationStacks.set(newActive.id, [newActive.rootPageId]);
    }

    // Clean up per-device assignments pointing to the deleted profile
    if (this.data.deviceProfileAssignment) {
      const fallbackId = this.data.profiles[0].id;
      for (const [deviceKey, profileId] of Object.entries(this.data.deviceProfileAssignment)) {
        if (profileId === id) {
          this.data.deviceProfileAssignment[deviceKey] = fallbackId;
          // Reset device navigation
          const fallback = this.getProfile(fallbackId)!;
          this.deviceCurrentPageIds.set(deviceKey, fallback.rootPageId);
          this.deviceNavigationStacks.set(deviceKey, [fallback.rootPageId]);
        }
      }
    }

    await this.save();
    console.log(`[ProfileManager] Deleted profile ${id}`);
    return true;
  }

  /** Rename a profile */
  async renameProfile(id: string, newName: string): Promise<boolean> {
    const profile = this.data.profiles.find((p) => p.id === id);
    if (!profile) return false;
    const oldName = profile.name;
    profile.name = newName;
    await this.save();
    console.log(`[ProfileManager] Renamed profile "${oldName}" → "${newName}"`);
    return true;
  }

  /** Duplicate an existing profile */
  async duplicateProfile(sourceId: string, newName?: string): Promise<Profile | null> {
    const source = this.getProfile(sourceId);
    if (!source) return null;

    const profile: Profile = {
      id: generateId(),
      name: newName ?? `${source.name} (Copy)`,
      rootPageId: source.rootPageId,
      pages: JSON.parse(JSON.stringify(source.pages))
    };
    this.data.profiles.push(profile);
    this.currentPageIds.set(profile.id, profile.rootPageId);
    this.navigationStacks.set(profile.id, [profile.rootPageId]);
    await this.save();
    console.log(`[ProfileManager] Duplicated profile "${source.name}" → "${profile.name}"`);
    return profile;
  }

  // ─── Page Navigation ─────────────────────────────────────────

  /** Get the current page for the active profile */
  getCurrentPage(): Page | null {
    const profile = this.getActiveProfile();
    if (!profile) return null;
    const pageId = this.currentPageIds.get(profile.id) ?? profile.rootPageId;
    return profile.pages[pageId] ?? null;
  }

  /** Get the current page ID for the active profile */
  getCurrentPageId(): string {
    const profile = this.getActiveProfile();
    if (!profile) return '';
    return this.currentPageIds.get(profile.id) ?? profile.rootPageId;
  }

  /** Navigate to a specific page */
  navigateToPage(pageId: string): PageNavigationState | null {
    const profile = this.getActiveProfile();
    if (!profile || !profile.pages[pageId]) return null;

    const stack = this.navigationStacks.get(profile.id) ?? [profile.rootPageId];

    // Check if we're navigating back to something already in the stack
    const existingIdx = stack.indexOf(pageId);
    if (existingIdx >= 0) {
      // Trim the stack to that point (navigating back)
      stack.length = existingIdx + 1;
    } else {
      // Push new page onto the stack
      stack.push(pageId);
    }

    this.currentPageIds.set(profile.id, pageId);
    this.navigationStacks.set(profile.id, stack);

    this.emit('page-changed', pageId);
    return this.getNavigationState();
  }

  /** Navigate back one level */
  navigateBack(): PageNavigationState | null {
    const profile = this.getActiveProfile();
    if (!profile) return null;

    const stack = this.navigationStacks.get(profile.id) ?? [profile.rootPageId];
    if (stack.length <= 1) return this.getNavigationState(); // Already at root

    stack.pop();
    const newPageId = stack[stack.length - 1];
    this.currentPageIds.set(profile.id, newPageId);
    this.navigationStacks.set(profile.id, stack);

    this.emit('page-changed', newPageId);
    return this.getNavigationState();
  }

  /** Navigate to root page */
  navigateToRoot(): PageNavigationState | null {
    const profile = this.getActiveProfile();
    if (!profile) return null;

    this.currentPageIds.set(profile.id, profile.rootPageId);
    this.navigationStacks.set(profile.id, [profile.rootPageId]);

    this.emit('page-changed', profile.rootPageId);
    return this.getNavigationState();
  }

  /** Get the current navigation state (current page + breadcrumbs) */
  getNavigationState(): PageNavigationState {
    const profile = this.getActiveProfile();
    if (!profile) {
      return { currentPageId: '', breadcrumbs: [] };
    }

    const stack = this.navigationStacks.get(profile.id) ?? [profile.rootPageId];
    const breadcrumbs: PageBreadcrumb[] = stack.map((pageId) => ({
      pageId,
      pageName: profile.pages[pageId]?.name ?? 'Unknown'
    }));

    return {
      currentPageId: this.currentPageIds.get(profile.id) ?? profile.rootPageId,
      breadcrumbs
    };
  }

  // ─── Per-Device Profile Assignment ───────────────────────────

  /** Ensure a device has its own profile assignment.
   *  - If the device already has an explicit entry ➜ nothing to do.
   *  - If this is the first device that ever connects ➜ assign the existing active profile.
   *  - Otherwise ➜ create a brand-new profile (named after the device) so every device is independent. */
  async ensureDeviceAssignment(deviceKey: string, deviceName?: string): Promise<void> {
    if (!this.data.deviceProfileAssignment) {
      this.data.deviceProfileAssignment = {};
    }
    if (this.data.deviceProfileAssignment[deviceKey]) {
      return; // Already assigned
    }

    const hasOtherAssignments = Object.keys(this.data.deviceProfileAssignment).length > 0;

    if (!hasOtherAssignments) {
      // First device — adopt the existing active profile
      this.data.deviceProfileAssignment[deviceKey] = this.data.activeProfileId;
    } else {
      // Another device already claimed a profile — create a fresh one for this device
      const name = deviceName ? `${deviceName} Profile` : 'New Device Profile';
      const newProfile = await this.createProfile(name);
      this.data.deviceProfileAssignment[deviceKey] = newProfile.id;
    }

    await this.save();
    console.log(
      `[ProfileManager] Auto-assigned device "${deviceKey}" → profile "${this.data.deviceProfileAssignment[deviceKey]}"`
    );
  }

  /** Get the profile assigned to a specific device, or the global active profile as fallback */
  getDeviceProfileId(deviceKey: string): string {
    return this.data.deviceProfileAssignment?.[deviceKey] ?? this.data.activeProfileId;
  }

  /** Get the profile assigned to a specific device */
  getDeviceProfile(deviceKey: string): Profile | null {
    const profileId = this.getDeviceProfileId(deviceKey);
    return this.getProfile(profileId);
  }

  /** Assign a profile to a specific device */
  async setDeviceProfile(deviceKey: string, profileId: string): Promise<boolean> {
    const profile = this.getProfile(profileId);
    if (!profile) return false;

    if (!this.data.deviceProfileAssignment) {
      this.data.deviceProfileAssignment = {};
    }
    this.data.deviceProfileAssignment[deviceKey] = profileId;

    // Reset navigation to root page for this device
    this.deviceCurrentPageIds.set(deviceKey, profile.rootPageId);
    this.deviceNavigationStacks.set(deviceKey, [profile.rootPageId]);

    await this.save();
    console.log(`[ProfileManager] Device "${deviceKey}" → profile "${profile.name}" (${profileId})`);
    this.emit('device-profile-changed', deviceKey, profileId);
    this.emit('device-page-changed', deviceKey, profile.rootPageId);
    return true;
  }

  /** Get the current page for a specific device */
  getDeviceCurrentPage(deviceKey: string): Page | null {
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile) return null;
    const pageId = this.deviceCurrentPageIds.get(deviceKey) ?? profile.rootPageId;
    return profile.pages[pageId] ?? null;
  }

  /** Get the current page ID for a specific device */
  getDeviceCurrentPageId(deviceKey: string): string {
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile) return '';
    return this.deviceCurrentPageIds.get(deviceKey) ?? profile.rootPageId;
  }

  /** Navigate to a page on a specific device */
  navigateDeviceToPage(deviceKey: string, pageId: string): PageNavigationState | null {
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile || !profile.pages[pageId]) return null;

    const stack = this.deviceNavigationStacks.get(deviceKey) ?? [profile.rootPageId];

    const existingIdx = stack.indexOf(pageId);
    if (existingIdx >= 0) {
      stack.length = existingIdx + 1;
    } else {
      stack.push(pageId);
    }

    this.deviceCurrentPageIds.set(deviceKey, pageId);
    this.deviceNavigationStacks.set(deviceKey, stack);

    this.emit('device-page-changed', deviceKey, pageId);
    return this.getDeviceNavigationState(deviceKey);
  }

  /** Navigate back one level on a specific device */
  navigateDeviceBack(deviceKey: string): PageNavigationState | null {
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile) return null;

    const stack = this.deviceNavigationStacks.get(deviceKey) ?? [profile.rootPageId];
    if (stack.length <= 1) return this.getDeviceNavigationState(deviceKey);

    stack.pop();
    const newPageId = stack[stack.length - 1];
    this.deviceCurrentPageIds.set(deviceKey, newPageId);
    this.deviceNavigationStacks.set(deviceKey, stack);

    this.emit('device-page-changed', deviceKey, newPageId);
    return this.getDeviceNavigationState(deviceKey);
  }

  /** Navigate to root on a specific device */
  navigateDeviceToRoot(deviceKey: string): PageNavigationState | null {
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile) return null;

    this.deviceCurrentPageIds.set(deviceKey, profile.rootPageId);
    this.deviceNavigationStacks.set(deviceKey, [profile.rootPageId]);

    this.emit('device-page-changed', deviceKey, profile.rootPageId);
    return this.getDeviceNavigationState(deviceKey);
  }

  /** Get navigation state for a specific device */
  getDeviceNavigationState(deviceKey: string): PageNavigationState {
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile) {
      return { currentPageId: '', breadcrumbs: [], deviceKey };
    }

    const stack = this.deviceNavigationStacks.get(deviceKey) ?? [profile.rootPageId];
    const breadcrumbs: PageBreadcrumb[] = stack.map((pageId) => ({
      pageId,
      pageName: profile.pages[pageId]?.name ?? 'Unknown'
    }));

    return {
      currentPageId: this.deviceCurrentPageIds.get(deviceKey) ?? profile.rootPageId,
      breadcrumbs,
      deviceKey
    };
  }

  /** Initialize per-device navigation state (called after loading data or on device connect) */
  initDeviceNavigation(deviceKey: string): void {
    if (this.deviceCurrentPageIds.has(deviceKey)) return; // Already initialized
    const profile = this.getDeviceProfile(deviceKey);
    if (!profile) return;
    this.deviceCurrentPageIds.set(deviceKey, profile.rootPageId);
    this.deviceNavigationStacks.set(deviceKey, [profile.rootPageId]);
  }

  // ─── Page CRUD ───────────────────────────────────────────────

  /** Create a new page within the active profile (or device-specific profile).
   *  New pages get a default "← Back" button on key 0 (top-left).
   *  The user can freely change or remove it.
   */
  async createPage(name: string, deviceKey?: string): Promise<Page | null> {
    const profile = deviceKey ? this.getDeviceProfile(deviceKey) : this.getActiveProfile();
    if (!profile) return null;

    const page: Page = {
      id: generateId(),
      name,
      bindings: {
        // Default back button on key 0 (top-left) — removable by the user
        0: {
          press: {
            id: `action-0-${Date.now()}`,
            type: 'go-to-back',
            label: '← Back',
            config: {}
          }
        }
      }
    };
    profile.pages[page.id] = page;
    await this.save();
    console.log(`[ProfileManager] Created page "${name}" (${page.id}) in profile "${profile.name}"`);
    return page;
  }

  /** Delete a page from the active profile (or device-specific profile). Cannot delete the root page. */
  async deletePage(pageId: string, deviceKey?: string): Promise<boolean> {
    const profile = deviceKey ? this.getDeviceProfile(deviceKey) : this.getActiveProfile();
    if (!profile) return false;
    if (pageId === profile.rootPageId) {
      console.warn('[ProfileManager] Cannot delete the root page');
      return false;
    }
    if (!profile.pages[pageId]) return false;

    delete profile.pages[pageId];

    // Remove any go-to-page actions pointing to this deleted page
    for (const page of Object.values(profile.pages)) {
      for (const [key, binding] of Object.entries(page.bindings)) {
        const triggers = ['press', 'longPress', 'doubleTap', 'down', 'up'] as const;
        for (const trigger of triggers) {
          const action = binding[trigger];
          if (action?.type === 'go-to-page') {
            const config = action.config as Record<string, unknown>;
            if (config.pageId === pageId) {
              delete binding[trigger];
            }
          }
        }
        // Clean up empty bindings
        if (!binding.press && !binding.longPress && !binding.doubleTap && !binding.down && !binding.up) {
          delete page.bindings[Number(key)];
        }
      }
    }

    // If currently navigated to the deleted page, go back to root
    const currentPageId = this.currentPageIds.get(profile.id);
    if (currentPageId === pageId) {
      this.currentPageIds.set(profile.id, profile.rootPageId);
      this.navigationStacks.set(profile.id, [profile.rootPageId]);
    }

    await this.save();
    console.log(`[ProfileManager] Deleted page ${pageId}`);
    return true;
  }

  /** Rename a page within the active profile (or device-specific profile) */
  async renamePage(pageId: string, newName: string, deviceKey?: string): Promise<boolean> {
    const profile = deviceKey ? this.getDeviceProfile(deviceKey) : this.getActiveProfile();
    if (!profile || !profile.pages[pageId]) return false;
    const oldName = profile.pages[pageId].name;
    profile.pages[pageId].name = newName;
    await this.save();
    console.log(`[ProfileManager] Renamed page "${oldName}" → "${newName}"`);
    return true;
  }

  /** Get all pages for the active profile */
  getPages(): Page[] {
    const profile = this.getActiveProfile();
    if (!profile) return [];
    return Object.values(profile.pages);
  }

  // ─── Interaction Settings ────────────────────────────────────

  /** Get the global interaction timing settings (with defaults) */
  getInteractionSettings(): InteractionSettings {
    return { ...DEFAULT_INTERACTION_SETTINGS, ...this.data.interactionSettings };
  }

  /** Update the global interaction timing settings */
  async setInteractionSettings(settings: InteractionSettings): Promise<void> {
    this.data.interactionSettings = { ...settings };
    await this.save();
    console.log(
      `[ProfileManager] Interaction settings saved — longPress: ${settings.longPressMs}ms, doubleTap: ${settings.doubleTapMs}ms`
    );
  }

  // ─── Plugin Settings ─────────────────────────────────────────

  /** Get a plugin's persisted settings (or empty object if none saved) */
  getPluginSettings(pluginId: string): Record<string, unknown> {
    return { ...(this.data.pluginSettings?.[pluginId] ?? {}) };
  }

  /** Save a plugin's settings to disk */
  async setPluginSettings(pluginId: string, settings: Record<string, unknown>): Promise<void> {
    if (!this.data.pluginSettings) {
      this.data.pluginSettings = {};
    }
    this.data.pluginSettings[pluginId] = { ...settings };
    await this.save();
    console.log(`[ProfileManager] Plugin settings saved for "${pluginId}"`);
  }

  // ─── App Switch Settings ─────────────────────────────────────

  /** Get the per-application profile switching settings (with defaults) */
  getAppSwitchSettings(): AppSwitchSettings {
    return { ...DEFAULT_APP_SWITCH_SETTINGS, ...this.data.appSwitchSettings };
  }

  /** Update the per-application profile switching settings */
  async setAppSwitchSettings(settings: AppSwitchSettings): Promise<void> {
    this.data.appSwitchSettings = { ...settings };
    await this.save();
    console.log(
      `[ProfileManager] App-switch settings saved — enabled: ${settings.enabled}, ${settings.rules.length} rule(s), poll: ${settings.pollIntervalMs}ms`
    );
  }

  // ─── Calibration Insets ───────────────────────────────────────

  /** Get the saved calibration insets for a specific device (by serial key),
   *  or null if never calibrated for that device. */
  getCalibrationInsets(deviceKey?: string): SafeAreaInsets | null {
    const insets = this.data.calibrationInsets;
    if (!insets) return null;

    // Handle migration: if calibrationInsets is still old-format (has top/bottom/left/right at root)
    if ('top' in insets) {
      // Old single-inset format — treat as _default
      if (!deviceKey || deviceKey === '_default') {
        return { ...(insets as unknown as SafeAreaInsets) };
      }
      return null;
    }

    const key = deviceKey || '_default';
    const deviceInsets = (insets as Record<string, SafeAreaInsets>)[key];
    return deviceInsets ? { ...deviceInsets } : null;
  }

  /** Save calibration insets for a specific device (keyed by serial or '_default') */
  async setCalibrationInsets(newInsets: SafeAreaInsets, deviceKey: string = '_default'): Promise<void> {
    // Migrate old single-format to map if needed
    let map: Record<string, SafeAreaInsets>;
    if (!this.data.calibrationInsets) {
      map = {};
    } else if ('top' in this.data.calibrationInsets) {
      // Old format — migrate: move existing value under '_default'
      map = { _default: { ...(this.data.calibrationInsets as unknown as SafeAreaInsets) } };
    } else {
      map = { ...(this.data.calibrationInsets as Record<string, SafeAreaInsets>) };
    }

    map[deviceKey] = { ...newInsets };
    this.data.calibrationInsets = map;
    await this.save();
    console.log(
      `[ProfileManager] Calibration insets saved for "${deviceKey}" — T:${newInsets.top} B:${newInsets.bottom} L:${newInsets.left} R:${newInsets.right}`
    );
  }

  // ─── Device Brightness ────────────────────────────────────

  /** Get the saved brightness for a specific device (by serial key), or null if never set. */
  getBrightness(deviceKey?: string): number | null {
    const map = this.data.deviceBrightness;
    if (!map) return null;
    const key = deviceKey || '_default';
    return map[key] ?? null;
  }

  /** Save brightness for a specific device (keyed by serial or '_default') */
  async saveBrightness(brightness: number, deviceKey: string = '_default'): Promise<void> {
    if (!this.data.deviceBrightness) {
      this.data.deviceBrightness = {};
    }
    this.data.deviceBrightness[deviceKey] = Math.max(0, Math.min(1, brightness));
    await this.save();
    console.log(`[ProfileManager] Brightness saved for "${deviceKey}": ${brightness}`);
  }

  /** Persist to disk */
  private async save(): Promise<void> {
    try {
      const dir = path.dirname(this.dataPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[ProfileManager] Failed to save profiles:', error);
    }
  }
}
