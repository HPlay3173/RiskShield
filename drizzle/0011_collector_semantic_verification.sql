UPDATE riskshield_candidates
SET
  status = 'rejected',
  payload = json_set(
    payload,
    '$.status', 'rejected',
    '$.legacyQuarantine', json_object(
      'reason', 'legacy_unqualified_collector_candidate',
      'qualityGateVersion', 'collector-semantic-search-v1'
    )
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id LIKE 'collector_candidate_%'
  AND status IN ('pending', 'held')
  AND json_extract(payload, '$.reportType') = 'collector_discovery'
  AND (
    json_extract(payload, '$.qualification') IS NULL
    OR json_extract(payload, '$.confidence') IS NULL
    OR json_extract(payload, '$.riskDomain') = '자동 발견 · 미분류'
  );
