import { exec } from 'node:child_process';
import type { ActionConfig, CommandConfig, HotkeyConfig, LaunchConfig, MultimediaConfig } from '../../shared/types';
import type { PluginRegistry } from '../plugins/PluginRegistry';

/**
 * Executes actions bound to device buttons.
 *
 * Hotkeys are simulated via OS-level tools:
 *   - macOS: AppleScript `System Events` keystroke
 *   - Windows: PowerShell `[System.Windows.Forms.SendKeys]`
 *   - Linux: xdotool
 *
 * App launches use the platform's native open command.
 * Multimedia keys are sent as system-level media key events.
 * OBS and other plugin actions are delegated through the PluginRegistry.
 */
export class ActionExecutor {
  private platform = process.platform;
  private pluginRegistry: PluginRegistry | null = null;

  /** Set the plugin registry reference (called once during app init) */
  setPluginRegistry(registry: PluginRegistry): void {
    this.pluginRegistry = registry;
  }

  async execute(action: ActionConfig, buttonIndex?: number): Promise<void> {
    const tag = action.label ? ` "${action.label}"` : '';
    switch (action.type) {
      case 'hotkey': {
        const cfg = action.config as unknown as HotkeyConfig;
        // Backward compat: old single-key configs have key/modifiers at top level
        const steps = cfg.steps ?? [
          {
            key: (action.config as Record<string, unknown>).key as string,
            modifiers: ((action.config as Record<string, unknown>).modifiers as string[]) ?? []
          }
        ];
        const desc = steps.map((s) => [...s.modifiers, s.key].join('+')).join(', ');
        console.log(`[ActionExecutor] Keystroke: ${desc}${tag}`);
        await this.executeHotkey({ steps });
        break;
      }
      case 'launch': {
        const cfg = action.config as unknown as LaunchConfig;
        console.log(`[ActionExecutor] Launch: ${cfg.path}${tag}`);
        await this.executeLaunch(cfg);
        break;
      }
      case 'command': {
        const cfg = action.config as unknown as CommandConfig;
        console.log(`[ActionExecutor] Command: ${cfg.command}${tag}`);
        await this.executeShellCommand(cfg);
        break;
      }
      case 'multimedia': {
        const cfg = action.config as unknown as MultimediaConfig;
        console.log(`[ActionExecutor] Multimedia: ${cfg.action}${tag}`);
        await this.executeMultimedia(cfg);
        break;
      }
      case 'go-to-page':
      case 'go-to-back':
      case 'multi-action':
      case 'switch-profile':
      case 'set-brightness':
        // Handled directly in index.ts (not via ActionExecutor)
        break;
      case 'none':
        break;
      default: {
        // Check for plugin action types (e.g. 'plugin:obs')
        const actionType = action.type as string;
        if (actionType.startsWith('plugin:')) {
          const pluginId = actionType.slice(7);
          if (this.pluginRegistry) {
            const plugin = this.pluginRegistry.getPlugin(pluginId);
            if (plugin) {
              console.log(
                `[ActionExecutor] Plugin (${pluginId}): ${JSON.stringify(action.config).substring(0, 100)}${tag}`
              );
              const pluginConfig =
                buttonIndex != null ? { ...action.config, _buttonIndex: buttonIndex } : action.config;
              await plugin.client.executeAction(pluginConfig);
            } else {
              console.warn(`[ActionExecutor] Plugin not found: ${pluginId}`);
            }
          } else {
            console.warn(`[ActionExecutor] Plugin registry not initialized`);
          }
        } else {
          console.warn(`[ActionExecutor] Unknown action type: ${action.type}`);
        }
      }
    }
  }

  // ─── Hotkey ─────────────────────────────────────────────────

