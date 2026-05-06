import type { PluginPackage } from '../../shared/plugin-types';
import { manifest } from './manifest';
import { createClient } from './client';

export const discordPlugin: PluginPackage = {
  manifest: manifest,
  createClient
};
