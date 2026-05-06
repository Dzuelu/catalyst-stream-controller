/**
 * Built-in icon packs for button customisation.
 *
 * Each icon is a minimal SVG string (viewBox 0 0 96 96, stroke-based, white on transparent).
 * They are converted to data-URIs on the fly so they integrate seamlessly with the existing
 * ButtonAppearance pipeline which stores icons as `data:image/svg+xml;...`.
 */

// ─── Types ──────────────────────────────────────────────────

export interface IconDefinition {
  /** Unique id within the pack (e.g. 'play') */
  id: string;
  /** Human-readable label */
  label: string;
  /** Raw SVG markup (96×96 viewBox, white strokes) */
  svg: string;
}

export interface IconPack {
  id: string;
  label: string;
  icons: IconDefinition[];
}

// ─── Helpers ────────────────────────────────────────────────

/** Wrap a body in a standard 96×96 SVG shell */
const s = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Like `s` but with fill=white, no stroke (for solid shapes) */
const sf = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="white" stroke="none">${body}</svg>`;

/** Convert raw SVG string to a data URI */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ─── Media ──────────────────────────────────────────────────

const mediaPack: IconPack = {
  id: 'media',
  label: 'Media',
  icons: [
    {
      id: 'play',
      label: 'Play',
      svg: sf('<polygon points="34,22 34,74 74,48"/>')
    },
    {
      id: 'pause',
      label: 'Pause',
      svg: s('<line x1="36" y1="24" x2="36" y2="72"/><line x1="60" y1="24" x2="60" y2="72"/>')
    },
    {
      id: 'stop',
      label: 'Stop',
      svg: sf('<rect x="26" y="26" width="44" height="44" rx="3"/>')
    },
    {
      id: 'skip-forward',
      label: 'Skip Forward',
      svg: s('<polygon points="20,24 20,72 50,48" fill="white"/><polygon points="48,24 48,72 78,48" fill="white"/>')
    },
    {
      id: 'skip-back',
      label: 'Skip Back',
      svg: s('<polygon points="76,24 76,72 46,48" fill="white"/><polygon points="48,24 48,72 18,48" fill="white"/>')
    },
    {
      id: 'record',
      label: 'Record',
      svg: sf('<circle cx="48" cy="48" r="22"/>')
    },
    {
      id: 'microphone',
      label: 'Microphone',
      svg: s(
        '<rect x="36" y="20" width="24" height="36" rx="12" fill="white"/><path d="M28 52 a20 20 0 0 0 40 0"/><line x1="48" y1="72" x2="48" y2="80"/><line x1="36" y1="80" x2="60" y2="80"/>'
      )
    },
    {
      id: 'microphone-off',
      label: 'Mic Muted',
      svg: s(
        '<rect x="36" y="20" width="24" height="36" rx="12" fill="white"/><path d="M28 52 a20 20 0 0 0 40 0"/><line x1="48" y1="72" x2="48" y2="80"/><line x1="36" y1="80" x2="60" y2="80"/><line x1="20" y1="20" x2="76" y2="76" stroke="red" stroke-width="5"/>'
      )
    },
    {
      id: 'volume-up',
      label: 'Volume Up',
      svg: s(
        '<polygon points="22,36 22,60 36,60 52,74 52,22 36,36" fill="white"/><path d="M62 34 a18 18 0 0 1 0 28"/><path d="M68 24 a30 30 0 0 1 0 48"/>'
      )
    },
    {
      id: 'volume-down',
      label: 'Volume Down',
      svg: s('<polygon points="26,36 26,60 40,60 56,74 56,22 40,36" fill="white"/><path d="M66 34 a18 18 0 0 1 0 28"/>')
    },
    {
      id: 'volume-mute',
      label: 'Volume Mute',
      svg: s(
        '<polygon points="22,36 22,60 36,60 52,74 52,22 36,36" fill="white"/><line x1="64" y1="38" x2="80" y2="58"/><line x1="80" y1="38" x2="64" y2="58"/>'
      )
    },
    {
      id: 'headphones',
      label: 'Headphones',
      svg: s(
        '<path d="M20 52 V48 a28 28 0 0 1 56 0 V52"/><rect x="16" y="52" width="12" height="20" rx="4" fill="white"/><rect x="68" y="52" width="12" height="20" rx="4" fill="white"/>'
      )
    },
    {
      id: 'music',
      label: 'Music',
      svg: s(
        '<circle cx="32" cy="66" r="10" fill="white"/><circle cx="64" cy="58" r="10" fill="white"/><line x1="42" y1="66" x2="42" y2="24"/><line x1="74" y1="58" x2="74" y2="18"/><path d="M42 24 L74 18" stroke-width="6"/>'
      )
    },
    {
      id: 'camera',
      label: 'Camera',
      svg: s(
        '<rect x="14" y="30" width="68" height="44" rx="6" fill="white" stroke="white"/><circle cx="48" cy="52" r="14" fill="none" stroke="#1a1a2e" stroke-width="4"/><rect x="56" y="24" width="18" height="10" rx="2" fill="white"/>'
      )
    },
    {
      id: 'camera-off',
      label: 'Camera Off',
      svg: s(
        '<rect x="14" y="30" width="68" height="44" rx="6" fill="white" stroke="white"/><circle cx="48" cy="52" r="14" fill="none" stroke="#1a1a2e" stroke-width="4"/><rect x="56" y="24" width="18" height="10" rx="2" fill="white"/><line x1="16" y1="16" x2="80" y2="80" stroke="red" stroke-width="5"/>'
      )
    }
  ]
};

// ─── System / Tools ─────────────────────────────────────────

const systemPack: IconPack = {
  id: 'system',
  label: 'System',
  icons: [
    {
      id: 'gear',
      label: 'Settings',
      svg: s(
        '<circle cx="48" cy="48" r="14"/><path d="M48 16 v-0 M48 80 v-0 M16 48 h-0 M80 48 h-0 M25.4 25.4 l0 0 M70.6 70.6 l0 0 M70.6 25.4 l0 0 M25.4 70.6 l0 0" stroke-width="10"/>'
      )
    },
    {
      id: 'power',
      label: 'Power',
      svg: s('<path d="M34 28 a24 24 0 1 0 28 0"/><line x1="48" y1="18" x2="48" y2="48"/>')
    },
    {
      id: 'refresh',
      label: 'Refresh',
      svg: s(
        '<path d="M68 28 A28 28 0 0 0 22 42"/><polyline points="68,18 68,28 58,28" fill="none"/><path d="M28 68 A28 28 0 0 0 74 54"/><polyline points="28,78 28,68 38,68" fill="none"/>'
      )
    },
    {
      id: 'terminal',
      label: 'Terminal',
      svg: s(
        '<rect x="14" y="20" width="68" height="56" rx="6"/><polyline points="28,40 42,50 28,60"/><line x1="48" y1="60" x2="64" y2="60"/>'
      )
    },
    {
      id: 'folder',
      label: 'Folder',
      svg: s('<path d="M14 30 h20 l6 -8 h42 v48 H14z" fill="white"/>')
    },
    {
      id: 'save',
      label: 'Save',
      svg: s(
        '<path d="M22 16 h44 l14 14 v44 a4 4 0 0 1 -4 4 H22 a4 4 0 0 1 -4 -4 V20 a4 4 0 0 1 4 -4z" fill="white"/><rect x="34" y="16" width="24" height="20" rx="1" fill="#1a1a2e"/><rect x="30" y="52" width="36" height="22" rx="3" fill="#1a1a2e"/>'
      )
    },
    {
      id: 'clipboard',
      label: 'Clipboard',
      svg: s(
        '<rect x="22" y="24" width="52" height="56" rx="4" fill="white"/><rect x="36" y="18" width="24" height="12" rx="4" fill="white" stroke="#1a1a2e" stroke-width="3"/><line x1="34" y1="46" x2="62" y2="46" stroke="#1a1a2e" stroke-width="3"/><line x1="34" y1="56" x2="56" y2="56" stroke="#1a1a2e" stroke-width="3"/><line x1="34" y1="66" x2="50" y2="66" stroke="#1a1a2e" stroke-width="3"/>'
      )
    },
    {
      id: 'lock',
      label: 'Lock',
      svg: s(
        '<rect x="24" y="44" width="48" height="36" rx="6" fill="white"/><path d="M32 44 V34 a16 16 0 0 1 32 0 V44"/><circle cx="48" cy="60" r="5" fill="#1a1a2e" stroke="none"/>'
      )
    },
    {
      id: 'unlock',
      label: 'Unlock',
      svg: s(
        '<rect x="24" y="44" width="48" height="36" rx="6" fill="white"/><path d="M32 44 V34 a16 16 0 0 1 32 0"/><circle cx="48" cy="60" r="5" fill="#1a1a2e" stroke="none"/>'
      )
    },
    {
      id: 'bell',
      label: 'Notification',
      svg: s(
        '<path d="M36 72 a12 12 0 0 0 24 0"/><path d="M24 64 h48 L66 44 a18 18 0 0 0 -36 0 L24 64z" fill="white"/>'
      )
    },
    {
      id: 'clock',
      label: 'Clock',
      svg: s(
        '<circle cx="48" cy="48" r="30"/><line x1="48" y1="48" x2="48" y2="30"/><line x1="48" y1="48" x2="62" y2="54"/>'
      )
    },
    {
      id: 'timer',
      label: 'Timer',
      svg: s(
        '<circle cx="48" cy="52" r="26"/><line x1="48" y1="52" x2="48" y2="36"/><line x1="40" y1="18" x2="56" y2="18"/><line x1="48" y1="18" x2="48" y2="26"/><line x1="68" y1="30" x2="74" y2="24"/>'
      )
    },
    {
      id: 'wifi',
      label: 'WiFi',
      svg: s(
        '<circle cx="48" cy="72" r="4" fill="white" stroke="none"/><path d="M30 58 a24 24 0 0 1 36 0"/><path d="M18 46 a40 40 0 0 1 60 0"/><path d="M6 34 a56 56 0 0 1 84 0"/>'
      )
    },
    {
      id: 'bluetooth',
      label: 'Bluetooth',
      svg: s('<polyline points="34,32 62,56 48,68 48,28 62,40 34,64"/>')
    }
  ]
};

// ─── Navigation / Arrows ────────────────────────────────────

const navigationPack: IconPack = {
  id: 'navigation',
  label: 'Navigation',
  icons: [
    {
      id: 'arrow-up',
      label: 'Arrow Up',
      svg: s('<line x1="48" y1="76" x2="48" y2="20"/><polyline points="28,40 48,20 68,40"/>')
    },
    {
      id: 'arrow-down',
      label: 'Arrow Down',
      svg: s('<line x1="48" y1="20" x2="48" y2="76"/><polyline points="28,56 48,76 68,56"/>')
    },
    {
      id: 'arrow-left',
      label: 'Arrow Left',
      svg: s('<line x1="76" y1="48" x2="20" y2="48"/><polyline points="40,28 20,48 40,68"/>')
    },
    {
      id: 'arrow-right',
      label: 'Arrow Right',
      svg: s('<line x1="20" y1="48" x2="76" y2="48"/><polyline points="56,28 76,48 56,68"/>')
    },
    {
      id: 'chevron-up',
      label: 'Chevron Up',
      svg: s('<polyline points="24,60 48,36 72,60"/>')
    },
    {
      id: 'chevron-down',
      label: 'Chevron Down',
      svg: s('<polyline points="24,36 48,60 72,36"/>')
    },
    {
      id: 'chevron-left',
      label: 'Chevron Left',
      svg: s('<polyline points="60,24 36,48 60,72"/>')
    },
    {
      id: 'chevron-right',
      label: 'Chevron Right',
      svg: s('<polyline points="36,24 60,48 36,72"/>')
    },
    {
      id: 'home',
      label: 'Home',
      svg: s('<path d="M18 48 L48 22 L78 48"/><path d="M26 46 V76 H42 V58 H54 V76 H70 V46"/>')
    },
    {
      id: 'maximize',
      label: 'Maximize',
      svg: s('<rect x="20" y="20" width="56" height="56" rx="4"/>')
    },
    {
      id: 'minimize',
      label: 'Minimize',
      svg: s('<line x1="24" y1="48" x2="72" y2="48"/>')
    },
    {
      id: 'close',
      label: 'Close',
      svg: s('<line x1="24" y1="24" x2="72" y2="72"/><line x1="72" y1="24" x2="24" y2="72"/>')
    },
    {
      id: 'menu',
      label: 'Menu',
      svg: s(
        '<line x1="20" y1="30" x2="76" y2="30"/><line x1="20" y1="48" x2="76" y2="48"/><line x1="20" y1="66" x2="76" y2="66"/>'
      )
    },
    {
      id: 'grid',
      label: 'Grid',
      svg: s(
        '<rect x="18" y="18" width="22" height="22" rx="3" fill="white"/><rect x="56" y="18" width="22" height="22" rx="3" fill="white"/><rect x="18" y="56" width="22" height="22" rx="3" fill="white"/><rect x="56" y="56" width="22" height="22" rx="3" fill="white"/>'
      )
    }
  ]
};

// ─── General / Symbols ──────────────────────────────────────

const generalPack: IconPack = {
  id: 'general',
  label: 'General',
  icons: [
    {
      id: 'check',
      label: 'Checkmark',
      svg: s('<polyline points="24,50 40,66 72,30" stroke-width="6"/>')
    },
    {
      id: 'x-mark',
      label: 'X Mark',
      svg: s(
        '<line x1="26" y1="26" x2="70" y2="70" stroke-width="6"/><line x1="70" y1="26" x2="26" y2="70" stroke-width="6"/>'
      )
    },
    {
      id: 'plus',
      label: 'Plus',
      svg: s('<line x1="48" y1="20" x2="48" y2="76"/><line x1="20" y1="48" x2="76" y2="48"/>')
    },
    {
      id: 'minus',
      label: 'Minus',
      svg: s('<line x1="20" y1="48" x2="76" y2="48"/>')
    },
    {
      id: 'star',
      label: 'Star',
      svg: sf('<polygon points="48,14 57,38 82,38 62,54 70,78 48,64 26,78 34,54 14,38 39,38"/>')
    },
    {
      id: 'heart',
      label: 'Heart',
      svg: sf('<path d="M48 78 L20 50 A16 16 0 0 1 48 30 A16 16 0 0 1 76 50 Z"/>')
    },
    {
      id: 'lightning',
      label: 'Lightning',
      svg: sf('<polygon points="52,12 24,52 44,52 40,84 72,40 52,40"/>')
    },
    {
      id: 'fire',
      label: 'Fire',
      svg: s(
        '<path d="M48 14 C56 30 72 38 72 56 A24 24 0 0 1 24 56 C24 38 40 30 48 14Z" fill="white"/><path d="M48 82 A12 12 0 0 1 36 64 C36 56 48 48 48 48 C48 48 60 56 60 64 A12 12 0 0 1 48 82Z" fill="#1a1a2e"/>'
      )
    },
    {
      id: 'sun',
      label: 'Sun',
      svg: s(
        '<circle cx="48" cy="48" r="14" fill="white"/><line x1="48" y1="14" x2="48" y2="24"/><line x1="48" y1="72" x2="48" y2="82"/><line x1="14" y1="48" x2="24" y2="48"/><line x1="72" y1="48" x2="82" y2="48"/><line x1="24" y1="24" x2="31" y2="31"/><line x1="65" y1="65" x2="72" y2="72"/><line x1="72" y1="24" x2="65" y2="31"/><line x1="31" y1="65" x2="24" y2="72"/>'
      )
    },
    {
      id: 'moon',
      label: 'Moon',
      svg: sf('<path d="M56 18 A28 28 0 1 0 78 56 A22 22 0 0 1 56 18Z"/>')
    },
    {
      id: 'trash',
      label: 'Trash',
      svg: s(
        '<polyline points="24,28 72,28"/><line x1="40" y1="20" x2="56" y2="20"/><path d="M28 28 L32 78 H64 L68 28"/><line x1="40" y1="38" x2="40" y2="68"/><line x1="56" y1="38" x2="56" y2="68"/>'
      )
    },
    {
      id: 'edit',
      label: 'Edit',
      svg: s('<path d="M56 18 L78 40 L38 80 H16 V58 Z" fill="white"/><line x1="48" y1="26" x2="70" y2="48"/>')
    },
    {
      id: 'search',
      label: 'Search',
      svg: s('<circle cx="42" cy="42" r="20"/><line x1="56" y1="56" x2="76" y2="76" stroke-width="6"/>')
    },
    {
      id: 'info',
      label: 'Info',
      svg: s(
        '<circle cx="48" cy="48" r="28"/><line x1="48" y1="44" x2="48" y2="66" stroke-width="5"/><circle cx="48" cy="34" r="3" fill="white" stroke="none"/>'
      )
    },
    {
      id: 'warning',
      label: 'Warning',
      svg: s(
        '<polygon points="48,14 84,80 12,80" fill="white"/><line x1="48" y1="40" x2="48" y2="58" stroke="#1a1a2e" stroke-width="5"/><circle cx="48" cy="68" r="3" fill="#1a1a2e" stroke="none"/>'
      )
    },
    {
      id: 'circle-dot',
      label: 'Circle Dot',
      svg: s('<circle cx="48" cy="48" r="28"/><circle cx="48" cy="48" r="8" fill="white" stroke="none"/>')
    },
    {
      id: 'emoji-smile',
      label: 'Smile',
      svg: s(
        '<circle cx="48" cy="48" r="30"/><circle cx="38" cy="40" r="3" fill="white" stroke="none"/><circle cx="58" cy="40" r="3" fill="white" stroke="none"/><path d="M34 56 Q48 68 62 56"/>'
      )
    },
    {
      id: 'thumbs-up',
      label: 'Thumbs Up',
      svg: s(
        '<path d="M40 44 L40 20 A8 8 0 0 1 56 20 L56 36 H72 A6 6 0 0 1 72 48 A6 6 0 0 1 70 60 A6 6 0 0 1 66 72 H40" fill="white"/><rect x="18" y="44" width="22" height="32" rx="4" fill="white"/>'
      )
    }
  ]
};

// ─── Colors / Solid ─────────────────────────────────────────

const colorPack: IconPack = {
  id: 'colors',
  label: 'Colors',
  icons: [
    {
      id: 'circle-red',
      label: 'Red',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#ef4444"/></svg>`
    },
    {
      id: 'circle-orange',
      label: 'Orange',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#f97316"/></svg>`
    },
    {
      id: 'circle-yellow',
      label: 'Yellow',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#eab308"/></svg>`
    },
    {
      id: 'circle-green',
      label: 'Green',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#22c55e"/></svg>`
    },
    {
      id: 'circle-blue',
      label: 'Blue',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#3b82f6"/></svg>`
    },
    {
      id: 'circle-purple',
      label: 'Purple',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#a855f7"/></svg>`
    },
    {
      id: 'circle-pink',
      label: 'Pink',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="#ec4899"/></svg>`
    },
    {
      id: 'circle-white',
      label: 'White',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="36" fill="white"/></svg>`
    },
    {
      id: 'square-red',
      label: 'Red Square',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="14" y="14" width="68" height="68" rx="8" fill="#ef4444"/></svg>`
    },
    {
      id: 'square-green',
      label: 'Green Square',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="14" y="14" width="68" height="68" rx="8" fill="#22c55e"/></svg>`
    },
    {
      id: 'square-blue',
      label: 'Blue Square',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="14" y="14" width="68" height="68" rx="8" fill="#3b82f6"/></svg>`
    },
    {
      id: 'square-purple',
      label: 'Purple Square',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect x="14" y="14" width="68" height="68" rx="8" fill="#a855f7"/></svg>`
    }
  ]
};