  private async executeHotkey(config: HotkeyConfig): Promise<void> {
    if (!config.steps || config.steps.length === 0) {
      console.warn('[ActionExecutor] Keystroke action has no steps configured');
      return;
    }

    for (let i = 0; i < config.steps.length; i++) {
      const step = config.steps[i];
      if (!step.key) continue;
      if (this.platform === 'darwin') {
        await this.macOSKeystroke(step.key, step.modifiers ?? []);
      } else if (this.platform === 'win32') {
        await this.windowsKeystroke(step.key, step.modifiers ?? []);
      } else {
        await this.linuxKeystroke(step.key, step.modifiers ?? []);
      }
      // Small delay between steps to ensure OS processes each keystroke
      if (i < config.steps.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
  }

  /**
   * macOS: Use AppleScript to send keystrokes via System Events.
   * This works regardless of which window is focused.
   */
  private macOSKeystroke(key: string, modifiers: string[]): Promise<void> {
    // Map our modifier names to AppleScript modifier names
    const modMap: Record<string, string> = {
      ctrl: 'control down',
      control: 'control down',
      alt: 'option down',
      option: 'option down',
      shift: 'shift down',
      meta: 'command down',
      cmd: 'command down',
      command: 'command down'
    };

    const osaModifiers = modifiers.map((m) => modMap[m.toLowerCase()]).filter(Boolean);

    // AppleScript: special keys use "key code", regular chars use "keystroke"
    const specialKeys: Record<string, number> = {
      return: 36,
      enter: 36,
      tab: 48,
      space: 49,
      delete: 51,
      backspace: 51,
      escape: 53,
      esc: 53,
      left: 123,
      right: 124,
      down: 125,
      up: 126,
      f1: 122,
      f2: 120,
      f3: 99,
      f4: 118,
      f5: 96,
      f6: 97,
      f7: 98,
      f8: 100,
      f9: 101,
      f10: 109,
      f11: 103,
      f12: 111
    };

    const keyLower = key.toLowerCase();
    let script: string;

    if (specialKeys[keyLower] !== undefined) {
      const keyCode = specialKeys[keyLower];
      const modStr = osaModifiers.length > 0 ? ` using {${osaModifiers.join(', ')}}` : '';
      script = `tell application "System Events" to key code ${keyCode}${modStr}`;
    } else {
      const modStr = osaModifiers.length > 0 ? ` using {${osaModifiers.join(', ')}}` : '';
      script = `tell application "System Events" to keystroke "${key}"${modStr}`;
    }

    return this.runCommand(`osascript -e '${script}'`);
  }

  /**
   * Linux: Use xdotool to simulate keystrokes.
   */
  private linuxKeystroke(key: string, modifiers: string[]): Promise<void> {
    // Map our modifier names to xdotool names
    const modMap: Record<string, string> = {
      ctrl: 'ctrl',
      control: 'ctrl',
      alt: 'alt',
      shift: 'shift',
      meta: 'super',
      cmd: 'super',
      command: 'super'
    };

    const xdoModifiers = modifiers.map((m) => modMap[m.toLowerCase()]).filter(Boolean);

    // Build xdotool key combo string: "ctrl+shift+p"
    const combo = [...xdoModifiers, key].join('+');
    return this.runCommand(`xdotool key ${combo}`);
  }

  /**
   * Windows: Use PowerShell and .NET SendKeys to simulate keystrokes.
   */
  private windowsKeystroke(key: string, modifiers: string[]): Promise<void> {
    // Map our modifier names to SendKeys modifier prefixes
    const modMap: Record<string, string> = {
      ctrl: '^',
      control: '^',
      alt: '%',
      shift: '+',
      meta: '^{ESC}', // Win key — SendKeys can't send it directly; use Ctrl+Esc as proxy
      cmd: '^{ESC}',
      command: '^{ESC}'
    };

    // Map special key names to SendKeys tokens
    const specialKeys: Record<string, string> = {
      return: '{ENTER}',
      enter: '{ENTER}',
      tab: '{TAB}',
      space: ' ',
      delete: '{DELETE}',
      backspace: '{BACKSPACE}',
      escape: '{ESC}',
      esc: '{ESC}',
      left: '{LEFT}',
      right: '{RIGHT}',
      down: '{DOWN}',
      up: '{UP}',
      f1: '{F1}',
      f2: '{F2}',
      f3: '{F3}',
      f4: '{F4}',
      f5: '{F5}',
      f6: '{F6}',
      f7: '{F7}',
      f8: '{F8}',
      f9: '{F9}',
      f10: '{F10}',
      f11: '{F11}',
      f12: '{F12}'
    };

    const keyLower = key.toLowerCase();
    const sendKey = specialKeys[keyLower] ?? key;

    // Check if any modifier is Win/meta — if so, fall back to a PowerShell key combo approach
    const hasWinKey = modifiers.some((m) => ['meta', 'cmd', 'command'].includes(m.toLowerCase()));
    const nonMetaMods = modifiers.filter((m) => !['meta', 'cmd', 'command'].includes(m.toLowerCase()));

    if (hasWinKey) {
      // Use WScript.Shell SendKeys for Win-key combos
      // Prefix with ^{ESC} won't work well — use a C# interop approach instead
      const modPrefix = nonMetaMods.map((m) => modMap[m.toLowerCase()] ?? '').join('');

      // Build a readable PowerShell script that:
      //   1. Imports user32.dll keybd_event via C# interop
      //   2. Holds the Windows key (VK 0x5B) down
      //   3. Sends the remaining keystrokes via SendKeys
      //   4. Releases the Windows key
      const psStatements = [
        'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class KBD { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }\'',
        '$KEYEVENTF_KEYUP = 0x0002',
        '[KBD]::keybd_event(0x5B, 0, 0, [UIntPtr]::Zero)',
        'Start-Sleep -Milliseconds 30',
        'Add-Type -AssemblyName System.Windows.Forms',
        `[System.Windows.Forms.SendKeys]::SendWait('${modPrefix}${sendKey}')`,
        'Start-Sleep -Milliseconds 30',
        '[KBD]::keybd_event(0x5B, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)'
      ];
      const script = `powershell -NoProfile -NonInteractive -Command "${psStatements.join('; ')}"`;
      return this.runCommand(script);
    }

    // Standard SendKeys with modifier prefixes
    const modPrefix = modifiers.map((m) => modMap[m.toLowerCase()] ?? '').join('');
    const combo = `${modPrefix}${sendKey}`;

    const script =
      `powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${combo}')"`.trim();
    return this.runCommand(script);
  }

  // ─── Launch ─────────────────────────────────────────────────

  private async executeLaunch(config: LaunchConfig): Promise<void> {
    if (!config.path) {
      console.warn('[ActionExecutor] Launch action has no path configured');
      return;
    }

    const args = config.args?.join(' ') ?? '';

    if (this.platform === 'darwin') {
      // macOS: use 'open' for .app bundles, direct exec for everything else
      if (config.path.endsWith('.app')) {
        await this.runCommand(`open -a "${config.path}" ${args}`);
      } else {
        await this.runCommand(`open "${config.path}" ${args}`);
      }
    } else if (this.platform === 'win32') {
      // Windows: use Start-Process for robust launching with args
      const argStr = config.args?.length ? ` -ArgumentList '${config.args.join("' '")}'` : '';
      await this.runCommand(
        `powershell -NoProfile -NonInteractive -Command "Start-Process -FilePath '${config.path}'${argStr}"`
      );
    } else {
      // Linux: use xdg-open or direct exec
      await this.runCommand(`"${config.path}" ${args}`);
    }
  }

  // ─── Shell Command ──────────────────────────────────────────

  private async executeShellCommand(config: CommandConfig): Promise<void> {
    if (!config.command) {
      console.warn('[ActionExecutor] Command action has no command configured');
      return;
    }

    await this.runCommand(config.command);
  }

  // ─── Multimedia ─────────────────────────────────────────────

  private async executeMultimedia(config: MultimediaConfig): Promise<void> {
    if (this.platform === 'darwin') {
      await this.macOSMediaKey(config.action);
    } else if (this.platform === 'win32') {
      await this.windowsMediaKey(config.action);
    } else {
      await this.linuxMediaKey(config.action);
    }
  }

  /**
   * macOS: Simulate media keys via AppleScript key codes.
   * NX_KEYTYPE values sent through CGEventPost are complex,
   * so we use the simpler osascript approach with HID key codes.
   */
  private macOSMediaKey(action: string): Promise<void> {
    // Media key codes (NX_KEYTYPE mapped to key codes used with System Events)
    const mediaScripts: Record<string, string> = {
      'play-pause': 'tell application "System Events" to key code 100 using {command down, shift down}',
      next: 'tell application "System Events" to key code 101 using {command down, shift down}',
      prev: 'tell application "System Events" to key code 98 using {command down, shift down}',
      'volume-up': 'set volume output volume ((output volume of (get volume settings)) + 6.25)',
      'volume-down': 'set volume output volume ((output volume of (get volume settings)) - 6.25)',
      mute: 'set volume with output muted'
    };

    const script = mediaScripts[action];
    if (!script) {
      console.warn(`[ActionExecutor] Unknown multimedia action: ${action}`);
      return Promise.resolve();
    }

    return this.runCommand(`osascript -e '${script}'`);
  }

  /**
   * Windows: Use PowerShell/C# interop to simulate media key presses
   * via user32.dll keybd_event with virtual-key codes for media keys.
   */
  private windowsMediaKey(action: string): Promise<void> {
    // Virtual-key codes for media keys
    const vkMap: Record<string, string> = {
      'play-pause': '0xB3', // VK_MEDIA_PLAY_PAUSE
      next: '0xB0', // VK_MEDIA_NEXT_TRACK
      prev: '0xB1', // VK_MEDIA_PREV_TRACK
      'volume-up': '0xAF', // VK_VOLUME_UP
      'volume-down': '0xAE', // VK_VOLUME_DOWN
      mute: '0xAD' // VK_VOLUME_MUTE
    };

    const vk = vkMap[action];
    if (!vk) {
      console.warn(`[ActionExecutor] Unknown multimedia action: ${action}`);
      return Promise.resolve();
    }

    // keybd_event: press then release via C# interop
    const psStatements = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class KBD { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo); }\'',
      `[KBD]::keybd_event(${vk}, 0, 0, [UIntPtr]::Zero)`,
      `[KBD]::keybd_event(${vk}, 0, 0x0002, [UIntPtr]::Zero)`
    ];
    const script = `powershell -NoProfile -NonInteractive -Command "${psStatements.join('; ')}"`;
    return this.runCommand(script);
  }

  /**
   * Linux: Use xdotool to send XF86 media key events.
   */
  private linuxMediaKey(action: string): Promise<void> {
    const keyMap: Record<string, string> = {
      'play-pause': 'XF86AudioPlay',
      next: 'XF86AudioNext',
      prev: 'XF86AudioPrev',
      'volume-up': 'XF86AudioRaiseVolume',
      'volume-down': 'XF86AudioLowerVolume',
      mute: 'XF86AudioMute'
    };

    const xKey = keyMap[action];
    if (!xKey) {
      console.warn(`[ActionExecutor] Unknown multimedia action: ${action}`);
      return Promise.resolve();
    }

    return this.runCommand(`xdotool key ${xKey}`);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private runCommand(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(command, (error, _stdout, stderr) => {
        if (error) {
          console.error(`[ActionExecutor] Command failed: ${command}`, error.message);
          reject(error);
        } else {
          if (stderr) {
            console.warn(`[ActionExecutor] stderr: ${stderr}`);
          }
          resolve();
        }
      });
    });
  }
}
