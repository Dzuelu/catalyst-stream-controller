import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PageBar from '../../src/renderer/components/PageBar.svelte';
import { profiles, activeProfileId, currentPageId, breadcrumbs } from '../../src/renderer/stores/profile';
import type { Profile } from '../../src/shared/types';

// Build a test profile with multiple pages
const testProfile: Profile = {
  id: 'profile-1',
  name: 'Test Profile',
  rootPageId: 'page-root',
  pages: {
    'page-root': { id: 'page-root', name: 'Root', bindings: {} },
    'page-sub': { id: 'page-sub', name: 'Sub Page', bindings: {} },
    'page-sub2': { id: 'page-sub2', name: 'Another Page', bindings: {} }
  }
};

describe('PageBar', () => {
  beforeEach(() => {
    // Set up stores with test data
    profiles.set([testProfile]);
    activeProfileId.set('profile-1');
    currentPageId.set('page-root');
    breadcrumbs.set([{ pageId: 'page-root', pageName: 'Root' }]);
  });

  // ─── Breadcrumbs ─────────────────────────────────────────

  describe('breadcrumbs', () => {
    it('should show root page name in breadcrumb', () => {
      render(PageBar);
      expect(screen.getByText('Root')).toBeInTheDocument();
    });

    it('should show multi-level breadcrumbs', () => {
      breadcrumbs.set([
        { pageId: 'page-root', pageName: 'Root' },
        { pageId: 'page-sub', pageName: 'Sub Page' }
      ]);
      currentPageId.set('page-sub');
      render(PageBar);
      expect(screen.getByText('Root')).toBeInTheDocument();
      expect(screen.getByText('Sub Page')).toBeInTheDocument();
      expect(screen.getByText('›')).toBeInTheDocument();
    });

    it('should highlight current page in breadcrumb', () => {
      render(PageBar);
      const rootText = screen.getByText('Root');
      // Current page should be a span (not a button)
      expect(rootText.tagName).toBe('SPAN');
      expect(rootText.className).toContain('font-medium');
    });
  });

  // ─── Back button ─────────────────────────────────────────

  describe('back button', () => {
    it('should not show back button on root page', () => {
      render(PageBar);
      expect(screen.queryByText('← Back')).not.toBeInTheDocument();
    });

    it('should show back button on sub page', () => {
      currentPageId.set('page-sub');
      breadcrumbs.set([
        { pageId: 'page-root', pageName: 'Root' },
        { pageId: 'page-sub', pageName: 'Sub Page' }
      ]);
      render(PageBar);
      expect(screen.getByText('← Back')).toBeInTheDocument();
    });
  });

  // ─── Pages menu ──────────────────────────────────────────

  describe('pages menu', () => {
    it('should show pages count button', () => {
      render(PageBar);
      expect(screen.getByText('Pages (3)')).toBeInTheDocument();
    });

    it('should open page list on button click', async () => {
      render(PageBar);
      await fireEvent.click(screen.getByText('Pages (3)'));
      // Should see all pages listed
      expect(screen.getByText('Sub Page')).toBeInTheDocument();
      expect(screen.getByText('Another Page')).toBeInTheDocument();
    });

    it('should show root page indicator', async () => {
      render(PageBar);
      await fireEvent.click(screen.getByText('Pages (3)'));
      expect(screen.getByText('(root)')).toBeInTheDocument();
    });

    it('should show current page dot indicator', async () => {
      render(PageBar);
      await fireEvent.click(screen.getByText('Pages (3)'));
      expect(screen.getByText('●')).toBeInTheDocument();
    });

    it('should show new page button in dropdown', async () => {
      render(PageBar);
      await fireEvent.click(screen.getByText('Pages (3)'));
      expect(screen.getByText('New Page')).toBeInTheDocument();
    });

    it('should show create input when New Page clicked', async () => {
      render(PageBar);
      await fireEvent.click(screen.getByText('Pages (3)'));
      await fireEvent.click(screen.getByText('New Page'));
      expect(screen.getByPlaceholderText('Page name…')).toBeInTheDocument();
      expect(screen.getByText('Add')).toBeInTheDocument();
    });
  });
});
