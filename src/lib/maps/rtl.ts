/**
 * MapLibre renders Hebrew/Arabic map labels LTR (reversed) unless the
 * mapbox-gl-rtl-text plugin is registered via setRTLTextPlugin.
 * @see https://maplibre.org/maplibre-gl-js/docs/examples/add-support-for-right-to-left-scripts/
 *
 * Important: after `map.remove()` (React StrictMode remount, route leave),
 * MapLibre terminates idle WebWorkers while the main-thread RTL status stays
 * `"loaded"`. New workers never receive the plugin unless we re-broadcast.
 */
export const MAP_RTL_TEXT_PLUGIN_URL =
  'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js';

/** Same-origin copy under apps/web/public (preferred for the PWA). */
export const MAP_RTL_TEXT_PLUGIN_LOCAL_PATH = 'map/mapbox-gl-rtl-text.js';

export type MapLibreRtlHost = {
  setRTLTextPlugin: (
    pluginURL: string,
    lazy: boolean,
  ) => Promise<void> | void;
  getRTLTextPluginStatus?: () => string;
  /** Present on maplibre-gl default export; typed loosely for version skew. */
  getGlobalDispatcher?: () => unknown;
  importScriptInWorkers?: (workerUrl: string) => Promise<unknown>;
};

/** Dynamic `import('maplibre-gl')` may put the API on `.default`. */
export type MapLibreRtlModule = MapLibreRtlHost | { default: MapLibreRtlHost };

let rtlPluginRequested = false;
let rtlPluginUrl: string | null = null;

/**
 * Prefer `.default` so the plugin is registered on the same object used for `new Map()`.
 */
export function resolveMapLibreRtlHost(
  maplibre: MapLibreRtlModule,
): MapLibreRtlHost {
  const nested = (maplibre as { default?: MapLibreRtlHost }).default;
  if (nested && typeof nested.setRTLTextPlugin === 'function') {
    return nested;
  }
  if (
    maplibre &&
    typeof (maplibre as MapLibreRtlHost).setRTLTextPlugin === 'function'
  ) {
    return maplibre as MapLibreRtlHost;
  }
  throw new Error('ensureMapRtlTextPlugin: invalid maplibre host');
}

/** Build an absolute plugin URL (workers reject bare relative paths). */
export function resolveMapRtlPluginUrl(urlOrPath?: string): string {
  const raw = urlOrPath ?? MAP_RTL_TEXT_PLUGIN_URL;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('blob:')) {
    return raw;
  }
  if (typeof window !== 'undefined' && window.location?.href) {
    return new URL(raw, window.location.href).href;
  }
  return raw;
}

async function waitForRtlPlugin(
  host: MapLibreRtlHost,
  timeoutMs = 8000,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = host.getRTLTextPluginStatus?.() ?? 'unavailable';
    if (status === 'loaded' || status === 'error') {
      return status;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return host.getRTLTextPluginStatus?.() ?? 'unavailable';
}

/**
 * Push the RTL plugin into the current worker pool.
 * Safe to call after map.create / after workers were recycled.
 */
export async function resyncMapRtlTextPlugin(
  maplibre: MapLibreRtlModule,
  url?: string,
): Promise<string> {
  const host = resolveMapLibreRtlHost(maplibre);
  const pluginURL = resolveMapRtlPluginUrl(
    url ?? rtlPluginUrl ?? MAP_RTL_TEXT_PLUGIN_URL,
  );
  rtlPluginUrl = pluginURL;

  const dispatcher = host.getGlobalDispatcher?.() as
    | {
        broadcast?: (
          type: string,
          data: { pluginStatus: string; pluginURL: string },
        ) => Promise<unknown>;
      }
    | undefined;
  if (dispatcher && typeof dispatcher.broadcast === 'function') {
    // Same sequence MapLibre uses in RTLTextPlugin._requestImport.
    await dispatcher.broadcast('SRPS', {
      pluginStatus: 'loading',
      pluginURL,
    });
    await dispatcher.broadcast('SRPS', {
      pluginStatus: 'loaded',
      pluginURL,
    });
    return host.getRTLTextPluginStatus?.() ?? 'loaded';
  }

  if (typeof host.importScriptInWorkers === 'function') {
    await host.importScriptInWorkers(pluginURL);
    return host.getRTLTextPluginStatus?.() ?? 'loaded';
  }

  throw new Error(
    'resyncMapRtlTextPlugin: no getGlobalDispatcher/importScriptInWorkers',
  );
}

/**
 * Register the RTL text shaping plugin once (safe to call from multiple mounts).
 * Default lazy=false so Hebrew/Arabic labels are correct on first paint.
 * When status is already `"loaded"`, re-syncs into current workers (StrictMode /
 * remount safe).
 */
export async function ensureMapRtlTextPlugin(
  maplibre: MapLibreRtlModule,
  options?: { url?: string; lazy?: boolean },
): Promise<string> {
  const host = resolveMapLibreRtlHost(maplibre);
  const url = resolveMapRtlPluginUrl(options?.url ?? MAP_RTL_TEXT_PLUGIN_URL);
  const lazy = options?.lazy ?? false;

  const status = host.getRTLTextPluginStatus?.();
  if (status === 'loaded') {
    // Main thread remembers "loaded", but workers may be brand new.
    await resyncMapRtlTextPlugin(host, url);
    return host.getRTLTextPluginStatus?.() ?? 'loaded';
  }
  if (status === 'loading' || status === 'deferred') {
    const waited = await waitForRtlPlugin(host);
    if (waited === 'loaded') {
      await resyncMapRtlTextPlugin(host, url);
    }
    return waited;
  }
  if (rtlPluginRequested) {
    const waited = await waitForRtlPlugin(host);
    if (waited === 'loaded') {
      await resyncMapRtlTextPlugin(host, url);
    }
    return waited;
  }

  rtlPluginRequested = true;
  rtlPluginUrl = url;

  try {
    await Promise.resolve(host.setRTLTextPlugin(url, lazy));
    if (lazy) {
      return host.getRTLTextPluginStatus?.() ?? 'deferred';
    }
    const finalStatus = await waitForRtlPlugin(host);
    if (finalStatus === 'error' || finalStatus === 'unavailable') {
      rtlPluginRequested = false;
      throw new Error(`RTL text plugin failed to load (status=${finalStatus})`);
    }
    // Ensure workers that spun up around Map() construction also have the plugin.
    await resyncMapRtlTextPlugin(host, url);
    return host.getRTLTextPluginStatus?.() ?? finalStatus;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // MapLibre throws if the plugin was already configured in this page.
    if (/already|plugin/i.test(message) && !/failed to load/i.test(message)) {
      await resyncMapRtlTextPlugin(host, url);
      return waitForRtlPlugin(host);
    }
    rtlPluginRequested = false;
    throw err;
  }
}

/** Test helper — reset module latch between unit tests. */
export function resetMapRtlTextPluginForTests(): void {
  rtlPluginRequested = false;
  rtlPluginUrl = null;
}
