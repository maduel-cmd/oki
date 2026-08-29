import type {
  FamilyCompound,
  FamilyZone,
  LatLng,
} from '@oki/domain';
import {
  DEFAULT_MAP_STYLE,
  ensureMapRtlTextPlugin,
} from '@oki/maps';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapMouseEvent,
  type Marker,
} from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import 'maplibre-gl/dist/maplibre-gl.css';

/** Fallback when GPS is not ready yet (central Israel). */
const FALLBACK_CENTER: LatLng = { lat: 31.7683, lng: 35.2137 };
const FALLBACK_ZOOM = 14;
const USER_ZOOM = 16;

const ZONES_SOURCE = 'oki-zones';
const ZONES_FILL = 'oki-zones-fill';
const ZONES_LINE = 'oki-zones-line';
const COMPOUNDS_SOURCE = 'oki-compounds';
const COMPOUNDS_FILL = 'oki-compounds-fill';
const COMPOUNDS_LINE = 'oki-compounds-line';
const DRAFT_SOURCE = 'oki-draft';
const DRAFT_FILL = 'oki-draft-fill';
const DRAFT_LINE = 'oki-draft-line';
const DRAFT_POINTS = 'oki-draft-points';
const PINS_SOURCE = 'oki-pins';
const PINS_LAYER = 'oki-pins-layer';

export type SharedPin = {
  id: string;
  label: string;
  position: LatLng;
};

export type FamilyMapDrawMode = 'none' | 'zone' | 'compound';

type Props = {
  center: LatLng | null;
  self: LatLng | null;
  zones: FamilyZone[];
  /** Parent-only closed enclosures. Pass [] for non-admins. */
  compounds?: FamilyCompound[];
  /** Vertices while drawing a new compound (not yet closed). */
  draftRing?: LatLng[];
  sharedPins?: SharedPin[];
  /** Admin: allow tapping the map to place zones / compounds. */
  interactive?: boolean;
  drawMode?: FamilyMapDrawMode;
  onMapPick?: (pos: LatLng) => void;
  /** Admin: tap an existing compound to remove it. */
  onCompoundClick?: (compoundId: string) => void;
};

function circlePolygon(
  center: LatLng,
  radiusM: number,
  steps = 64,
): GeoJSON.Polygon {
  const coords: [number, number][] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latRad);
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(bearing)) / metersPerDegLat;
    const dLng = (radiusM * Math.sin(bearing)) / metersPerDegLng;
    coords.push([center.lng + dLng, center.lat + dLat]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

function zonesToFeatureCollection(zones: FamilyZone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      properties: {
        id: z.id,
        name: z.name,
        forceAudio: z.forceAudio,
      },
      geometry: circlePolygon(z.center, z.radiusM),
    })),
  };
}

function compoundsToFeatureCollection(
  compounds: FamilyCompound[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: compounds
      .filter((c) => c.ring.length >= 3)
      .map((c) => {
        const ring = c.ring.map((p) => [p.lng, p.lat] as [number, number]);
        const first = ring[0]!;
        const last = ring[ring.length - 1]!;
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([...first] as [number, number]);
        }
        return {
          type: 'Feature' as const,
          properties: { id: c.id, name: c.name },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring],
          },
        };
      }),
  };
}

function draftToFeatureCollection(draft: LatLng[]): GeoJSON.FeatureCollection {
  if (draft.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  const coords = draft.map((p) => [p.lng, p.lat] as [number, number]);
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: { kind: 'points' },
      geometry: { type: 'MultiPoint', coordinates: coords },
    },
  ];
  if (draft.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'path' },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  if (draft.length >= 3) {
    const closed = [...coords, coords[0]!];
    features.push({
      type: 'Feature',
      properties: { kind: 'fill' },
      geometry: { type: 'Polygon', coordinates: [closed] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function pinsToFeatureCollection(pins: SharedPin[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pins.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, label: p.label },
      geometry: {
        type: 'Point',
        coordinates: [p.position.lng, p.position.lat],
      },
    })),
  };
}

