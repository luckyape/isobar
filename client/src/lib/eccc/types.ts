export type ReadableKind =
  | 'statement'
  | 'forecast_text'
  | 'conditions_text'
  | 'marine'
  | 'discussion'
  | 'misc_official';

export type ReadableItem = {
  id: string;
  authority: 'ECCC';
  kind: ReadableKind;
  location_keys: string[];
  issued_at: string;
  title: string;
  body_text: string;
  source_url: string;
  raw_ref: string;
  tags?: string[];
  summary_1line?: string | null;
  summary_3line?: string | null;
};

export type AlertItem = {
  id: string;
  authority: 'ECCC';
  kind: 'alert';
  location_keys: string[];
  sent_at: string;
  effective?: string;
  onset?: string;
  expires: string;
  msg_type: 'Alert' | 'Update' | 'Cancel';
  status: 'Actual' | string;
  event: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  source_url: string;
  raw_ref: string;
};

export type FeedIds = {
  cap_alerts?: string;
  statements?: string;
  forecast_api?: string;
  forecast_rss?: string;
  conditions_api?: string;
  marine_rss?: string;
  discussion_rss?: string;
  misc_rss?: string;
};

export type RoutingRecord = {
  id: string;
  created_at: string;
  lat: number;
  lon: number;
  method: 'reverse_geocode' | 'polygon';
  location_keys: string[];
  area_keys: string[];
  feed_ids: FeedIds;
  source_dataset: {
    name: string;
    version: string;
  };
  distance_km?: number;
  marine_relevance?: boolean;
};

export type NormalizedAlert = AlertItem & {
  cap_identifier?: string;
  references?: string[];
  area_key?: string;
};

export type NormalizedReadable = ReadableItem & {
  _source_rank?: number;
};

export type CollectionResult<T> = {
  items: T[];
  from_cache: boolean;
};

