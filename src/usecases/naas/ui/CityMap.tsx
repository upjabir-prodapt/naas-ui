import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre loads its tile-parsing worker from a URL it computes at runtime as
// `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Vite cannot see that
// through the string concatenation, so it never emits the worker as an asset
// and the production bundle asks for `/assets/maplibre-gl-worker.mjs`, which
// does not exist. The failure is silent and partial: the style, the source
// TileJSON and the sprites all load on the main thread, so the map mounts and
// then stays blank because no worker ever parses a vector tile. It does not
// reproduce in `npm run dev` — `optimizeDeps.exclude: ['maplibre-gl']` in
// vite.config.ts leaves the package unbundled, so the runtime-computed URL
// happens to resolve to the real file inside node_modules.
//
// `?worker&url` makes the dependency explicit: Vite bundles the worker (with
// its own copy of maplibre-gl-shared.mjs, which is how MapLibre ships it
// anyway) and hands back the hashed, emitted URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import './CityMap.css';

setWorkerUrl(workerUrl);

// Any agent's "one or two points on a map" need — Service Observability's
// circuit endpoints (real city always known) and Service Order's ports
// (city sometimes still unknown, e.g. a brand-new port before geocoding
// resolves) both fit this same shape structurally, so neither needs its
// own separate type. `color` lets a caller distinguish two points visually
// (e.g. source vs. destination) — omitted, both points fall back to this
// app's accent color, preserving every existing caller's current look
// exactly.
export interface CityMapPoint {
  latitude: number;
  longitude: number;
  city?: string;
  color?: string;
}

// Vector basemap via OpenFreeMap (client-requested, replacing the raw OSM
// raster tiles this used previously) — free, MIT-licensed, no API key or
// request limits (https://openfreemap.org). "Positron" is the specific
// style the client picked. Attribution is required by OpenFreeMap's terms
// (OpenMapTiles + OpenStreetMap) — shown as a plain always-visible line
// (see .city-map-attribution below) rather than MapLibre's own click-to-
// expand control, which read as an unnecessary toggle on a widget this
// small.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const MIN_ZOOM = 2;
// Capped at city scale rather than street level — the two endpoints are
// occasionally in the same city (or even building), and there's nothing
// more useful to show by zooming in past this.
const MAX_ZOOM = 13;
// The two-point fit (see FIT_PADDING_RATIO below) is capped lower than
// MAX_ZOOM — even when the two points sit close together, the view should
// still pull back enough to show surrounding country/region context, not
// zoom in tight just because it technically could.
const FIT_MAX_ZOOM = 9;
// Used only as a bare fallback when a caller renders without width/height
// props at all — both the Service Observability Agent's panel (dynamically
// measured via ResizeObserver, since its map is full-width in a
// user-resizable split) and the Service Reliability Agent's panel (a fixed
// size tuned for its own layout) always pass their own explicit width/
// height instead.
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 170;
// Fraction of width/height fitBounds reserves as margin on *each* side —
// e.g. 0.25 means the two points span at most the middle 50% of the box,
// leaving generous room for surrounding geography/country labels instead
// of cropping tight to just the two markers.
const FIT_PADDING_RATIO = 0.25;
// Fixed zoom for the single-point case (only `from` or only `to` given,
// e.g. one side of a Connection order not resolved yet) — there's no
// second point to fit bounds against, so this is just a reasonable
// city-level view centered on the one point that exists.
const SINGLE_POINT_ZOOM = 9;
// CityMap's own fallback center/zoom for the defensive case where a caller
// renders it with neither `from` nor `to` set (every current caller
// already avoids this — see the early `return null` below — but the mount
// effect still needs some starting view before that check runs). Roughly
// centered over Europe/Africa so several continents would be visible at
// once, same as the old standalone WorldMap component this replaced.
const WORLD_CENTER: [number, number] = [10, 15];
const WORLD_ZOOM = 2;

const ROUTE_SOURCE_ID = 'city-map-route';
const ROUTE_LAYER_ID = 'city-map-route-line';

const DEFAULT_MARKER_COLOR = 'var(--text-teal)';

// The route line is drawn as a GL layer (not CSS/SVG), so its color has to
// be a resolved value, not a CSS custom property reference — read the
// live value (respects the current light/dark theme) with a sane fallback
// for the rare case this runs before the stylesheet has applied.
function accentColor(): string {
  if (typeof window === 'undefined') return '#00a59b';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--text-teal').trim();
  return value || '#00a59b';
}

function createMap(container: HTMLDivElement, center: [number, number], zoom: number): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: STYLE_URL,
    center,
    zoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // These are small, non-interactive route illustrations (like the old
    // hand-drawn tiles were), not a map the user is meant to pan/zoom.
    interactive: false,
    // No built-in control — see .city-map-attribution's plain-text
    // attribution rendered in JSX instead.
    attributionControl: false,
  });
  return map;
}

function createMarkerElement(point: CityMapPoint): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'city-map-marker';
  el.style.setProperty('--city-map-marker-color', point.color ?? DEFAULT_MARKER_COLOR);
  el.innerHTML = '<span class="city-map-marker-ring"></span><span class="city-map-marker-dot"></span>';

  if (point.city) {
    const label = document.createElement('span');
    label.className = 'city-map-city-label';
    label.textContent = point.city;
    el.appendChild(label);
  }

  return el;
}