function ensureOverlayLayers(map: MapLibreMap): void {
  if (!map.getSource(ZONES_SOURCE)) {
    map.addSource(ZONES_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(ZONES_FILL)) {
    map.addLayer({
      id: ZONES_FILL,
      type: 'fill',
      source: ZONES_SOURCE,
      paint: {
        'fill-color': [
          'case',
          ['get', 'forceAudio'],
          '#e8a317',
          '#0b3d3d',
        ],
        'fill-opacity': 0.28,
      },
    });
  }
  if (!map.getLayer(ZONES_LINE)) {
    map.addLayer({
      id: ZONES_LINE,
      type: 'line',
      source: ZONES_SOURCE,
      paint: {
        'line-color': [
          'case',
          ['get', 'forceAudio'],
          '#c9850f',
          '#0b3d3d',
        ],
        'line-width': 2,
      },
    });
  }

  if (!map.getSource(COMPOUNDS_SOURCE)) {
    map.addSource(COMPOUNDS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(COMPOUNDS_FILL)) {
    map.addLayer({
      id: COMPOUNDS_FILL,
      type: 'fill',
      source: COMPOUNDS_SOURCE,
      paint: {
        'fill-color': '#1a5c8a',
        'fill-opacity': 0.22,
      },
    });
  }
  if (!map.getLayer(COMPOUNDS_LINE)) {
    map.addLayer({
      id: COMPOUNDS_LINE,
      type: 'line',
      source: COMPOUNDS_SOURCE,
      paint: {
        'line-color': '#145a8a',
        'line-width': 2.5,
      },
    });
  }

  if (!map.getSource(DRAFT_SOURCE)) {
    map.addSource(DRAFT_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(DRAFT_FILL)) {
    map.addLayer({
      id: DRAFT_FILL,
      type: 'fill',
      source: DRAFT_SOURCE,
      filter: ['==', ['get', 'kind'], 'fill'],
      paint: {
        'fill-color': '#145a8a',
        'fill-opacity': 0.18,
      },
    });
  }
  if (!map.getLayer(DRAFT_LINE)) {
    map.addLayer({
      id: DRAFT_LINE,
      type: 'line',
      source: DRAFT_SOURCE,
      filter: ['==', ['get', 'kind'], 'path'],
      paint: {
        'line-color': '#0b3d3d',
        'line-width': 2,
        'line-dasharray': [1.5, 1.2],
      },
    });
  }
  if (!map.getLayer(DRAFT_POINTS)) {
    map.addLayer({
      id: DRAFT_POINTS,
      type: 'circle',
      source: DRAFT_SOURCE,
      filter: ['==', ['get', 'kind'], 'points'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#0b3d3d',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
  }

  if (!map.getSource(PINS_SOURCE)) {
    map.addSource(PINS_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(PINS_LAYER)) {
    map.addLayer({
      id: PINS_LAYER,
      type: 'circle',
      source: PINS_SOURCE,
      paint: {
        'circle-radius': 7,
        'circle-color': '#2a7a6a',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
  }
}

function setSourceData(
  map: MapLibreMap,
  sourceId: string,
  data: GeoJSON.FeatureCollection,
): void {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  src?.setData(data);
}

function createSelfMarkerEl(label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'oki-map-self-marker';
  el.innerHTML = `<span class="oki-map-self-dot"></span><span class="oki-map-self-label">${label}</span>`;
  return el;
}

export function FamilyGeoMap({
  center,
  self,
  zones,
  compounds = [],
  draftRing = [],
  sharedPins = [],
  interactive = false,
  drawMode = 'none',
  onMapPick,
  onCompoundClick,
}: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const selfMarkerRef = useRef<Marker | null>(null);
  const onMapPickRef = useRef(onMapPick);
  const onCompoundClickRef = useRef(onCompoundClick);
  const drawModeRef = useRef(drawMode);
  const interactiveRef = useRef(interactive);
  onMapPickRef.current = onMapPick;
  onCompoundClickRef.current = onCompoundClick;
  drawModeRef.current = drawMode;
  interactiveRef.current = interactive;

  // Init map once
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    let map: MapLibreMap | null = null;

    void (async () => {
      try {
        await ensureMapRtlTextPlugin(maplibregl);
      } catch (err) {
        console.warn('[Oki] RTL map plugin', err);
      }
      if (cancelled || !containerRef.current) return;

      const start = center ?? self ?? FALLBACK_CENTER;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: DEFAULT_MAP_STYLE.styleUrl,
        center: [start.lng, start.lat],
        zoom: self || center ? USER_ZOOM : FALLBACK_ZOOM,
        attributionControl: { compact: true },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
      mapRef.current = map;

      map.on('load', () => {
        if (!map) return;
        ensureOverlayLayers(map);
        setSourceData(map, ZONES_SOURCE, zonesToFeatureCollection(zones));
        setSourceData(map, COMPOUNDS_SOURCE, compoundsToFeatureCollection(compounds));
        setSourceData(map, DRAFT_SOURCE, draftToFeatureCollection(draftRing));
        setSourceData(map, PINS_SOURCE, pinsToFeatureCollection(sharedPins));
      });

      map.on('click', (e: MapMouseEvent) => {
        const mode = drawModeRef.current;
        if (mode !== 'none') {
          onMapPickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          return;
        }
        if (!interactiveRef.current || !onCompoundClickRef.current) return;
        const hits = map!.queryRenderedFeatures(e.point, {
          layers: [COMPOUNDS_FILL, COMPOUNDS_LINE],
        });
        const id = hits[0]?.properties?.id;
        if (typeof id === 'string' && id) {
          onCompoundClickRef.current(id);
        }
      });
    })();

    return () => {
      cancelled = true;
      selfMarkerRef.current?.remove();
      selfMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  // Cursor for draw / delete modes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    if (interactive && drawMode !== 'none') {
      canvas.style.cursor = 'crosshair';
    } else if (interactive && compounds.length > 0) {
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = '';
    }
  }, [interactive, drawMode, compounds.length]);

  // Sync overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      ensureOverlayLayers(map);
      setSourceData(map, ZONES_SOURCE, zonesToFeatureCollection(zones));
      setSourceData(map, COMPOUNDS_SOURCE, compoundsToFeatureCollection(compounds));
      setSourceData(map, DRAFT_SOURCE, draftToFeatureCollection(draftRing));
      setSourceData(map, PINS_SOURCE, pinsToFeatureCollection(sharedPins));
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [zones, compounds, draftRing, sharedPins]);

  // Self marker + follow GPS
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pos = self ?? center;
    if (!pos) {
      selfMarkerRef.current?.remove();
      selfMarkerRef.current = null;
      return;
    }

    if (!selfMarkerRef.current) {
      selfMarkerRef.current = new maplibregl.Marker({
        element: createSelfMarkerEl(t('family.mapYou')),
        anchor: 'bottom',
      })
        .setLngLat([pos.lng, pos.lat])
        .addTo(map);
    } else {
      selfMarkerRef.current.setLngLat([pos.lng, pos.lat]);
    }

    map.easeTo({
      center: [pos.lng, pos.lat],
      zoom: Math.max(map.getZoom(), USER_ZOOM - 1),
      duration: 600,
    });
  }, [self, center, t]);

  const emptyGps = !self && !center;

  return (
    <div
      className={`oki-geo-map${drawMode !== 'none' ? ' oki-geo-map--drawing' : ''}`}
    >
      <div
        ref={containerRef}
        className="oki-geo-map-canvas"
        role="application"
        aria-label={t('family.mapTitle')}
      />
      {emptyGps ? (
        <p className="oki-muted oki-geo-map-banner">{t('family.mapNoGps')}</p>
      ) : null}
      {drawMode === 'zone' ? (
        <p className="oki-geo-map-banner oki-geo-map-banner--draw" role="status">
          {t('family.mapTapZone')}
        </p>
      ) : null}
      {drawMode === 'compound' ? (
        <p className="oki-geo-map-banner oki-geo-map-banner--draw" role="status">
          {t('family.mapTapCompound')}
        </p>
      ) : null}
      {interactive && drawMode === 'none' && compounds.length > 0 ? (
        <p className="oki-muted oki-geo-caption">{t('family.mapTapCompoundRemove')}</p>
      ) : null}
      <p className="oki-muted oki-geo-caption">
        {t('family.mapOsmHint')} · {DEFAULT_MAP_STYLE.attribution}
      </p>
    </div>
  );
}
