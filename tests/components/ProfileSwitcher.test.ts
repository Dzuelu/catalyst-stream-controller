import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ProfileSwitcher from '../../src/renderer/components/ProfileSwitcher.svelte';
import { profiles, activeProfileId } from '../../src/renderer/stores/profile';
import { mockOSCApi } from '../setup-renderer';
import type { Profile } from '../../src/shared/types';

const testProfiles: Profile[] = [
  {
    id: 'p1',
    name: 'Default',
    rootPageId: 'root1',
    pages: { root1: { id: 'root1', name: 'Root', bindings: {} } }
  },
  {
    id: 'p2',
    name: 'Gaming',
    rootPageId: 'root2',
    pages: { root2: { id: 'root2', name: 'Root', bindings: {} } }
  }
];

describe('ProfileSwitcher', () => {
  beforeEach(() => {
    profiles.set(testProfiles);
    activeProfileId.set('p1');
  });

  // ─── Trigger button ──────────────────────────────────────

  describe('trigger button', () => {
    it('should show active profile name', () => {
      render(ProfileSwitcher);
      expect(screen.getByText('Default')).toBeInTheDocument();
    });

    it('should show Profile label', () => {
      render(ProfileSwitcher);
      expect(screen.getByText('Profile:')).toBeInTheDocument();
    });

    it('should show — when no active profile', () => {
      profiles.set([]);
      activeProfileId.set('nonexistent');
      render(ProfileSwitcher);
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  // ─── Dropdown ────────────────────────────────────────────

  describe('dropdown', () => {
    it('should open profile list on click', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      // Should see profiles listed
      expect(screen.getByText('Gaming')).toBeInTheDocument();
    });

    it('should show active profile indicator', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      expect(screen.getByText('●')).toBeInTheDocument();
    });

    it('should show New and Import buttons', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      expect(screen.getByText('New')).toBeInTheDocument();
      expect(screen.getByText('Import')).toBeInTheDocument();
    });

    it('should show App Switching button', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      expect(screen.getByText('App Switching…')).toBeInTheDocument();
    });

    it('should show create input when New clicked', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      await fireEvent.click(screen.getByText('New'));
      expect(screen.getByPlaceholderText('Profile name…')).toBeInTheDocument();
      expect(screen.getByText('Create')).toBeInTheDocument();
    });

    it('should call importProfile when Import clicked', async () => {
      vi.mocked(mockOSCApi.importProfile).mockResolvedValue({ success: false, imported: [] });
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      await fireEvent.click(screen.getByText('Import'));
      expect(mockOSCApi.importProfile).toHaveBeenCalled();
    });

    it('should show delete button when multiple profiles exist', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      // Should have delete buttons for profiles
      const deleteButtons = screen.getAllByTitle('Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it('should show export button for profiles', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      const exportButtons = screen.getAllByTitle('Export');
      expect(exportButtons.length).toBeGreaterThan(0);
    });

    it('should show rename button for profiles', async () => {
      render(ProfileSwitcher);
      await fireEvent.click(screen.getByText('Default'));
      const renameButtons = screen.getAllByTitle('Rename');
      expect(renameButtons.length).toBeGreaterThan(0);
    });
  });
});
