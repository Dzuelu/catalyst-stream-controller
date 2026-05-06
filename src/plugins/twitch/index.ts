import type { PluginPackage } from '../../shared/plugin-types';
import { manifest } from './manifest';
import { createClient } from './client';

/**
 * Twitch plugin package — the single import point used by the
 * main process to register this plugin with the PluginRegistry.
 */
export const twitchPlugin: PluginPackage = {
  manifest,
  createClient
};