// ─── Numbers / Letters ──────────────────────────────────────

function textIcon(char: string, label: string): IconDefinition {
  return {
    id: `char-${char.toLowerCase().replace(/\s/g, '-')}`,
    label,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><text x="48" y="64" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="52" fill="white">${char}</text></svg>`
  };
}

const numbersPack: IconPack = {
  id: 'numbers',
  label: 'Numbers',
  icons: [
    textIcon('0', 'Zero'),
    textIcon('1', 'One'),
    textIcon('2', 'Two'),
    textIcon('3', 'Three'),
    textIcon('4', 'Four'),
    textIcon('5', 'Five'),
    textIcon('6', 'Six'),
    textIcon('7', 'Seven'),
    textIcon('8', 'Eight'),
    textIcon('9', 'Nine'),
    textIcon('#', 'Hash'),
    textIcon('?', 'Question'),
    textIcon('!', 'Exclamation'),
    textIcon('F1', 'F1'),
    textIcon('F2', 'F2'),
    textIcon('F3', 'F3'),
    textIcon('F4', 'F4'),
    textIcon('F5', 'F5')
  ]
};

// ─── Export all packs ───────────────────────────────────────

import type { PluginIconPack } from '../../shared/plugin-types';

export const ICON_PACKS: IconPack[] = [mediaPack, systemPack, navigationPack, generalPack, colorPack, numbersPack];

/** Total icon count (useful for display) */
export const TOTAL_ICON_COUNT = ICON_PACKS.reduce((sum, p) => sum + p.icons.length, 0);

/**
 * Validate that every icon in a plugin's packs uses the correct namespace.
 *
 * Only icons whose IDs start with `plugin:{pluginId}:` are kept.
 * Mis-namespaced icons (e.g. a plugin with id 'obs' trying to register
 * 'plugin:discord:foo') are silently dropped.
 */
export function validatePluginIconPacks(pluginId: string, packs: PluginIconPack[]): PluginIconPack[] {
  const prefix = `plugin:${pluginId}:`;
  return packs
    .map((pack) => ({
      ...pack,
      icons: pack.icons.filter((icon) => icon.id.startsWith(prefix))
    }))
    .filter((pack) => pack.icons.length > 0);
}

/**
 * Merge plugin icon packs into the built-in packs.
 *
 * Packs are matched by **label** — if a plugin pack's label matches an
 * existing built-in tab (e.g. `'Media'`), its icons are appended.
 * Otherwise a new tab is created. Icon ID collisions are silently
 * skipped (built-in icons always win).
 */
export function mergeIconPacks(pluginPacks: PluginIconPack[]): IconPack[] {
  const result = new Map<string, IconPack>();
  // Seed with copies of the built-in packs (keyed by label)
  for (const pack of ICON_PACKS) {
    result.set(pack.label, { ...pack, icons: [...pack.icons] });
  }
  // Collect all existing icon IDs to prevent overwrites
  const existingIds = new Set<string>(ICON_PACKS.flatMap((p) => p.icons.map((i) => i.id)));

  for (const pluginPack of pluginPacks) {
    const existing = result.get(pluginPack.label);
    if (existing) {
      // Extend an existing pack — only add icons with unique IDs
      for (const icon of pluginPack.icons) {
        if (!existingIds.has(icon.id)) {
          existing.icons.push(icon);
          existingIds.add(icon.id);
        }
      }
    } else {
      // Create a new tab — filter out any ID collisions
      const uniqueIcons = pluginPack.icons.filter((icon) => {
        if (existingIds.has(icon.id)) return false;
        existingIds.add(icon.id);
        return true;
      });
      result.set(pluginPack.label, {
        id: pluginPack.label.toLowerCase().replace(/\s+/g, '-'),
        label: pluginPack.label,
        icons: uniqueIcons
      });
    }
  }
  return Array.from(result.values());
}

/** Look up an icon's raw SVG by id (searches all packs). Returns null if not found. */
export function getIconSvg(iconId: string): string | null {
  for (const pack of ICON_PACKS) {
    const icon = pack.icons.find((i) => i.id === iconId);
    if (icon) return icon.svg;
  }
  return null;
}

/** Look up an icon's SVG data URI by id (searches all packs). Returns null if not found.
 *  NOTE: SVG data URIs work in the browser but NOT in node-canvas on the device.
 *  For device rendering, use resolveIconRef() which rasterises to PNG. */
export function getIconDataUri(iconId: string): string | null {
  const svg = getIconSvg(iconId);
  return svg ? svgToDataUri(svg) : null;
}

/**
 * Build an icon reference for use in default appearances.
 * Stores only the icon ID — the actual data URI is resolved lazily via
 * resolveIconRef() at apply-time in the renderer (rasterised to PNG so
 * node-canvas on the device can render it).
 */
export function iconRef(iconId: string): { dataUri: string; fit: 'contain'; offsetX: 0; offsetY: 0; scale: 1 } {
  // Store the icon ID as a special marker — resolved lazily via resolveIconRef()
  // at apply-time in the renderer. Icons may come from built-in packs or plugin-defined packs.
  return { dataUri: `icon:${iconId}`, fit: 'contain' as const, offsetX: 0, offsetY: 0, scale: 1 };
}

/**
 * Rasterise an SVG string to a 96×96 PNG data URI using browser canvas.
 * Must be called in the renderer process (requires DOM Image + Canvas).
 */
export function rasteriseSvg(svgMarkup: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dataUri = svgToDataUri(svgMarkup);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 96, 96);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to rasterise SVG icon'));
    img.src = dataUri;
  });
}

/**
 * Resolve an icon reference to a rasterised PNG data URI.
 * If the dataUri is an `icon:` reference, looks up the SVG and rasterises it.
 * If it's already a data: URI, returns it as-is.
 *
 * Resolution order:
 * 1. Built-in icon packs (by bare ID like 'play')
 * 2. Plugin icon packs (by namespaced ID like 'plugin:obs:broadcast')
 */
export async function resolveIconRef(dataUri: string, pluginIconPacks?: PluginIconPack[]): Promise<string> {
  // icon:someId — resolve from built-in packs or plugin icons
  if (dataUri.startsWith('icon:')) {
    const iconId = dataUri.slice(5);
    // Check built-in packs first
    let svg = getIconSvg(iconId);
    // Then check plugin icon packs
    if (!svg && pluginIconPacks) {
      for (const pack of pluginIconPacks) {
        const found = pack.icons.find((i) => i.id === iconId);
        if (found) {
          svg = found.svg;
          break;
        }
      }
    }
    if (!svg) return dataUri; // Can't resolve, return as-is
    return rasteriseSvg(svg);
  }
  // Already a concrete data URI — pass through
  return dataUri;
}
