import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionExecutor } from '../../../src/main/actions/ActionExecutor';
import { exec } from '../../mocks/child_process';
import { resetExecMocks, setExecResult, setExecError } from '../../mocks/child_process';
import {
  hotkeyAction,
  multiStepHotkeyAction,
  launchAction,
  commandAction,
  multimediaPlayPause,
  multimediaVolumeUp,
  goToPageAction,
  goBackAction,
  switchProfileAction,
  setBrightnessAction,
  noneAction,
  multiAction
} from '../../fixtures/actions';

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    executor = new ActionExecutor();
    resetExecMocks();
    // Default: all commands succeed
    setExecResult('', '');
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  });

  afterEach(() => {
    // Restore platform
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  // ─── Utility ──────────────────────────────────────────────
  function setPlatform(platform: string): void {
    Object.defineProperty(process, 'platform', { value: platform, writable: true, configurable: true });
  }

  /** Create a new ActionExecutor with the given platform baked in */
  function createExecutorForPlatform(platform: string): ActionExecutor {
    setPlatform(platform);
    return new ActionExecutor();
  }

  // ─── Hotkey Actions ───────────────────────────────────────

  describe('hotkey actions', () => {
    it('should execute a single-step hotkey on macOS via osascript', async () => {
      const darwinExecutor = createExecutorForPlatform('darwin');
      await darwinExecutor.execute(hotkeyAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('osascript');
      expect(command).toContain('keystroke');
      expect(command).toContain('"c"');
      expect(command).toContain('command down');
    });

    it('should execute a single-step hotkey on Linux via xdotool', async () => {
      const linuxExecutor = createExecutorForPlatform('linux');
      await linuxExecutor.execute(hotkeyAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('xdotool key');
      expect(command).toContain('super+c');
    });

    it('should execute a single-step hotkey on Windows via PowerShell SendKeys', async () => {
      const winExecutor = createExecutorForPlatform('win32');
      await winExecutor.execute(hotkeyAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('powershell');
      expect(command).toContain('SendKeys');
    });

    it('should handle special keys (escape) on Windows via SendKeys', async () => {
      const winExecutor = createExecutorForPlatform('win32');
      const escAction = {
        id: 'test-esc',
        type: 'hotkey' as const,
        label: 'Escape',
        config: { steps: [{ key: 'escape', modifiers: [] }] }
      };
      await winExecutor.execute(escAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('{ESC}');
    });

    it('should execute a multi-step hotkey with delays between steps', async () => {
      const darwinExecutor = createExecutorForPlatform('darwin');
      await darwinExecutor.execute(multiStepHotkeyAction);

      // Two steps → two exec calls
      expect(exec).toHaveBeenCalledTimes(2);
      const cmd1 = exec.mock.calls[0][0] as string;
      const cmd2 = exec.mock.calls[1][0] as string;
      expect(cmd1).toContain('keystroke');
      expect(cmd2).toContain('keystroke');
    });

    it('should handle special keys (return, escape, F-keys) on macOS via key code', async () => {
      const darwinExecutor = createExecutorForPlatform('darwin');
      const escAction = {
        id: 'test-esc',
        type: 'hotkey' as const,
        label: 'Escape',
        config: { steps: [{ key: 'escape', modifiers: [] }] }
      };
      await darwinExecutor.execute(escAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('key code 53');
    });

    it('should warn and skip steps with no key', async () => {
      const emptyStepsAction = {
        id: 'test-empty',
        type: 'hotkey' as const,
        label: 'No Steps',
        config: { steps: [] }
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await executor.execute(emptyStepsAction);
      expect(exec).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no steps'));
      warnSpy.mockRestore();
    });
  });

  // ─── Launch Actions ───────────────────────────────────────

  describe('launch actions', () => {
    it('should launch a .app on macOS using open -a', async () => {
      const darwinExecutor = createExecutorForPlatform('darwin');
      await darwinExecutor.execute(launchAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('open');
      expect(command).toContain('/Applications/Firefox.app');
      expect(command).toContain('--private-window');
    });

    it('should launch directly on Linux', async () => {
      const linuxExecutor = createExecutorForPlatform('linux');
      await linuxExecutor.execute(launchAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('/Applications/Firefox.app');
      expect(command).toContain('--private-window');
    });

    it('should launch on Windows using Start-Process', async () => {
      const winExecutor = createExecutorForPlatform('win32');
      await winExecutor.execute(launchAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('powershell');
      expect(command).toContain('Start-Process');
      expect(command).toContain('/Applications/Firefox.app');
    });

    it('should warn when no path is configured', async () => {
      const noPathAction = {
        id: 'test-nopath',
        type: 'launch' as const,
        label: 'No Path',
        config: { path: '' }
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await executor.execute(noPathAction);
      expect(exec).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no path'));
      warnSpy.mockRestore();
    });
  });

  // ─── Command Actions ──────────────────────────────────────

  describe('command actions', () => {
    it('should execute a shell command directly', async () => {
      await executor.execute(commandAction);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toBe('ls -la /tmp');
    });

    it('should warn when no command is configured', async () => {
      const noCmd = {
        id: 'test-nocmd',
        type: 'command' as const,
        label: 'Empty',
        config: { command: '' }
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await executor.execute(noCmd);
      expect(exec).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no command'));
      warnSpy.mockRestore();
    });

    it('should reject when exec fails', async () => {
      resetExecMocks();
      setExecError('ls', new Error('command not found'));

      await expect(executor.execute(commandAction)).rejects.toThrow('command not found');
    });
  });

  // ─── Multimedia Actions ───────────────────────────────────

  describe('multimedia actions', () => {
    it('should execute play-pause on macOS via osascript', async () => {
      const darwinExecutor = createExecutorForPlatform('darwin');
      await darwinExecutor.execute(multimediaPlayPause);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('osascript');
    });

    it('should execute volume-up on Linux via xdotool XF86 key', async () => {
      const linuxExecutor = createExecutorForPlatform('linux');
      await linuxExecutor.execute(multimediaVolumeUp);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('xdotool key');
      expect(command).toContain('XF86AudioRaiseVolume');
    });

    it('should execute play-pause on Windows via PowerShell keybd_event', async () => {
      const winExecutor = createExecutorForPlatform('win32');
      await winExecutor.execute(multimediaPlayPause);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('powershell');
      expect(command).toContain('keybd_event');
      // VK_MEDIA_PLAY_PAUSE = 0xB3
      expect(command).toContain('0xB3');
    });

    it('should execute volume-up on Windows via PowerShell keybd_event', async () => {
      const winExecutor = createExecutorForPlatform('win32');
      await winExecutor.execute(multimediaVolumeUp);

      expect(exec).toHaveBeenCalledTimes(1);
      const command = exec.mock.calls[0][0] as string;
      expect(command).toContain('powershell');
      expect(command).toContain('keybd_event');
      // VK_VOLUME_UP = 0xAF
      expect(command).toContain('0xAF');
    });

    it('should handle unknown multimedia action on Windows', async () => {
      const winExecutor = createExecutorForPlatform('win32');
      const unknownMedia = {
        id: 'test-unknown-media-win',
        type: 'multimedia' as const,
        label: 'Unknown',
        config: { action: 'fast-forward' }
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await winExecutor.execute(unknownMedia);
      expect(exec).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown multimedia'));
      warnSpy.mockRestore();
    });
  });

  // ─── No-op Actions (handled in index.ts) ──────────────────

  describe('no-op actions (handled in index.ts)', () => {
    it.each([
      ['go-to-page', goToPageAction],
      ['go-to-back', goBackAction],
      ['multi-action', multiAction],
      ['switch-profile', switchProfileAction],
      ['set-brightness', setBrightnessAction],
      ['none', noneAction]
    ])('should silently skip %s action', async (_name, action) => {
      await executor.execute(action);
      // None of these should call exec or cause errors
      expect(exec).not.toHaveBeenCalled();
    });
  });

  // ─── Unknown Action Types ─────────────────────────────────

  describe('unknown action types', () => {
    it('should warn on unknown action type', async () => {
      const unknownAction = {
        id: 'test-unknown',
        type: 'teleport' as 'none',
        label: 'Teleport',
        config: {}
      };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await executor.execute(unknownAction);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown action type'));
      warnSpy.mockRestore();
    });
  });
});
