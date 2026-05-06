<script lang="ts">
  import {
    selectedButtonIndex,
    selectedKnobId,
    currentPage,
    activeProfile,
    profiles,
    updateBinding,
    updateKnobBinding,
    clearSelection,
    livePreview
  } from '../stores/profile';
  import { selectedDeviceId } from '../stores/device';
  import type {
    ActionConfig,
    ActionType,
    BuiltinActionType,
    ButtonAppearance,
    InteractionSettings,
    MultiActionStep,
    TriggerType,
    KnobTriggerType,
    Layer,
    ImageLayer,
    TextLayer,
    LayerType
  } from '../../shared/types';
  import {
    DEFAULT_INTERACTION_SETTINGS,
    createDefaultAppearance,
    generateLayerId,
    MAX_LAYERS
  } from '../../shared/types';
  import { createAppearanceFromFlat, expandPartialLayers } from '../../shared/appearance-helpers';
  import IconPicker from './IconPicker.svelte';
  import PluginActionPanel from './PluginActionPanel.svelte';
  import LayerList from './LayerList.svelte';
  import LayerInspector from './LayerInspector.svelte';
  import type { PluginManifest } from '../../shared/plugin-types';
  import { iconRef, resolveIconRef, validatePluginIconPacks } from '../icons/icon-packs';
  import type { PluginIconPack } from '../../shared/plugin-types';

  $: buttonIndex = $selectedButtonIndex;
  $: knobId = $selectedKnobId;
  $: isKnobMode = knobId !== null;
  $: currentBinding = buttonIndex !== null ? ($currentPage?.bindings[buttonIndex] ?? null) : null;
  $: currentKnobBinding = knobId !== null ? ($currentPage?.knobBindings?.[knobId] ?? null) : null;
  $: availablePages = $activeProfile ? Object.values($activeProfile.pages) : [];

  // ─── Trigger selection ────────────────────────────────────
  let selectedTrigger: TriggerType = 'press';
  let selectedKnobTrigger: KnobTriggerType = 'rotateClockwise';

  // ─── Panel tab ────────────────────────────────────────────
  /** Top-level tab: 'action' edits trigger actions, 'appearance' edits visuals */
  let panelTab: 'action' | 'appearance' = 'action';

  // ─── Interaction timing settings ──────────────────────────
  let longPressMs = DEFAULT_INTERACTION_SETTINGS.longPressMs;
  let doubleTapMs = DEFAULT_INTERACTION_SETTINGS.doubleTapMs;

  // Load interaction settings on mount
  (async () => {
    if (!window.osc) return;
    const settings = await window.osc.getInteractionSettings();
    longPressMs = settings.longPressMs;
    doubleTapMs = settings.doubleTapMs;
  })();

  async function saveInteractionSettings() {
    if (!window.osc) return;
    const settings: InteractionSettings = {
      longPressMs: Math.max(100, Math.min(2000, longPressMs)),
      doubleTapMs: Math.max(100, Math.min(1000, doubleTapMs))
    };
    longPressMs = settings.longPressMs;
    doubleTapMs = settings.doubleTapMs;
    await window.osc.setInteractionSettings(settings);
  }

  // Derive action for the currently-selected trigger
  $: currentAction = isKnobMode
    ? currentKnobBinding
      ? (currentKnobBinding[selectedKnobTrigger] ?? null)
      : null
    : currentBinding
      ? (currentBinding[selectedTrigger] ?? null)
      : null;

  // ─── Action config state ──────────────────────────────────
  let actionType: ActionType = 'none';

  let label = '';
  let keystrokeSteps: Array<{ key: string; modifiers: string[] }> = [{ key: '', modifiers: [] }];
  let launchPath = '';
  let commandText = '';
  let multimediaAction = 'play-pause';
  let goToPageId = '';

  // Switch-profile state
  let switchProfileId = '';

  // Set-brightness state
  let brightnessValue = 100;

  // Multi-action state
  let multiSteps: Array<{ type: ActionType; config: Record<string, unknown>; label: string; delayMs: number }> = [];

  // Multi-action plugin step dynamic options cache: `${pluginId}:${queryName}` → options[]
  let multiStepDynamicOptions: Record<string, Array<{ value: string; label: string }>> = {};

  async function fetchMultiStepDynamicOptions(pluginId: string, force = false) {
    if (!window.osc) return;
    const manifest = pluginManifests.find((m) => m.id === pluginId);
    if (!manifest) return;
    for (const action of Object.values(manifest.actions)) {
      if (!action.params) continue;
      for (const field of Object.values(action.params)) {
        if (field.dynamicOptionsQuery) {
          const cacheKey = `${pluginId}:${field.dynamicOptionsQuery}`;
          if (!force && multiStepDynamicOptions[cacheKey]?.length > 0) continue;
          try {
            const options = await window.osc.pluginQuery(pluginId, field.dynamicOptionsQuery);
            multiStepDynamicOptions[cacheKey] = options as Array<{ value: string; label: string }>;
          } catch {
            // Plugin may not be connected — ignore
          }
        }
      }
    }
    multiStepDynamicOptions = multiStepDynamicOptions; // Trigger reactivity
  }

  // ─── Plugin state ─────────────────────────────────────────
  let pluginManifests: PluginManifest[] = [];
  let pluginStates: Record<string, Record<string, unknown> | null> = {};
  let pluginActionConfig: Record<string, unknown> = {};
  const pluginStateCleanups: Array<() => void> = [];

  // Derive the active plugin ID and manifest reactively from actionType.
  // These MUST live in the <script> block (not {@const} in the template)
  // because {@const} inside {:else if} does not re-evaluate when the
  // condition stays true but the underlying value changes.
  $: activePluginId = actionType.startsWith('plugin:') ? actionType.replace('plugin:', '') : '';
  $: activePluginManifest = pluginManifests.find((m) => m.id === activePluginId) ?? null;

  /** All icon packs from all loaded plugins (for IconPicker & resolveIconRef).
   *  Each plugin's packs are validated so only icons matching its own
   *  `plugin:{id}:` namespace are kept. */
  $: allPluginIconPacks = pluginManifests.flatMap((m) =>
    validatePluginIconPacks(m.id, m.iconPacks ?? [])
  ) as PluginIconPack[];

  // Load plugin manifests on mount
  (async () => {
    if (!window.osc) return;
    pluginManifests = ((await window.osc.pluginGetManifests()) ?? []) as PluginManifest[];

    // Subscribe to state changes for each plugin
    for (const manifest of pluginManifests) {
      pluginStates[manifest.id] = await window.osc.pluginGetState(manifest.id);
      const cleanup = window.osc.onPluginStateChanged(manifest.id, (state: Record<string, unknown>) => {
        pluginStates[manifest.id] = state;
        pluginStates = pluginStates; // Trigger reactivity
      });
      pluginStateCleanups.push(cleanup);
    }
    pluginStates = pluginStates; // Trigger reactivity
  })();

  // Reactively refresh multi-action step dynamic options when a plugin connects
  $: {
    // When pluginStates changes, check if any multi-action step plugin is now connected
    for (const step of multiSteps) {
      if (step.type.startsWith('plugin:')) {
        const pid = step.type.slice(7);
        const pState = pluginStates[pid];
        if (pState && (pState.connected || pState.authenticated)) {
          fetchMultiStepDynamicOptions(pid, true);
        }
      }
    }
  }

  // ─── Appearance state (layer-based) ────────────────────────
  let layers: Layer[] = createDefaultAppearance().layers;
  let selectedLayerId: string | null = null;
  let showIconPicker = false;

  /** The selected layer (derived) */
  $: selectedLayer = selectedLayerId ? (layers.find((l) => l.id === selectedLayerId) ?? null) : null;

  /** Whether any trigger has a plugin action bound */
  $: hasPluginAction = (() => {
    if (!currentBinding) return false;
    for (const trigger of ['press', 'longPress', 'doubleTap', 'down', 'up'] as const) {
      const act = currentBinding[trigger];
      if (act?.type.startsWith('plugin:')) return true;
    }
    return false;
  })();

  /** Get the plugin manifest for the bound plugin (if any) */
  $: boundPluginManifest = (() => {
    if (!currentBinding) return null;
    for (const trigger of ['press', 'longPress', 'doubleTap', 'down', 'up'] as const) {
      const act = currentBinding[trigger];
      if (act?.type.startsWith('plugin:')) {
        const pid = act.type.slice(7);
        const m = pluginManifests.find((pm) => pm.id === pid);
        if (m) return m;
      }
    }
    return null;
  })();

  // ─── Snapshot for revert ──────────────────────────────────
  /** The saved action at the moment the panel opened / trigger changed */
  let savedSnapshot: ActionConfig | null = null;
  /** The saved appearance at the moment the panel opened */
  let savedAppearanceSnapshot: ButtonAppearance | null = null;
  /** Track whether there are unsaved changes */
  let isDirty = false;

  // Sync form state when selection or trigger changes
  $: if (currentAction !== undefined && (selectedTrigger !== undefined || selectedKnobTrigger !== undefined)) {
    // This block runs when currentAction reference changes (i.e. button/knob selection, trigger switch, or profile reload)
    loadFromAction(currentAction);
    savedSnapshot = currentAction ? structuredClone(currentAction) : null;
    isDirty = false;
  }

  // Load appearance from binding whenever the binding changes
  $: if (currentBinding !== undefined || isKnobMode) {
    loadAppearanceFromBinding();
    savedAppearanceSnapshot = currentBinding?.appearance ? structuredClone(currentBinding.appearance) : null;
  }

  // Reset trigger to 'press' / 'rotateClockwise' and panel tab when selection changes
  $: if (buttonIndex !== undefined) {
    selectedTrigger = 'press';
    panelTab = 'action';
  }
  $: if (knobId !== undefined) {
    selectedKnobTrigger = 'rotateClockwise';
  }

  function loadFromAction(action: ActionConfig | null) {
    if (action) {
      actionType = action.type;
      const cfg = action.config as Record<string, unknown>;

      // Action-specific
      if (action.type === 'hotkey') {
        const steps = cfg.steps as Array<{ key: string; modifiers: string[] }> | undefined;
        if (steps && steps.length > 0) {
          keystrokeSteps = steps.map((s) => ({ key: s.key ?? '', modifiers: [...(s.modifiers ?? [])] }));
        } else {
          // Backward compat: old single-key format
          keystrokeSteps = [{ key: (cfg.key as string) ?? '', modifiers: [...((cfg.modifiers as string[]) ?? [])] }];
        }
      } else if (action.type === 'launch') {
        launchPath = (cfg.path as string) ?? '';
      } else if (action.type === 'command') {
        commandText = (cfg.command as string) ?? '';
      } else if (action.type === 'multimedia') {
        multimediaAction = (cfg.action as string) ?? 'play-pause';
      } else if (action.type === 'go-to-page') {
        goToPageId = (cfg.pageId as string) ?? '';
      } else if (action.type === 'multi-action') {
        const steps = (cfg.steps as MultiActionStep[]) ?? [];
        multiSteps = steps.map((s) => ({
          type: s.action?.type ?? 'none',
          config: (s.action?.config as Record<string, unknown>) ?? {},
          label: s.action?.label ?? '',
          delayMs: s.delayMs ?? 0
        }));
        // Pre-fetch dynamic options for any plugin steps
        const pluginIds = new Set(multiSteps.filter((s) => s.type.startsWith('plugin:')).map((s) => s.type.slice(7)));
        for (const pid of pluginIds) {
          fetchMultiStepDynamicOptions(pid);
        }
      } else if (action.type === 'switch-profile') {
        switchProfileId = (cfg.profileId as string) ?? '';
      } else if (action.type === 'set-brightness') {
        brightnessValue = (cfg.brightness as number) ?? 100;
      } else if (action.type.startsWith('plugin:')) {
        // Generic plugin action — load plugin action config from cfg
        pluginActionConfig = { ...cfg };
      }
    } else {
      actionType = 'none';
      keystrokeSteps = [{ key: '', modifiers: [] }];
      launchPath = '';
      commandText = '';
      multimediaAction = 'play-pause';
      goToPageId = '';
      multiSteps = [];
      switchProfileId = '';
      brightnessValue = 100;
      pluginActionConfig = {};
    }
  }

  /** Load appearance state from the current binding's appearance (layer-based) */
  function loadAppearanceFromBinding() {
    if (currentBinding?.appearance?.layers?.length) {
      layers = structuredClone(currentBinding.appearance.layers);
    } else {
      layers = createDefaultAppearance().layers;
    }
    selectedLayerId = null;
    // Sync label from first text layer
    const textLayer = layers.find((l) => l.type === 'text') as TextLayer | undefined;
    label = textLayer?.text ?? '';
  }

  /** Build the full appearance from current layer state */
  function buildAppearance(): ButtonAppearance {
    return { layers: structuredClone(layers) };
  }

  const emptyAppearance: ButtonAppearance = createDefaultAppearance();

  /** Default appearances for built-in action types */
  const builtinDefaultAppearances: Partial<Record<BuiltinActionType, ButtonAppearance>> = {
    hotkey: createAppearanceFromFlat({
      backgroundColor: '#1a2a1a',
      label: { text: 'Hotkey', color: '#98c379', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('lightning')
    }),
    launch: createAppearanceFromFlat({
      backgroundColor: '#1a1a3e',
      label: { text: 'Launch', color: '#61afef', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('folder')
    }),
    command: createAppearanceFromFlat({
      backgroundColor: '#1a1a2e',
      label: { text: 'Command', color: '#c678dd', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('terminal')
    }),
    multimedia: createAppearanceFromFlat({
      backgroundColor: '#2e1a2e',
      label: { text: 'Play /\nPause', color: '#e5c07b', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('music')
    }),
    'go-to-page': createAppearanceFromFlat({
      backgroundColor: '#1a2e2e',
      label: { text: 'Go to\nPage', color: '#56b6c2', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('chevron-right')
    }),
    'go-to-back': createAppearanceFromFlat({
      backgroundColor: '#1a2e2e',
      label: { text: '← Back', color: '#56b6c2', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('chevron-left')
    }),
    'switch-profile': createAppearanceFromFlat({
      backgroundColor: '#2e2e1a',
      label: { text: 'Switch\nProfile', color: '#e5c07b', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('refresh')
    }),
    'set-brightness': createAppearanceFromFlat({
      backgroundColor: '#2e2e2e',
      label: { text: 'Brightness', color: '#ffffff', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('sun')
    }),
    'multi-action': createAppearanceFromFlat({
      backgroundColor: '#2e1a3e',
      label: { text: 'Multi\nAction', color: '#c678dd', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('grid')
    })
  };

  /** Per-multimedia-action default appearances */
  const multimediaDefaultAppearances: Record<string, ButtonAppearance> = {
    'play-pause': createAppearanceFromFlat({
      backgroundColor: '#2e1a2e',
      label: { text: 'Play /\nPause', color: '#e5c07b', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('play')
    }),
    next: createAppearanceFromFlat({
      backgroundColor: '#2e1a2e',
      label: { text: 'Next\nTrack', color: '#e5c07b', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('skip-forward')
    }),
    prev: createAppearanceFromFlat({
      backgroundColor: '#2e1a2e',
      label: { text: 'Previous\nTrack', color: '#e5c07b', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('skip-back')
    }),
    'volume-up': createAppearanceFromFlat({
      backgroundColor: '#2e2a1a',
      label: { text: 'Volume\nUp', color: '#98c379', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('volume-up')
    }),
    'volume-down': createAppearanceFromFlat({
      backgroundColor: '#2e2a1a',
      label: { text: 'Volume\nDown', color: '#e06c75', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('volume-down')
    }),
    mute: createAppearanceFromFlat({
      backgroundColor: '#2e1a1a',
      label: { text: 'Mute', color: '#e06c75', bold: true, positionV: 'bottom', positionH: 'center' },
      icon: iconRef('volume-mute')
    })
  };

  /** Get the default appearance for an action type (built-in or plugin).
   *  For plugin actions, looks up the specific action's default via `subAction`.
   *  For multimedia, resolves per-sub-action defaults.
   *  Icon references (icon:id) in ImageLayers are resolved to rasterised PNG data URIs. */
  async function getDefaultAppearance(type: ActionType, subAction?: string): Promise<ButtonAppearance | null> {
    if (type === 'none') return null;

    let appearance: ButtonAppearance | undefined;

    if (!type.startsWith('plugin:')) {
      // Check built-in defaults (already full ButtonAppearance objects)
      appearance =
        type === 'multimedia' && subAction && multimediaDefaultAppearances[subAction]
          ? multimediaDefaultAppearances[subAction]
          : builtinDefaultAppearances[type as BuiltinActionType];
    } else {
      // Plugin action — expand partial layers from manifest
      const pluginId = type.slice(7);
      const manifest = pluginManifests.find((m) => m.id === pluginId);
      if (!manifest) return null;

      const actionId = subAction ?? Object.keys(manifest.actions)[0];
      const partial = manifest.actions[actionId]?.defaultAppearance;
      if (partial?.layers) {
        appearance = expandPartialLayers(partial.layers, pluginId);
      }
    }

    if (!appearance) return null;

    // Deep clone to avoid mutating the constant defaults
    const result: ButtonAppearance = structuredClone(appearance);

    // Resolve icon references (icon:someId) in ImageLayers to rasterised PNG data URIs
    for (const layer of result.layers) {
      if (layer.type === 'image' && layer.dataUri?.startsWith('icon:')) {
        layer.dataUri = await resolveIconRef(layer.dataUri, allPluginIconPacks);
      }
    }

    return result;
  }

  /** Apply a default appearance to the layer state (for live preview) */
  function applyDefaultAppearance(ap: ButtonAppearance) {
    layers = structuredClone(ap.layers);
    selectedLayerId = null;
    const textLayer = layers.find((l) => l.type === 'text') as TextLayer | undefined;
    label = textLayer?.text ?? '';
  }

  /** Called when the user picks a different plugin action inside PluginActionPanel */
  async function onPluginActionChanged(pluginActionId: string) {
    if (isKnobMode) return;
    const defaultAp = await getDefaultAppearance(actionType, pluginActionId);
    if (defaultAp) {
      applyDefaultAppearance(defaultAp);
      pushLivePreview();
    }
  }

  /** Called when the action type dropdown changes */
  async function onActionTypeChanged() {
    // Reset plugin config when switching to a (different) plugin action type
    // so the new PluginActionPanel can default to its first action.
    if (actionType.startsWith('plugin:')) {
      pluginActionConfig = {};
    }
    if (!isKnobMode) {
      const subAction = actionType === 'multimedia' ? multimediaAction : undefined;
      const defaultAp = await getDefaultAppearance(actionType, subAction);
      if (defaultAp) {
        applyDefaultAppearance(defaultAp);
      }
    }
    pushLivePreview();
  }

  /** Called when the multimedia sub-action dropdown changes */
  async function onMultimediaActionChanged() {
    if (!isKnobMode) {
      const defaultAp = await getDefaultAppearance('multimedia', multimediaAction);
      if (defaultAp) {
        applyDefaultAppearance(defaultAp);
      }
    }
    pushLivePreview();
  }

  /** Push live preview to both the UI store and the physical device.
   *  Appearance is per-button, so always preview regardless of trigger.
   *  Knobs have no visual preview — skip for knob mode.
   *  Requests a rendered PNG from the main process via KeyRenderer
   *  so the preview is pixel-perfect WYSIWYG. */
  function pushLivePreview() {
    if (isKnobMode) {
      isDirty = true;
      return;
    }
    if (buttonIndex === null) return;
    isDirty = true;

    const appearance = buildAppearance();
    // Send to the currently selected device only
    const deviceId = $selectedDeviceId;
    if (!deviceId) return;
    window.osc.drawKey({ keyIndex: buttonIndex, appearance, deviceId });
    // Request rendered preview from main process
    const idx = buttonIndex;
    window.osc.renderKeyPreview({ appearance, deviceId }).then((dataUri) => {
      livePreview.set({ buttonIndex: idx, dataUri });
    });
  }

  // Debounced live preview for slider inputs (avoid flooding the device)
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  function pushLivePreviewDebounced() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(pushLivePreview, 50);
  }

  async function saveAction() {
    if (!isKnobMode && buttonIndex === null) return;

    // Build the appearance from current form state
    const appearance = buildAppearance();

    if (actionType === 'none') {
      if (isKnobMode && knobId) {
        await updateKnobBinding(knobId, null, selectedKnobTrigger);
      } else if (buttonIndex !== null) {
        // Save appearance independently — users can style a button without an action
        await updateBinding(buttonIndex, null, selectedTrigger, appearance);
        if ($selectedDeviceId) {
          window.osc.drawKey({ keyIndex: buttonIndex, appearance, deviceId: $selectedDeviceId });
        }
        livePreview.set(null);
        savedAppearanceSnapshot = structuredClone(appearance);
      }
      savedSnapshot = null;
      isDirty = false;
      return;
    }

    const actionId = isKnobMode
      ? `action-knob-${knobId}-${selectedKnobTrigger}-${Date.now()}`
      : `action-${buttonIndex}-${selectedTrigger}-${Date.now()}`;

    const action: ActionConfig = {
      id: currentAction?.id ?? actionId,
      type: actionType,
      label,
      config: {}
    };

    // Merge action-specific config
    switch (actionType) {
      case 'hotkey':
        action.config = { steps: keystrokeSteps.filter((s) => s.key.trim() !== '') };
        break;
      case 'launch':
        action.config = { path: launchPath };
        break;
      case 'command':
        action.config = { command: commandText };
        break;
      case 'multimedia':
        action.config = { action: multimediaAction };
        break;
      case 'go-to-page':
        action.config = { pageId: goToPageId };
        break;
      case 'multi-action': {
        const steps: MultiActionStep[] = multiSteps
          .filter((s) => s.type !== 'none')
          .map((s) => ({
            action: {
              id: `multi-step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              type: s.type,
              label: s.label,
              config: { ...s.config }
            },
            delayMs: s.delayMs > 0 ? s.delayMs : undefined
          }));
        action.config = { steps };
        break;
      }
      case 'switch-profile':
        action.config = { profileId: switchProfileId };
        break;
      case 'set-brightness':
        action.config = { brightness: brightnessValue };
        break;
      default:
        // Plugin action types (plugin:*)
        if (actionType.startsWith('plugin:')) {
          action.config = { ...pluginActionConfig };
        }
        break;
    }

    if (isKnobMode && knobId) {
      await updateKnobBinding(knobId, action, selectedKnobTrigger);
    } else if (buttonIndex !== null) {
      await updateBinding(buttonIndex, action, selectedTrigger, appearance);
    }

    // Commit: clear live preview (ButtonCell will now read from the saved binding)
    if (!isKnobMode) {
      livePreview.set(null);
    }
    savedSnapshot = structuredClone(action);
    savedAppearanceSnapshot = structuredClone(appearance);
    isDirty = false;
  }

  function revertAction() {
    if (!isKnobMode && buttonIndex === null) return;
    // Restore form state from snapshots
    loadFromAction(savedSnapshot);
    // Restore appearance layers from snapshot
    if (savedAppearanceSnapshot?.layers?.length) {
      layers = structuredClone(savedAppearanceSnapshot.layers);
    } else {
      layers = createDefaultAppearance().layers;
    }
    selectedLayerId = null;
    const textLayer = layers.find((l) => l.type === 'text') as TextLayer | undefined;
    label = textLayer?.text ?? '';
    isDirty = false;

    // Knobs have no visual preview to revert
    if (isKnobMode) return;

    // Restore device + UI preview
    if (savedAppearanceSnapshot) {
      if ($selectedDeviceId) {
        window.osc.drawKey({
          keyIndex: buttonIndex!,
          appearance: savedAppearanceSnapshot,
          deviceId: $selectedDeviceId
        });
      }
    } else {
      if ($selectedDeviceId) {
        window.osc.drawKey({
          keyIndex: buttonIndex!,
          appearance: emptyAppearance,
          deviceId: $selectedDeviceId
        });
      }
    }
    livePreview.set(null);
  }

  /** Reset appearance layers to defaults */
  function resetAppearanceForm() {
    layers = createDefaultAppearance().layers;
    selectedLayerId = null;
    label = '';
  }

  /** Clear both the current trigger's action and the appearance */
  function clearAll() {
    if (isKnobMode && knobId) {
      updateKnobBinding(knobId, null, selectedKnobTrigger);
    } else if (buttonIndex !== null) {
      updateBinding(buttonIndex, null, selectedTrigger, null);
      if ($selectedDeviceId) {
        window.osc.drawKey({
          keyIndex: buttonIndex,
          appearance: emptyAppearance,
          deviceId: $selectedDeviceId
        });
      }
      livePreview.set(null);
    }
    loadFromAction(null);
    resetAppearanceForm();
    savedSnapshot = null;
    savedAppearanceSnapshot = null;
    isDirty = false;
  }

  function closePanel() {
    // If there are unsaved changes, revert the device to saved state
    if (isDirty && !isKnobMode && buttonIndex !== null) {
      revertAction();
    }
    livePreview.set(null);
    panelTab = 'action';
    clearSelection();
  }

  async function pickImage() {
    const dataUri = await window.osc.pickImage();
    if (dataUri && selectedLayer?.type === 'image') {
      updateLayerInPlace(selectedLayer.id, { dataUri } as Partial<ImageLayer>);
      pushLivePreview();
    }
  }

  function removeImage() {
    if (selectedLayer?.type === 'image') {
      updateLayerInPlace(selectedLayer.id, {
        dataUri: '',
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        fit: 'contain'
      } as Partial<ImageLayer>);
      pushLivePreview();
    }
  }

  // ─── Layer mutation handlers ──────────────────────────────

  /** Update a layer's properties in-place and trigger reactivity */
  function updateLayerInPlace(layerId: string, fields: Partial<Layer>) {
    const idx = layers.findIndex((l) => l.id === layerId);
    if (idx === -1) return;
    layers[idx] = { ...layers[idx], ...fields } as Layer;
    layers = [...layers]; // trigger reactivity
    // Keep label synced with the first text layer
    if (layers[idx].type === 'text') {
      const textLayer = layers.find((l) => l.type === 'text') as TextLayer | undefined;
      label = textLayer?.text ?? '';
    }
  }

  /** Handle committed layer changes (immediate preview) */
  function handleLayerChange(updatedLayer: Layer) {
    const idx = layers.findIndex((l) => l.id === updatedLayer.id);
    if (idx === -1) return;
    layers[idx] = updatedLayer;
    layers = [...layers];
    if (updatedLayer.type === 'text') {
      label = (updatedLayer as TextLayer).text;
    }
    pushLivePreview();
  }

  /** Handle continuous layer changes (debounced preview) */
  function handleLayerInput(updatedLayer: Layer) {
    const idx = layers.findIndex((l) => l.id === updatedLayer.id);
    if (idx === -1) return;
    layers[idx] = updatedLayer;
    layers = [...layers];
    if (updatedLayer.type === 'text') {
      label = (updatedLayer as TextLayer).text;
    }
    pushLivePreviewDebounced();
  }

  function handleLayerSelect(e: CustomEvent<string>) {
    selectedLayerId = e.detail;
  }

  function handleToggleVisibility(e: CustomEvent<string>) {
    const idx = layers.findIndex((l) => l.id === e.detail);
    if (idx === -1) return;
    layers[idx] = { ...layers[idx], visible: !layers[idx].visible } as Layer;
    layers = [...layers];
    pushLivePreview();
  }

  function handleToggleLock(e: CustomEvent<string>) {
    const idx = layers.findIndex((l) => l.id === e.detail);
    if (idx === -1) return;
    layers[idx] = { ...layers[idx], locked: !layers[idx].locked } as Layer;
    layers = [...layers];
  }

  function handleAddLayer(e: CustomEvent<LayerType>) {
    if (layers.length >= MAX_LAYERS) return;
    const type = e.detail;
    let newLayer: Layer;
    switch (type) {
      case 'fill':
        newLayer = {
          id: generateLayerId(),
          type: 'fill',
          name: 'Fill',
          visible: true,
          opacity: 1,
          locked: false,
          color: '#333333'
        };
        break;
      case 'image':
        newLayer = {
          id: generateLayerId(),
          type: 'image',
          name: 'Image',
          visible: true,
          opacity: 1,
          locked: false,
          dataUri: '',
          fit: 'contain',
          scale: 1,
          offsetX: 0,
          offsetY: 0
        };
        break;
      case 'text':
        newLayer = {
          id: generateLayerId(),
          type: 'text',
          name: 'Text',
          visible: true,
          opacity: 1,
          locked: false,
          text: '',
          color: '#ffffff',
          fontSize: 0,
          bold: true,
          positionV: 'center',
          positionH: 'center'
        };
        break;
      case 'plugin':
        newLayer = {
          id: generateLayerId(),
          type: 'plugin',
          name: 'Plugin Image',
          visible: true,
          opacity: 1,
          locked: false,
          fit: 'contain',
          pluginId: boundPluginManifest?.id
        };
        break;
      default:
        return;
    }
    layers = [...layers, newLayer];
    selectedLayerId = newLayer.id;
    pushLivePreview();
  }

  function handleReorderLayers(e: CustomEvent<{ fromIndex: number; toIndex: number }>) {
    const { fromIndex, toIndex } = e.detail;
    const moved = layers.splice(fromIndex, 1)[0];
    layers.splice(toIndex, 0, moved);
    layers = [...layers];
    pushLivePreview();
  }

  function handleDeleteLayer() {
    if (!selectedLayerId) return;
    layers = layers.filter((l) => l.id !== selectedLayerId);
    selectedLayerId = null;
    pushLivePreview();
  }

  function handleDuplicateLayer() {
    if (!selectedLayer || layers.length >= MAX_LAYERS) return;
    const clone = structuredClone(selectedLayer);
    clone.id = generateLayerId();
    clone.name = `${clone.name} copy`;
    const idx = layers.findIndex((l) => l.id === selectedLayerId);
    layers = [...layers.slice(0, idx + 1), clone, ...layers.slice(idx + 1)];
    selectedLayerId = clone.id;
    pushLivePreview();
  }

  function handlePickIcon() {
    showIconPicker = true;
  }

  function handlePickImage() {
    pickImage();
  }

  function handleRemoveImage() {
    removeImage();
  }

  // Shared CSS classes for inputs
  const inputClass =
    'w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]';
  const labelClass = 'block text-xs text-[var(--color-text-secondary)] mb-1';

  /** Trigger tab definitions for buttons */
  const triggerTabs: { key: TriggerType; label: string }[] = [
    { key: 'press', label: 'Press' },
    { key: 'longPress', label: 'Long Press' },
    { key: 'doubleTap', label: 'Double Tap' },
    { key: 'down', label: 'Down' },
    { key: 'up', label: 'Up' }
  ];

  /** Trigger tab definitions for knobs */
  const knobTriggerTabs: { key: KnobTriggerType; label: string }[] = [
    { key: 'rotateClockwise', label: 'Clockwise' },
    { key: 'rotateCounterClockwise', label: 'Counter-CW' },
    { key: 'press', label: 'Press' }
  ];
</script>

<div class="p-4 flex flex-col gap-3 overflow-y-auto">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">
      {#if isKnobMode}
        Knob: {knobId?.replace('knob', '') ?? ''}
      {:else}
        Button {(buttonIndex ?? 0) + 1}
      {/if}
    </h3>
    <button
      class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
      on:click={closePanel}
    >
      ✕
    </button>
  </div>

  <!-- Action / Appearance top-level tabs (buttons only, not knobs) -->
  {#if !isKnobMode}
    <div class="flex rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border)] overflow-hidden">
      <button
        class="flex-1 px-3 py-1.5 text-xs font-semibold transition-colors
               {panelTab === 'action'
          ? 'bg-[var(--color-accent)] text-white'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'}"
        on:click={() => (panelTab = 'action')}
      >
        Action
      </button>
      <button
        class="flex-1 px-3 py-1.5 text-xs font-semibold transition-colors
               {panelTab === 'appearance'
          ? 'bg-[var(--color-accent)] text-white'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'}"
        on:click={() => (panelTab = 'appearance')}
      >
        Appearance
      </button>
    </div>
  {/if}

  <!-- ═══════════ ACTION TAB ═══════════ -->
  {#if panelTab === 'action' || isKnobMode}
    <!-- Trigger tabs — knob or button mode -->
    {#if isKnobMode}
      <div class="flex rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border)] overflow-hidden">
        {#each knobTriggerTabs as tab (tab.key)}
          {@const tabHasAction = currentKnobBinding?.[tab.key] != null}
          <button
            class="flex-1 relative px-2 py-1.5 text-xs font-medium transition-colors
                 {selectedKnobTrigger === tab.key
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'}"
            on:click={() => {
              if (isDirty) revertAction();
              selectedKnobTrigger = tab.key;
            }}
          >
            {tab.label}
            {#if tabHasAction && selectedKnobTrigger !== tab.key}
              <span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]"></span>
            {/if}
          </button>
        {/each}
      </div>
    {:else}
      <!-- Button trigger tabs -->
      <div class="flex rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border)] overflow-hidden">
        {#each triggerTabs as tab (tab.key)}
          {@const tabHasAction = currentBinding?.[tab.key] != null}
          <button
            class="flex-1 relative px-2 py-1.5 text-xs font-medium transition-colors
               {selectedTrigger === tab.key
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]'}"
            on:click={() => {
              if (isDirty) revertAction();
              selectedTrigger = tab.key;
            }}
          >
            {tab.label}
            <!-- Dot indicator when this trigger has an action -->
            {#if tabHasAction && selectedTrigger !== tab.key}
              <span class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]"></span>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Trigger info note + timing settings -->
      {#if selectedTrigger === 'press'}
        <div class="-mt-1">
          <p class="text-[10px] text-[var(--color-text-muted)] leading-snug">
            Standard tap action. Configure visuals on the Appearance tab.
          </p>
        </div>
      {:else if selectedTrigger === 'longPress'}
        <div class="-mt-1 space-y-1.5">
          <p class="text-[10px] text-[var(--color-text-muted)] leading-snug">
            Hold button for {longPressMs}ms.
          </p>
          <div class="flex items-center gap-2">
            <label class="text-[10px] text-[var(--color-text-secondary)] whitespace-nowrap" for="long-press-ms"
              >Hold duration</label
            >
            <input
              id="long-press-ms"
              type="range"
              min="100"
              max="2000"
              step="50"
              bind:value={longPressMs}
              on:change={saveInteractionSettings}
              class="flex-1 h-1 accent-[var(--color-accent)]"
            />
            <span class="text-[10px] text-[var(--color-text-muted)] w-12 text-right tabular-nums">{longPressMs}ms</span>
          </div>
        </div>
      {:else if selectedTrigger === 'doubleTap'}
        <div class="-mt-1 space-y-1.5">
          <p class="text-[10px] text-[var(--color-text-muted)] leading-snug">
            Tap twice within {doubleTapMs}ms. Adds a slight delay to single press.
          </p>
          <div class="flex items-center gap-2">
            <label class="text-[10px] text-[var(--color-text-secondary)] whitespace-nowrap" for="double-tap-ms"
              >Tap window</label
            >
            <input
              id="double-tap-ms"
              type="range"
              min="100"
              max="1000"
              step="25"
              bind:value={doubleTapMs}
              on:change={saveInteractionSettings}
              class="flex-1 h-1 accent-[var(--color-accent)]"
            />
            <span class="text-[10px] text-[var(--color-text-muted)] w-12 text-right tabular-nums">{doubleTapMs}ms</span>
          </div>
        </div>
      {:else if selectedTrigger === 'down'}
        <div class="-mt-1">
          <p class="text-[10px] text-[var(--color-text-muted)] leading-snug">
            Fires immediately when the button is pressed down.
          </p>
        </div>
      {:else if selectedTrigger === 'up'}
        <div class="-mt-1">
          <p class="text-[10px] text-[var(--color-text-muted)] leading-snug">Fires when the button is released.</p>
        </div>
      {/if}
    {/if}

    <!-- Action type selector -->
    <div>
      <label for="action-type" class={labelClass}>Action Type</label>
      <select id="action-type" bind:value={actionType} on:change={onActionTypeChanged} class={inputClass}>
        <option value="none">None</option>
        <optgroup label="System">
          <option value="hotkey">Key Sequence</option>
          {#if !navigator.platform.startsWith('Linux')}
            <option value="launch">Launch App</option>
          {/if}
          <option value="command">Run Command</option>
          <option value="multimedia">Multimedia</option>
        </optgroup>
        <optgroup label="Navigation">
          <option value="go-to-page">Go to Page</option>
          <option value="go-to-back">Go Back (←)</option>
          <option value="switch-profile">Switch Profile</option>
        </optgroup>
        <optgroup label="Device">
          <option value="set-brightness">Set Brightness</option>
        </optgroup>
        <optgroup label="Advanced">
          <option value="multi-action">Multi-Action</option>
        </optgroup>
        {#if pluginManifests.length > 0}
          <optgroup label="Plugins">
            {#each pluginManifests as manifest (manifest.id)}
              <option value="plugin:{manifest.id}">{manifest.name}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
    </div>

    <!-- Type-specific config -->
    {#if actionType === 'hotkey'}
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-[var(--color-text-secondary)]">Keystroke Steps</span>
          <button
            on:click={() => {
              keystrokeSteps = [...keystrokeSteps, { key: '', modifiers: [] }];
            }}
            class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-accent)] hover:bg-[var(--color-surface-3)] transition-colors"
          >
            + Add Step
          </button>
        </div>

        {#each keystrokeSteps as step, i (i)}
          <div
            class="flex flex-col gap-1.5 p-2 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border)]"
          >
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-[var(--color-text-muted)] w-4 text-center">{i + 1}</span>
              <input
                type="text"
                bind:value={step.key}
                placeholder="Key (e.g. n, space, f1)"
                class="flex-1 {inputClass}"
              />
              {#if keystrokeSteps.length > 1}
                <button
                  on:click={() => {
                    keystrokeSteps = keystrokeSteps.filter((_, idx) => idx !== i);
                  }}
                  class="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] text-xs transition-colors"
                  title="Remove step"
                >
                  ✕
                </button>
              {/if}
            </div>
            <div class="flex flex-wrap gap-1.5 ml-6">
              {#each ['ctrl', 'shift', 'alt', 'meta'] as mod (mod)}
                <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={step.modifiers.includes(mod)}
                    on:change={(e) => {
                      if (e.currentTarget.checked) {
                        step.modifiers = [...step.modifiers, mod];
                      } else {
                        step.modifiers = step.modifiers.filter((m) => m !== mod);
                      }
                      keystrokeSteps = keystrokeSteps;
                    }}
                    class="rounded bg-[var(--color-surface-2)] border-[var(--color-border)]"
                  />
                  {mod}
                </label>
              {/each}
            </div>
          </div>
        {/each}

        <p class="text-[10px] text-[var(--color-text-muted)]">
          Each step sends a keystroke with optional modifiers. Steps execute in sequence.
        </p>
      </div>
    {:else if actionType === 'launch'}
      <div>
        <label for="launch-path" class={labelClass}>Application Path</label>
        <input
          id="launch-path"
          type="text"
          bind:value={launchPath}
          placeholder="/Applications/..."
          class={inputClass}
        />
        <p class="text-[10px] text-[var(--color-text-muted)] mt-1">
          Opens an application or file using the system handler. For shell commands, use "Run Command" instead.
        </p>
      </div>
    {:else if actionType === 'command'}
      <div>
        <label for="command-text" class={labelClass}>Shell Command</label>
        <input
          id="command-text"
          type="text"
          bind:value={commandText}
          placeholder="e.g. docker compose up -d"
          class={inputClass}
        />
        <p class="text-[10px] text-[var(--color-text-muted)] mt-1">
          Runs as a shell command. Supports pipes, redirects, and environment variables.
        </p>
      </div>
    {:else if actionType === 'multimedia'}
      <div>
        <label for="media-action" class={labelClass}>Media Action</label>
        <select
          id="media-action"
          bind:value={multimediaAction}
          on:change={onMultimediaActionChanged}
          class={inputClass}
        >
          <option value="play-pause">Play / Pause</option>
          <option value="next">Next Track</option>
          <option value="prev">Previous Track</option>
          <option value="volume-up">Volume Up</option>
          <option value="volume-down">Volume Down</option>
          <option value="mute">Mute</option>
        </select>
      </div>
    {:else if actionType === 'go-to-page'}
      <div>
        <label for="page-target" class={labelClass}>Target Page</label>
        <select id="page-target" bind:value={goToPageId} class={inputClass}>
          <option value="">— Select a page —</option>
          {#each availablePages as page (page.id)}
            <option value={page.id}>{page.name}</option>
          {/each}
        </select>
        {#if availablePages.length <= 1}
          <p class="text-xs text-[var(--color-text-muted)] mt-2">
            No other pages exist yet. Create pages using the page bar above the button grid.
          </p>
        {/if}
      </div>
    {:else if actionType === 'go-to-back'}
      <div>
        <p class="text-xs text-[var(--color-text-muted)]">
          This button will navigate back to the previous page. If already on the root page, it does nothing.
        </p>
      </div>
    {:else if actionType === 'switch-profile'}
      <div>
        <label for="profile-target" class={labelClass}>Target Profile</label>
        <select id="profile-target" bind:value={switchProfileId} on:change={pushLivePreview} class={inputClass}>
          <option value="">— Select a profile —</option>
          {#each $profiles as profile (profile.id)}
            <option value={profile.id}>{profile.name}</option>
          {/each}
        </select>
        {#if $profiles.length <= 1}
          <p class="text-xs text-[var(--color-text-muted)] mt-2">
            No other profiles exist yet. Create profiles using the profile switcher in the status bar.
          </p>
        {/if}
      </div>
    {:else if actionType === 'set-brightness'}
      <div class="space-y-2">
        <label for="brightness-value" class={labelClass}>Brightness</label>
        <div class="flex items-center gap-2">
          <input
            id="brightness-value"
            type="range"
            min="0"
            max="100"
            step="5"
            bind:value={brightnessValue}
            on:input={pushLivePreview}
            class="flex-1 accent-[var(--color-accent)]"
          />
          <span class="text-xs text-[var(--color-text-secondary)] w-8 text-right">{brightnessValue}%</span>
        </div>
        <p class="text-xs text-[var(--color-text-muted)]">
          Sets the device backlight to {brightnessValue}% when pressed.
        </p>
      </div>
    {:else if actionType === 'multi-action'}
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-[var(--color-text-secondary)]">Action Steps</span>
          <button
            on:click={() => {
              multiSteps = [...multiSteps, { type: 'none', config: {}, label: '', delayMs: 0 }];
              pushLivePreview();
            }}
            class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-accent)] hover:bg-[var(--color-surface-3)] transition-colors"
          >
            + Add Step
          </button>
        </div>

        {#if multiSteps.length === 0}
          <p class="text-xs text-[var(--color-text-muted)]">
            No steps configured. Add steps to build a sequence of actions that execute in order.
          </p>
        {/if}

        {#each multiSteps as step, i (i)}
          <div class="rounded-lg border border-[var(--color-border)] p-2 space-y-1.5 bg-[var(--color-surface-2)]">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-medium text-[var(--color-text-muted)]">Step {i + 1}</span>
              <div class="flex items-center gap-1">
                {#if i > 0}
                  <button
                    on:click={() => {
                      const arr = [...multiSteps];
                      [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                      multiSteps = arr;
                      pushLivePreview();
                    }}
                    class="text-[10px] px-1 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Move up">↑</button
                  >
                {/if}
                {#if i < multiSteps.length - 1}
                  <button
                    on:click={() => {
                      const arr = [...multiSteps];
                      [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                      multiSteps = arr;
                      pushLivePreview();
                    }}
                    class="text-[10px] px-1 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                    title="Move down">↓</button
                  >
                {/if}
                <button
                  on:click={() => {
                    multiSteps = multiSteps.filter((_, idx) => idx !== i);
                    pushLivePreview();
                  }}
                  class="text-[10px] px-1 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-danger)] hover:opacity-80 transition-colors"
                  title="Remove step">✕</button
                >
              </div>
            </div>

            <select
              bind:value={step.type}
              on:change={() => {
                step.config = {};
                step.label = '';
                // Initialize plugin action config when a plugin type is selected
                if (step.type.startsWith('plugin:')) {
                  const pid = step.type.slice(7);
                  const m = pluginManifests.find((pm) => pm.id === pid);
                  if (m) {
                    step.config.pluginAction = Object.keys(m.actions)[0] ?? '';
                    fetchMultiStepDynamicOptions(pid);
                  }
                }
                multiSteps = multiSteps;
                pushLivePreview();
              }}
              class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
            >
              <option value="none">None</option>
              <optgroup label="System">
                <option value="hotkey">Key Sequence</option>
                {#if !navigator.platform.startsWith('Linux')}
                  <option value="launch">Launch App</option>
                {/if}
                <option value="command">Run Command</option>
                <option value="multimedia">Multimedia</option>
              </optgroup>
              <optgroup label="Navigation">
                <option value="go-to-page">Go to Page</option>
                <option value="go-to-back">Go Back (←)</option>
                <option value="switch-profile">Switch Profile</option>
              </optgroup>
              <optgroup label="Device">
                <option value="set-brightness">Set Brightness</option>
              </optgroup>
              {#if pluginManifests.length > 0}
                <optgroup label="Plugins">
                  {#each pluginManifests as manifest (manifest.id)}
                    <option value="plugin:{manifest.id}">{manifest.name}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>

            <!-- Step-specific config -->
            {#if step.type === 'hotkey'}
              {@const hotkeySteps = (step.config.steps as Array<{ key: string; modifiers: string[] }>) ?? [
                { key: '', modifiers: [] }
              ]}
              <div class="space-y-1">
                {#each hotkeySteps as keystroke, ki (ki)}
                  <div class="flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="Key"
                      value={keystroke.key}
                      on:input={(e) => {
                        const steps = [...hotkeySteps];
                        steps[ki] = { ...steps[ki], key: e.currentTarget.value };
                        step.config = { ...step.config, steps };
                        multiSteps = multiSteps;
                        pushLivePreview();
                      }}
                      class="flex-1 rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                    />
                    {#each ['ctrl', 'alt', 'shift', 'meta'] as mod (mod)}
                      <label class="flex items-center gap-0.5 text-[10px] text-[var(--color-text-muted)]">
                        <input
                          type="checkbox"
                          checked={(keystroke.modifiers ?? []).includes(mod)}
                          on:change={(e) => {
                            const steps = [...hotkeySteps];
                            const mods = [...(steps[ki].modifiers ?? [])];
                            if (e.currentTarget.checked) mods.push(mod);
                            else mods.splice(mods.indexOf(mod), 1);
                            steps[ki] = { ...steps[ki], modifiers: mods };
                            step.config = { ...step.config, steps };
                            multiSteps = multiSteps;
                            pushLivePreview();
                          }}
                          class="accent-[var(--color-accent)]"
                        />
                        {mod}
                      </label>
                    {/each}
                  </div>
                {/each}
              </div>
            {:else if step.type === 'launch'}
              <input
                type="text"
                placeholder="App path (e.g. /Applications/Safari.app)"
                value={step.config.path ?? ''}
                on:input={(e) => {
                  step.config = { ...step.config, path: e.currentTarget.value };
                  multiSteps = multiSteps;
                  pushLivePreview();
                }}
                class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
              />
            {:else if step.type === 'command'}
              <input
                type="text"
                placeholder="Shell command"
                value={step.config.command ?? ''}
                on:input={(e) => {
                  step.config = { ...step.config, command: e.currentTarget.value };
                  multiSteps = multiSteps;
                  pushLivePreview();
                }}
                class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
              />
            {:else if step.type === 'multimedia'}
              <select
                value={step.config.action ?? 'play-pause'}
                on:change={(e) => {
                  step.config = { ...step.config, action: e.currentTarget.value };
                  multiSteps = multiSteps;
                  pushLivePreview();
                }}
                class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
              >
                <option value="play-pause">Play / Pause</option>
                <option value="next">Next Track</option>
                <option value="prev">Previous Track</option>
                <option value="volume-up">Volume Up</option>
                <option value="volume-down">Volume Down</option>
                <option value="mute">Mute</option>
              </select>
            {:else if step.type === 'go-to-page'}
              <select
                value={step.config.pageId ?? ''}
                on:change={(e) => {
                  step.config = { ...step.config, pageId: e.currentTarget.value };
                  multiSteps = multiSteps;
                  pushLivePreview();
                }}
                class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
              >
                <option value="">— Select a page —</option>
                {#each availablePages as page (page.id)}
                  <option value={page.id}>{page.name}</option>
                {/each}
              </select>
            {:else if step.type === 'go-to-back'}
              <p class="text-[10px] text-[var(--color-text-muted)]">Navigate back to previous page.</p>
            {:else if step.type === 'switch-profile'}
              <select
                value={(step.config.profileId as string) ?? ''}
                on:change={(e) => {
                  step.config = { ...step.config, profileId: e.currentTarget.value };
                  multiSteps = multiSteps;
                  pushLivePreview();
                }}
                class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
              >
                <option value="">— Select a profile —</option>
                {#each $profiles as profile (profile.id)}
                  <option value={profile.id}>{profile.name}</option>
                {/each}
              </select>
            {:else if step.type === 'set-brightness'}
              <div class="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={(step.config.brightness as number) ?? 100}
                  on:input={(e) => {
                    step.config = { ...step.config, brightness: parseInt(e.currentTarget.value, 10) };
                    multiSteps = multiSteps;
                    pushLivePreview();
                  }}
                  class="flex-1 accent-[var(--color-accent)]"
                />
                <span class="text-[10px] text-[var(--color-text-muted)] w-8 text-right"
                  >{(step.config.brightness as number) ?? 100}%</span
                >
              </div>
            {:else if step.type.startsWith('plugin:')}
              {@const stepPluginId = step.type.slice(7)}
              {@const stepManifest = pluginManifests.find((m) => m.id === stepPluginId)}
              {#if stepManifest}
                <!-- Plugin action selector -->
                <select
                  value={(step.config.pluginAction as string) ?? Object.keys(stepManifest.actions)[0] ?? ''}
                  on:change={(e) => {
                    const newAction = e.currentTarget.value;
                    // Keep only pluginAction, clear old params
                    step.config = { pluginAction: newAction };
                    multiSteps = multiSteps;
                    pushLivePreview();
                  }}
                  class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                >
                  {#each Object.entries(stepManifest.actions) as [value, action] (value)}
                    <option {value}>{action.label}</option>
                  {/each}
                </select>

                <!-- Plugin action param fields -->
                {@const stepAction = (step.config.pluginAction as string) ?? Object.keys(stepManifest.actions)[0] ?? ''}
                {@const stepParams = stepManifest.actions[stepAction]?.params ?? {}}
                {#each Object.keys(stepParams) as paramKey (paramKey)}
                  {@const field = stepParams[paramKey]}
                  {#if field}
                    {#if field.type === 'text'}
                      <div>
                        <span class="text-[10px] text-[var(--color-text-muted)]">{field.label}</span>
                        <input
                          type="text"
                          value={step.config[field.key] ?? ''}
                          on:input={(e) => {
                            step.config = { ...step.config, [field.key]: e.currentTarget.value };
                            multiSteps = multiSteps;
                            pushLivePreview();
                          }}
                          placeholder={field.placeholder ?? ''}
                          class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                        />
                      </div>
                    {:else if field.type === 'number'}
                      <div>
                        <span class="text-[10px] text-[var(--color-text-muted)]">{field.label}</span>
                        <input
                          type="number"
                          value={step.config[field.key] ?? field.min ?? 0}
                          on:input={(e) => {
                            step.config = { ...step.config, [field.key]: Number(e.currentTarget.value) };
                            multiSteps = multiSteps;
                            pushLivePreview();
                          }}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                        />
                      </div>
                    {:else if field.type === 'boolean'}
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] text-[var(--color-text-muted)]">{field.label}</span>
                        <select
                          value={step.config[field.key] ?? false}
                          on:change={(e) => {
                            step.config = { ...step.config, [field.key]: e.currentTarget.value === 'true' };
                            multiSteps = multiSteps;
                            pushLivePreview();
                          }}
                          class="rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                        >
                          <option value={true}>Yes</option>
                          <option value={false}>No</option>
                        </select>
                      </div>
                    {:else if field.type === 'select'}
                      {@const dynKey = `${stepPluginId}:${field.dynamicOptionsQuery ?? ''}`}
                      {@const dynOpts = field.dynamicOptionsQuery ? (multiStepDynamicOptions[dynKey] ?? []) : []}
                      <div>
                        <span class="text-[10px] text-[var(--color-text-muted)]">{field.label}</span>
                        {#if dynOpts.length > 0}
                          <select
                            value={step.config[field.key] ?? ''}
                            on:change={(e) => {
                              step.config = { ...step.config, [field.key]: e.currentTarget.value };
                              multiSteps = multiSteps;
                              pushLivePreview();
                            }}
                            class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                          >
                            <option value="">— Select —</option>
                            {#each dynOpts as opt (opt.value)}
                              <option value={opt.value}>{opt.label}</option>
                            {/each}
                          </select>
                        {:else if field.options && field.options.length > 0}
                          <select
                            value={step.config[field.key] ?? ''}
                            on:change={(e) => {
                              step.config = { ...step.config, [field.key]: e.currentTarget.value };
                              multiSteps = multiSteps;
                              pushLivePreview();
                            }}
                            class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                          >
                            {#each field.options as opt (opt.value)}
                              <option value={opt.value}>{opt.label}</option>
                            {/each}
                          </select>
                        {:else}
                          <input
                            type="text"
                            value={step.config[field.key] ?? ''}
                            on:input={(e) => {
                              step.config = { ...step.config, [field.key]: e.currentTarget.value };
                              multiSteps = multiSteps;
                              pushLivePreview();
                            }}
                            placeholder={field.placeholder ?? `${field.label} (connect to browse)`}
                            class="w-full rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-1 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                          />
                        {/if}
                      </div>
                    {:else if field.type === 'range'}
                      <div>
                        <span class="text-[10px] text-[var(--color-text-muted)]">{field.label}</span>
                        <div class="flex items-center gap-2">
                          <input
                            type="range"
                            min={field.min ?? 0}
                            max={field.max ?? 100}
                            step={field.step ?? 1}
                            value={step.config[field.key] ?? field.min ?? 0}
                            on:input={(e) => {
                              step.config = { ...step.config, [field.key]: Number(e.currentTarget.value) };
                              multiSteps = multiSteps;
                              pushLivePreview();
                            }}
                            class="flex-1 accent-[var(--color-accent)]"
                          />
                          <span class="text-[10px] text-[var(--color-text-muted)] w-10 text-right">
                            {step.config[field.key] ?? field.min ?? 0}{field.suffix ?? ''}
                          </span>
                        </div>
                      </div>
                    {/if}
                  {/if}
                {/each}
              {:else}
                <p class="text-[10px] text-[var(--color-text-muted)]">Plugin not found: {stepPluginId}</p>
              {/if}
            {/if}

            <!-- Delay between steps -->
            {#if i < multiSteps.length - 1}
              <div class="flex items-center gap-1.5 pt-1 border-t border-[var(--color-border)]">
                <label for="step-delay-{i}" class="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap"
                  >Delay after:</label
                >
                <input
                  id="step-delay-{i}"
                  type="number"
                  min="0"
                  max="10000"
                  step="50"
                  bind:value={step.delayMs}
                  on:input={() => pushLivePreview()}
                  class="w-16 rounded-md bg-[var(--color-surface-1)] text-[var(--color-text-primary)] text-xs px-2 py-0.5 border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
                />
                <span class="text-[10px] text-[var(--color-text-muted)]">ms</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else if actionType.startsWith('plugin:')}
      <!-- Plugin Action Panel -->
      {#if activePluginManifest}
        <PluginActionPanel
          pluginId={activePluginId}
          manifest={activePluginManifest}
          bind:actionConfig={pluginActionConfig}
          pluginState={pluginStates[activePluginId] ?? null}
          onDirty={pushLivePreview}
          onActionChanged={onPluginActionChanged}
        />
      {/if}
    {/if}
  {/if}
  <!-- ═══════════ end ACTION TAB ═══════════ -->

  <!-- ═══════════ APPEARANCE TAB ═══════════ -->
  {#if panelTab === 'appearance' && !isKnobMode}
    <div class="space-y-3">
      <LayerList
        {layers}
        {selectedLayerId}
        {hasPluginAction}
        on:select={handleLayerSelect}
        on:toggle-visibility={handleToggleVisibility}
        on:toggle-lock={handleToggleLock}
        on:add={handleAddLayer}
        on:reorder={handleReorderLayers}
      />

      {#if selectedLayer}
        <LayerInspector
          layer={selectedLayer}
          pluginName={boundPluginManifest?.name ?? 'plugin'}
          onChange={handleLayerChange}
          onInput={handleLayerInput}
          onPickIcon={handlePickIcon}
          onPickImage={handlePickImage}
          onRemoveImage={handleRemoveImage}
          onDelete={handleDeleteLayer}
          onDuplicate={handleDuplicateLayer}
        />
      {:else}
        <p class="text-xs text-center text-[var(--color-text-muted)] py-4">Select a layer to edit its properties</p>
      {/if}
    </div>
  {/if}
  <!-- ═══════════ end APPEARANCE TAB ═══════════ -->

  <IconPicker
    visible={showIconPicker}
    pluginIconPacks={allPluginIconPacks}
    onSelect={(dataUri) => {
      if (selectedLayer?.type === 'image') {
        updateLayerInPlace(selectedLayer.id, { dataUri } as Partial<ImageLayer>);
        pushLivePreview();
      }
      showIconPicker = false;
    }}
    onClose={() => (showIconPicker = false)}
  />

  <!-- Action buttons -->
  <div class="flex flex-col gap-2 pt-2 border-t border-[var(--color-border)]">
    {#if isDirty}
      <p class="text-[10px] text-[var(--color-warning)] text-center">Unsaved changes</p>
    {/if}
    <div class="flex gap-2">
      <button
        on:click={saveAction}
        class="flex-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium py-2 px-4 rounded-md transition-colors"
      >
        Save
      </button>
      <button
        on:click={revertAction}
        disabled={!isDirty}
        class="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] text-sm py-2 px-3 rounded-md border border-[var(--color-border)] transition-colors
               disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Revert
      </button>
      <button
        on:click={clearAll}
        class="bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] text-sm py-2 px-3 rounded-md border border-[var(--color-border)] transition-colors"
      >
        Clear
      </button>
    </div>
  </div>
</div>
