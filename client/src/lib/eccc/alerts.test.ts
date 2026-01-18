import { describe, expect, it } from 'vitest';
import type { NormalizedAlert } from './types';
import { mergeAlertChain, filterActiveAlerts } from './alerts';

function buildAlert(overrides: Partial<NormalizedAlert> = {}): NormalizedAlert {
  return {
    id: overrides.id ?? 'a1',
    authority: 'ECCC',
    kind: 'alert',
    location_keys: overrides.location_keys ?? ['area-1'],
    sent_at: overrides.sent_at ?? '2025-01-01T10:00:00Z',
    expires: overrides.expires ?? '2025-01-02T10:00:00Z',
    msg_type: overrides.msg_type ?? 'Alert',
    status: overrides.status ?? 'Actual',
    event: overrides.event ?? 'Snowfall Warning',
    source_url: overrides.source_url ?? 'https://example.test',
    raw_ref: overrides.raw_ref ?? 'raw',
    cap_identifier: overrides.cap_identifier,
    references: overrides.references,
    area_key: overrides.area_key ?? 'area-1'
  };
}

describe('mergeAlertChain', () => {
  it('prefers updates linked by CAP references', () => {
    const base = buildAlert({
      id: 'base',
      cap_identifier: 'id-1',
      sent_at: '2025-01-01T10:00:00Z'
    });
    const update = buildAlert({
      id: 'update',
      cap_identifier: 'id-2',
      references: ['id-1'],
      sent_at: '2025-01-01T12:00:00Z'
    });

    const merged = mergeAlertChain([base, update]);
    expect(merged).toHaveLength(1);
    expect(merged[0].cap_identifier).toBe('id-2');
  });

  it('applies cancel to referenced chain', () => {
    const base = buildAlert({
      cap_identifier: 'id-10',
      sent_at: '2025-01-01T08:00:00Z'
    });
    const cancel = buildAlert({
      msg_type: 'Cancel',
      cap_identifier: 'id-11',
      references: ['id-10'],
      sent_at: '2025-01-01T09:00:00Z'
    });

    const merged = mergeAlertChain([base, cancel]);
    const active = filterActiveAlerts(merged, Date.parse('2025-01-01T10:00:00Z'));
    expect(active).toHaveLength(0);
  });

  it('falls back to sent_at ordering when references are missing', () => {
    const early = buildAlert({ sent_at: '2025-01-01T08:00:00Z' });
    const late = buildAlert({ sent_at: '2025-01-01T12:00:00Z' });
    const merged = mergeAlertChain([early, late]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sent_at).toBe('2025-01-01T12:00:00Z');
  });
});