// Plain, always-visible attribution line — OpenFreeMap's terms require
// crediting OpenMapTiles and OpenStreetMap; rendered directly (not behind
// MapLibre's default click-to-expand control) since there's nothing here
// worth hiding behind a toggle.
function MapAttribution() {
  return (
    <span className="city-map-attribution">
      <a href="https://openfreemap.org" target="_blank" rel="noreferrer">
        OpenFreeMap
      </a>{' '}
      ©{' '}
      <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
        OpenMapTiles
      </a>{' '}
      · Data from{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        OpenStreetMap
      </a>
    </span>
  );
}

interface SizeProps {
  width?: number;
  height?: number;
}

// Rendered in the route map's place while it's still loading, or while
// there's no target circuit yet — same outer card + exact same box size
// as whichever real map will replace it, so surrounding layout never
// reflows once real content arrives a beat later. Callers use the shared
// InfoCanvasPlaceholder (components/InfoCanvasPlaceholder.tsx), not a map
// component, for the "nothing to plot at all yet" case.
export function CityMapLoading({ width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }: SizeProps) {
  return (
    <div className="city-map-card">
      <div className="city-map" style={{ width, height }}>
        <div className="city-map-loading">
          <span className="city-map-loading-dot" />
          <span className="city-map-loading-dot" />
          <span className="city-map-loading-dot" />
        </div>
      </div>
    </div>
  );
}

interface CityMapProps extends SizeProps {
  // Either can be omitted — e.g. a Connection order where only one side
  // has resolved to a real port/coordinate yet. Renders nothing at all
  // (not an empty box) if neither is given; the caller decides what to
  // show instead (CityMapLoading, InfoCanvasPlaceholder, or simply
  // nothing).
  from?: CityMapPoint;
  to?: CityMapPoint;
  // Keep the basemap mounted while a selected circuit's route is loading.
  showWithoutPoints?: boolean;
  loading?: boolean;
}

export default function CityMap({
  from,
  to,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  showWithoutPoints = false,
  loading = false,
}: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const only = from ?? to;
    const center: [number, number] = only ? [only.longitude, only.latitude] : WORLD_CENTER;
    const zoom = only ? SINGLE_POINT_ZOOM : WORLD_ZOOM;
    const map = createMap(containerRef.current, center, zoom);
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Only the very first from/to (at mount) seed the initial center/zoom —
    // every later change is handled by the render effect below via
    // fitBounds/setCenter, not by recreating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.resize();
  }, [width, height]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function render() {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      if (map!.getLayer(ROUTE_LAYER_ID)) map!.removeLayer(ROUTE_LAYER_ID);
      if (map!.getSource(ROUTE_SOURCE_ID)) map!.removeSource(ROUTE_SOURCE_ID);

      if (!from && !to) return;

      if (from && to) {
        map!.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: [
                [from.longitude, from.latitude],
                [to.longitude, to.latitude],
              ],
            },
          },
        });
        map!.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          paint: { 'line-color': accentColor(), 'line-width': 3.5 },
        });

        const bounds = new LngLatBounds([from.longitude, from.latitude], [from.longitude, from.latitude]);
        bounds.extend([to.longitude, to.latitude]);
        const padding = {
          top: height * FIT_PADDING_RATIO,
          bottom: height * FIT_PADDING_RATIO,
          left: width * FIT_PADDING_RATIO,
          right: width * FIT_PADDING_RATIO,
        };
        map!.fitBounds(bounds, { padding, maxZoom: FIT_MAX_ZOOM, duration: 0 });
      } else {
        const only = (from ?? to)!;
        map!.jumpTo({ center: [only.longitude, only.latitude], zoom: SINGLE_POINT_ZOOM });
      }

      (
        [
          from ? { key: 'from' as const, data: from } : null,
          to ? { key: 'to' as const, data: to } : null,
        ].filter(Boolean) as { key: 'from' | 'to'; data: CityMapPoint }[]
      ).forEach(({ data }) => {
        const marker = new Marker({ element: createMarkerElement(data), anchor: 'center' })
          .setLngLat([data.longitude, data.latitude])
          .addTo(map!);
        markersRef.current.push(marker);
      });
    }

    if (map.isStyleLoaded()) {
      render();
    } else {
      map.once('load', render);
    }
    return () => {
      map.off('load', render);
    };
  }, [from, to, width, height]);

  if (!from && !to && !showWithoutPoints) return null;

  return (
    <div className="city-map-card">
      <div className="city-map" style={{ width, height }}>
        <div ref={containerRef} className="city-map-canvas" />
        <MapAttribution />
        {loading && (
          <div
            className="city-map-loading city-map-loading--overlay"
            role="status"
            aria-label="Loading map route"
          >
            <span className="city-map-loading-dot" />
            <span className="city-map-loading-dot" />
            <span className="city-map-loading-dot" />
          </div>
        )}
      </div>
    </div>
  );
}
