import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileManager } from '../../../src/main/profiles/ProfileManager';
import { setFile, getFile, resetMockFs } from '../../mocks/fs';

// Import fixture data directly (not via mocked fs)
import v1Profile from '../../fixtures/profiles/v1-profile.json';
import v2Profile from '../../fixtures/profiles/v2-profile.json';
import v3Profile from '../../fixtures/profiles/v3-profile.json';
// import minimalProfile from '../../fixtures/profiles/minimal-profile.json';

const DATA_PATH = '/mock/userData/profiles.json';

describe('ProfileManager', () => {
  let pm: ProfileManager;

  beforeEach(() => {
    resetMockFs();
    pm = new ProfileManager();
  });

  // ─── Init & Defaults ─────────────────────────────────────

  describe('init', () => {
    it('should create default profile when no file exists', async () => {
      await pm.init();

      const data = pm.getData();
      expect(data.version).toBe(3);
      expect(data.profiles).toHaveLength(1);
      expect(data.profiles[0].name).toBe('Default');

      // Should have saved the default file
      const saved = getFile(DATA_PATH);
      expect(saved).toBeDefined();
      const parsed = JSON.parse(saved!);
      expect(parsed.version).toBe(3);
    });

    it('should load existing v3 profiles', async () => {
      setFile(DATA_PATH, JSON.stringify(v3Profile));
      await pm.init();

      const data = pm.getData();
      expect(data.version).toBe(3);
      expect(data.profiles).toHaveLength(2);
      expect(data.profiles[0].name).toBe('Streaming');
    });

    it('should migrate v1 profiles to v3', async () => {
      setFile(DATA_PATH, JSON.stringify(v1Profile));
      await pm.init();

      const data = pm.getData();
      expect(data.version).toBe(3);
      expect(data.profiles).toHaveLength(1);

      // V1 flat bindings should now be wrapped in pages with trigger keys
      const profile = data.profiles[0];
      expect(profile.rootPageId).toBeDefined();
      const rootPage = profile.pages[profile.rootPageId];
      expect(rootPage).toBeDefined();

      // V1 bindings become press triggers in V3
      const binding0 = rootPage.bindings[0];
      expect(binding0).toBeDefined();
      expect(binding0.press).toBeDefined();
    });

    it('should migrate v2 profiles to v3', async () => {
      setFile(DATA_PATH, JSON.stringify(v2Profile));
      await pm.init();

      const data = pm.getData();
      expect(data.version).toBe(3);
      // V2 ActionConfig bindings should be wrapped in ButtonBinding (press trigger)
      const profile = data.profiles[0];
      const rootPage = profile.pages[profile.rootPageId];
      const binding0 = rootPage.bindings[0];
      expect(binding0.press).toBeDefined();
      expect(binding0.press!.type).toBe('hotkey');
    });

    it('should handle corrupted file gracefully and use defaults', async () => {
      setFile(DATA_PATH, '{ this is not valid json !!!');
      await pm.init();

      // Should fall back to defaults
      const data = pm.getData();
      expect(data.version).toBe(3);
      expect(data.profiles).toHaveLength(1);
      expect(data.profiles[0].name).toBe('Default');
    });
  });

  // ─── Profile CRUD ────────────────────────────────────────

  describe('profile CRUD', () => {
    beforeEach(async () => {
      await pm.init();
    });

    it('should create a new profile', async () => {
      const profile = await pm.createProfile('Gaming');
      expect(profile.name).toBe('Gaming');
      expect(profile.id).toBeDefined();
      expect(profile.rootPageId).toBeDefined();
      expect(Object.keys(profile.pages)).toHaveLength(1);

      // Should be retrievable
      expect(pm.getProfile(profile.id)).not.toBeNull();
      expect(pm.getData().profiles).toHaveLength(2);
    });

    it('should get active profile', async () => {
      const active = pm.getActiveProfile();
      expect(active).not.toBeNull();
      expect(active!.name).toBe('Default');
    });

    it('should switch active profile', async () => {
      const newProfile = await pm.createProfile('Music');
      const success = await pm.setActiveProfile(newProfile.id);
      expect(success).toBe(true);
      expect(pm.getActiveProfile()!.id).toBe(newProfile.id);
    });

    it('should return false when switching to non-existent profile', async () => {
      const success = await pm.setActiveProfile('non-existent-id');
      expect(success).toBe(false);
    });

    it('should rename a profile', async () => {
      const profile = pm.getActiveProfile()!;
      const success = await pm.renameProfile(profile.id, 'Renamed');
      expect(success).toBe(true);
      expect(pm.getProfile(profile.id)!.name).toBe('Renamed');
    });

    it('should return false when renaming non-existent profile', async () => {
      const success = await pm.renameProfile('bad-id', 'New Name');
      expect(success).toBe(false);
    });

    it('should delete a profile (not the last one)', async () => {
      await pm.createProfile('Second');
      const data = pm.getData();
      expect(data.profiles).toHaveLength(2);

      const firstId = data.profiles[0].id;
      const success = await pm.deleteProfile(firstId);
      expect(success).toBe(true);
      expect(pm.getData().profiles).toHaveLength(1);
    });

    it('should not delete the last remaining profile', async () => {
      const profile = pm.getActiveProfile()!;
      const success = await pm.deleteProfile(profile.id);
      expect(success).toBe(false);
      expect(pm.getData().profiles).toHaveLength(1);
    });

    it('should switch to first remaining profile when deleting active profile', async () => {
      const second = await pm.createProfile('Second');
      await pm.setActiveProfile(second.id);

      await pm.deleteProfile(second.id);
      const active = pm.getActiveProfile();
      expect(active).not.toBeNull();
      expect(active!.name).toBe('Default');
    });

    it('should duplicate a profile', async () => {
      const source = pm.getActiveProfile()!;
      const dup = await pm.duplicateProfile(source.id, 'Default Copy');
      expect(dup).not.toBeNull();
      expect(dup!.name).toBe('Default Copy');
      expect(dup!.id).not.toBe(source.id);
      expect(pm.getData().profiles).toHaveLength(2);
    });

    it('should return null when duplicating non-existent profile', async () => {
      const dup = await pm.duplicateProfile('bad-id');
      expect(dup).toBeNull();
    });
  });

  // ─── Page CRUD ────────────────────────────────────────────

  describe('page CRUD', () => {
    beforeEach(async () => {
      await pm.init();
    });

    it('should create a new page with default back button', async () => {
      const page = await pm.createPage('OBS Controls');
      expect(page).not.toBeNull();
      expect(page!.name).toBe('OBS Controls');
      // Default back button on key 0
      expect(page!.bindings[0]).toBeDefined();
      expect(page!.bindings[0].press!.type).toBe('go-to-back');
    });

    it('should delete a non-root page', async () => {
      const page = await pm.createPage('Temp Page');
      expect(pm.getPages()).toHaveLength(2);

      const success = await pm.deletePage(page!.id);
      expect(success).toBe(true);
      expect(pm.getPages()).toHaveLength(1);
    });

    it('should not delete the root page', async () => {
      const profile = pm.getActiveProfile()!;
      const success = await pm.deletePage(profile.rootPageId);
      expect(success).toBe(false);
    });

    it('should rename a page', async () => {
      const profile = pm.getActiveProfile()!;
      const success = await pm.renamePage(profile.rootPageId, 'Home');
      expect(success).toBe(true);
      expect(pm.getCurrentPage()!.name).toBe('Home');
    });
  });

  // ─── Navigation ───────────────────────────────────────────

  describe('page navigation', () => {
    beforeEach(async () => {
      await pm.init();
    });

    it('should start at the root page', () => {
      const profile = pm.getActiveProfile()!;
      expect(pm.getCurrentPageId()).toBe(profile.rootPageId);
    });

    it('should navigate to a child page and back', async () => {
      const profile = pm.getActiveProfile()!;
      const child = await pm.createPage('Child');

      const navResult = pm.navigateToPage(child!.id);
      expect(navResult).not.toBeNull();
      expect(navResult!.currentPageId).toBe(child!.id);
      expect(navResult!.breadcrumbs).toHaveLength(2);

      const backResult = pm.navigateBack();
      expect(backResult).not.toBeNull();
      expect(backResult!.currentPageId).toBe(profile.rootPageId);
      expect(backResult!.breadcrumbs).toHaveLength(1);
    });

    it('should navigate to root', async () => {
      const child = await pm.createPage('Child');
      pm.navigateToPage(child!.id);

      const result = pm.navigateToRoot();
      expect(result).not.toBeNull();
      const profile = pm.getActiveProfile()!;
      expect(result!.currentPageId).toBe(profile.rootPageId);
    });

    it('should return null when navigating to non-existent page', () => {
      const result = pm.navigateToPage('fake-page-id');
      expect(result).toBeNull();
    });

    it('should stay at root when navigating back from root', () => {
      const profile = pm.getActiveProfile()!;
      const result = pm.navigateBack();
      expect(result!.currentPageId).toBe(profile.rootPageId);
    });
  });

  // ─── Settings ─────────────────────────────────────────────

  describe('settings', () => {
    beforeEach(async () => {
      await pm.init();
    });

    it('should return default interaction settings', () => {
      const settings = pm.getInteractionSettings();
      expect(settings.longPressMs).toBe(500);
      expect(settings.doubleTapMs).toBe(300);
    });

    it('should save and return updated interaction settings', async () => {
      await pm.setInteractionSettings({ longPressMs: 700, doubleTapMs: 400 });
      const settings = pm.getInteractionSettings();
      expect(settings.longPressMs).toBe(700);
      expect(settings.doubleTapMs).toBe(400);
    });

    it('should return default app-switch settings', () => {
      const settings = pm.getAppSwitchSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.rules).toEqual([]);
    });

    it('should save and return updated app-switch settings', async () => {
      await pm.setAppSwitchSettings({
        enabled: true,
        defaultProfileId: 'prof-1',
        rules: [{ id: 'rule-1', appName: 'Firefox', profileId: 'prof-2' }],
        pollIntervalMs: 1000
      });
      const settings = pm.getAppSwitchSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.rules).toHaveLength(1);
    });
  });

  // ─── Calibration & Brightness ─────────────────────────────

  describe('calibration and brightness', () => {
    beforeEach(async () => {
      await pm.init();
    });

    it('should return null for uncalibrated device', () => {
      const insets = pm.getCalibrationInsets('device-1');
      expect(insets).toBeNull();
    });

    it('should save and retrieve calibration insets per device', async () => {
      const insets = { top: 5, bottom: 5, left: 3, right: 3 };
      await pm.setCalibrationInsets(insets, 'device-1');
      const retrieved = pm.getCalibrationInsets('device-1');
      expect(retrieved).toEqual(insets);
    });

    it('should return null for unknown device brightness', () => {
      const brightness = pm.getBrightness('device-1');
      expect(brightness).toBeNull();
    });

    it('should save and retrieve brightness per device', async () => {
      await pm.saveBrightness(0.75, 'device-1');
      const brightness = pm.getBrightness('device-1');
      expect(brightness).toBe(0.75);
    });

    it('should clamp brightness to 0-1 range', async () => {
      await pm.saveBrightness(1.5, 'device-1');
      expect(pm.getBrightness('device-1')).toBe(1);

      await pm.saveBrightness(-0.5, 'device-1');
      expect(pm.getBrightness('device-1')).toBe(0);
    });
  });

  // ─── Persistence ──────────────────────────────────────────

  describe('persistence', () => {
    it('should persist changes to disk on every mutation', async () => {
      await pm.init();
      const initialSave = getFile(DATA_PATH);

      await pm.createProfile('New Profile');
      const afterCreate = getFile(DATA_PATH);
      expect(afterCreate).not.toBe(initialSave);

      const parsed = JSON.parse(afterCreate!);
      expect(parsed.profiles).toHaveLength(2);
    });
  });

  // ─── Event Emission ─────────────────────────────────────────

  describe('event emission', () => {
    beforeEach(async () => {
      await pm.init();
    });

    it('emits profile-changed and page-changed on setActiveProfile', async () => {
      const newProfile = await pm.createProfile('Second');
      const profileCb = vi.fn();
      const pageCb = vi.fn();
      pm.on('profile-changed', profileCb);
      pm.on('page-changed', pageCb);

      await pm.setActiveProfile(newProfile.id);

      expect(profileCb).toHaveBeenCalledWith(newProfile.id);
      expect(pageCb).toHaveBeenCalledWith(newProfile.rootPageId);
    });

    it('does not emit events when setActiveProfile fails', async () => {
      const profileCb = vi.fn();
      pm.on('profile-changed', profileCb);

      await pm.setActiveProfile('non-existent-id');

      expect(profileCb).not.toHaveBeenCalled();
    });

    it('emits page-changed on navigateToPage', async () => {
      const profile = pm.getActiveProfile()!;
      // Create a second page
      const secondPageId = 'page-second';
      profile.pages[secondPageId] = { id: secondPageId, name: 'Second', bindings: {} };
      await pm.saveProfile(profile);

      const pageCb = vi.fn();
      pm.on('page-changed', pageCb);

      pm.navigateToPage(secondPageId);

      expect(pageCb).toHaveBeenCalledWith(secondPageId);
    });

    it('emits page-changed on navigateBack', async () => {
      const profile = pm.getActiveProfile()!;
      const secondPageId = 'page-second';
      profile.pages[secondPageId] = { id: secondPageId, name: 'Second', bindings: {} };
      await pm.saveProfile(profile);

      // Navigate forward first
      pm.navigateToPage(secondPageId);

      const pageCb = vi.fn();
      pm.on('page-changed', pageCb);

      pm.navigateBack();

      expect(pageCb).toHaveBeenCalledWith(profile.rootPageId);
    });

    it('emits page-changed on navigateToRoot', async () => {
      const profile = pm.getActiveProfile()!;
      const secondPageId = 'page-second';
      profile.pages[secondPageId] = { id: secondPageId, name: 'Second', bindings: {} };
      await pm.saveProfile(profile);

      pm.navigateToPage(secondPageId);

      const pageCb = vi.fn();
      pm.on('page-changed', pageCb);

      pm.navigateToRoot();

      expect(pageCb).toHaveBeenCalledWith(profile.rootPageId);
    });
  });
});
