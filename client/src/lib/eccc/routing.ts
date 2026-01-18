import { loadCaPlaces, type Place } from '@/lib/caPlacesLookup';
import type { FeedIds, RoutingRecord } from './types';

type FeedMapping = {
  locationKeyByPlaceId?: Record<number, string>;
  areaKeyByPlaceId?: Record<number, string>;
  feedIdsByLocationKey?: Record<string, FeedIds>;
  datasetName?: string;
  datasetVersion?: string;
};

export type PolygonResolver = (lat: number, lon: number) => {
  location_keys: string[];
  area_keys: string[];
  feed_ids: FeedIds;
  marine_relevance?: boolean;
} | null;

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function deriveLocationKey(place: Place, mapping?: FeedMapping): string {
  const mapped = mapping?.locationKeyByPlaceId?.[place.id];
  if (mapped) return mapped;
  return place.keys?.[0] ?? `${place.prov}-${place.id}`;
}

function deriveAreaKey(place: Place, mapping?: FeedMapping): string {
  const mapped = mapping?.areaKeyByPlaceId?.[place.id];
  if (mapped) return mapped;
  return place.keys?.[0] ?? `${place.prov}-${place.id}`;
}

function deriveFeedIds(locationKey: string, mapping?: FeedMapping): FeedIds {
  if (mapping?.feedIdsByLocationKey?.[locationKey]) {
    return mapping.feedIdsByLocationKey[locationKey];
  }
  return {
    cap_alerts: locationKey,
    statements: locationKey,
    forecast_api: locationKey,
    forecast_rss: locationKey,
    conditions_api: locationKey
  };
}

export async function routeByNearestCity(
  lat: number,
  lon: number,
  mapping?: FeedMapping
): Promise<RoutingRecord> {
  const store = await loadCaPlaces();
  const places = Array.from(store.placesById.values());
  let nearest: Place | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const place of places) {
    const distance = haversineKm(lat, lon, place.lat, place.lon);
    if (distance < nearestDistance) {
      nearest = place;
      nearestDistance = distance;
    }
  }

  if (!nearest) {
    throw new Error('No Canadian places available for routing.');
  }

  const locationKey = deriveLocationKey(nearest, mapping);
  const areaKey = deriveAreaKey(nearest, mapping);
  const feedIds = deriveFeedIds(locationKey, mapping);

  const id = hashString(`${lat.toFixed(4)}|${lon.toFixed(4)}|${locationKey}|${areaKey}`);

  return {
    id,
    created_at: new Date().toISOString(),
    lat,
    lon,
    method: 'reverse_geocode',
    location_keys: [locationKey],
    area_keys: [areaKey],
    feed_ids: feedIds,
    source_dataset: {
      name: mapping?.datasetName ?? 'ca_places',
      version: mapping?.datasetVersion ?? 'unknown'
    },
    distance_km: Math.round(nearestDistance * 10) / 10,
    marine_relevance: false
  };
}

export async function routeByPolygon(
  lat: number,
  lon: number,
  resolver: PolygonResolver
): Promise<RoutingRecord | null> {
  const result = resolver(lat, lon);
  if (!result) return null;
  const id = hashString(`${lat.toFixed(4)}|${lon.toFixed(4)}|polygon|${result.area_keys.join(',')}`);

  return {
    id,
    created_at: new Date().toISOString(),
    lat,
    lon,
    method: 'polygon',
    location_keys: result.location_keys,
    area_keys: result.area_keys,
    feed_ids: result.feed_ids,
    source_dataset: {
      name: 'polygon_dataset',
      version: 'unknown'
    },
    marine_relevance: result.marine_relevance ?? false
  };
}

export async function routeLocation(
  lat: number,
  lon: number,
  opts: {
    polygonResolver?: PolygonResolver;
    mapping?: FeedMapping;
  } = {}
): Promise<RoutingRecord> {
  if (opts.polygonResolver) {
    const polygonRecord = await routeByPolygon(lat, lon, opts.polygonResolver);
    if (polygonRecord) return polygonRecord;
  }
  return routeByNearestCity(lat, lon, opts.mapping);
}

