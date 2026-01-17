#!/usr/bin/env node
/*
  Build a deterministic Canadian populated-places dataset (GeoNames) for city autocomplete.

  Inputs (repo-relative):
    - geodat/CA/CA.txt                 GeoNames Canada dump (tab-delimited, 19 columns)
    - geodat/admin1CodesASCII.txt      Province mapping: "CA.<admin1>\t<name>\t<asciiname>\t<geonameid>"

  Outputs (repo-relative):
    - dist/ca_places.json              Array of place objects (pretty JSON, newline-terminated)
    - dist/ca_places_index.json        Prefix index for fast autocomplete (pretty JSON, newline-terminated)

  Run:
    node scripts/build-canada-places.mjs
*/

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const INPUT_ADMIN1 = path.join(repoRoot, 'geodat', 'admin1CodesASCII.txt');
const INPUT_CANADA_DUMP = findCanadaDumpFile(repoRoot);
const OUTPUT_DIR = path.join(repoRoot, 'dist');
const OUTPUT_PLACES = path.join(OUTPUT_DIR, 'ca_places.json');
const OUTPUT_INDEX = path.join(OUTPUT_DIR, 'ca_places_index.json');

const ALLOWED_FEATURE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC']);
const MAX_KEYS_PER_PLACE = 30;
const MAX_PREFIX = 8;
const MAX_INDEX_KEY_LEN = 40;

await main();

async function main() {
  const startedAtMs = Date.now();

  ensureFileExists(INPUT_ADMIN1, 'Missing required input file');
  ensureFileExists(INPUT_CANADA_DUMP, 'Missing required input file');

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const provMap = await loadProvinceMap(INPUT_ADMIN1);

  const dedup = new Map();
  let readRows = 0;
  let passedFilterRows = 0;
  let uniqueDedupBuckets = 0;
  let replacedByDedup = 0;
  let droppedInvalidLatLon = 0;
  let droppedNonCA = 0;
  let droppedInvalidFeature = 0;
  const featureCodesSeen = new Set();
  const unexpectedFeatureCodes = new Set();

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT_CANADA_DUMP, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    readRows += 1;

    const cols = line.split('\t');
    if (cols.length < 15) continue;

    const id = parseInt(cols[0], 10);
    if (!Number.isFinite(id)) continue;

    const name = (cols[1] ?? '').trim();
    const asciiname = (cols[2] ?? '').trim();
    const alternatenames = cols[3] ?? '';
    const latStr = cols[4] ?? '';
    const lonStr = cols[5] ?? '';
    const featureClass = cols[6] ?? '';
    const featureCode = cols[7] ?? '';
    const countryCode = cols[8] ?? '';
    const admin1 = (cols[10] ?? '').trim();
    const pop = parseInt(cols[14] ?? '0', 10) || 0;

    if (countryCode === 'CA' && featureClass === 'P' && featureCode) {
      featureCodesSeen.add(featureCode);
    }

    if (countryCode !== 'CA') {
      droppedNonCA += 1;
      continue;
    }

    if (featureClass !== 'P') {
      droppedInvalidFeature += 1;
      continue;
    }

    if (!ALLOWED_FEATURE_CODES.has(featureCode)) {
      droppedInvalidFeature += 1;
      if (featureCode) unexpectedFeatureCodes.add(featureCode);
      continue;
    }

    const lat = Number(latStr);
    const lon = Number(lonStr);
    if (!isValidLatLon(lat, lon)) {
      droppedInvalidLatLon += 1;
      continue;
    }

    passedFilterRows += 1;

    const primaryName = (asciiname || name).trim();
    if (!primaryName) continue;

    const normPrimary = normalizeKey(primaryName);
    if (!normPrimary) continue;

    const dedupKey = [
      admin1,
      normPrimary,
      formatCoord3(lat),
      formatCoord3(lon),
    ].join('|');

    const candidate = {
      id,
      name: primaryName,
      prov: admin1,
      lat,
      lon,
      pop,
      keys: buildKeys(primaryName, asciiname, alternatenames, MAX_KEYS_PER_PLACE),
    };

    const existing = dedup.get(dedupKey);
    if (!existing) {
      dedup.set(dedupKey, candidate);
      uniqueDedupBuckets += 1;
      continue;
    }

    if (isBetterCandidate(candidate, existing)) {
      dedup.set(dedupKey, candidate);
      replacedByDedup += 1;
    }
  }

  const places = Array.from(dedup.values());

  let missingProvName = 0;
  for (const place of places) {
    const provName = provMap.get(place.prov)?.provName ?? null;
    if (provName === null) missingProvName += 1;
    place.provName = provName;
  }

  places.sort(comparePlaces);

  const indexPayload = buildPrefixIndex(places, MAX_PREFIX, MAX_INDEX_KEY_LEN);

  const placesJson = JSON.stringify(places.map(toOutputPlace), null, 2) + '\n';
  const indexJson = JSON.stringify(indexPayload, null, 2) + '\n';

  const placesWrite = writeFileIfChanged(OUTPUT_PLACES, placesJson);
  const indexWrite = writeFileIfChanged(OUTPUT_INDEX, indexJson);

  const placesSize = fs.statSync(OUTPUT_PLACES).size;
  const indexSize = fs.statSync(OUTPUT_INDEX).size;

  const totalKeys = places.reduce((sum, p) => sum + p.keys.length, 0);
  const pops = places.map((p) => p.pop);
  const minPop = pops.length ? Math.min(...pops) : 0;
  const maxPop = pops.length ? Math.max(...pops) : 0;
  const medianPop = medianInt(pops);
  const lowPopCount = places.filter((p) => p.pop < 10).length;
  const lowPopPct = places.length ? (lowPopCount / places.length) * 100 : 0;
  const avgKeys = places.length ? (totalKeys / places.length) : 0;
  const maxKeysAny = places.reduce((m, p) => Math.max(m, p.keys.length), 0);

  const top10 = [...places]
    .sort((a, b) => (b.pop - a.pop) || (a.id - b.id))
    .slice(0, 10);

  const elapsedMs = Date.now() - startedAtMs;

  const {
    totalPrefixes,
    totalIdReferences,
    avgIdsPerPrefix,
    largestBucketSize,
    largestBucketPrefix,
  } = indexPayload.stats;

  process.stdout.write(
    [
      '================================================================================',
      'INPUT FILES',
      `  Canada dump: ${path.relative(repoRoot, INPUT_CANADA_DUMP)}`,
      `  Province map: ${path.relative(repoRoot, INPUT_ADMIN1)}`,
      '',
      'PROCESSING STATISTICS',
      `  Rows read: ${readRows}`,
      `  Rows passed filter: ${passedFilterRows}`,
      `  Rows dropped (non-CA): ${droppedNonCA}`,
      `  Rows dropped (invalid feature): ${droppedInvalidFeature}`,
      `  Rows dropped (invalid lat/lon): ${droppedInvalidLatLon}`,
      `  Feature codes seen: ${[...featureCodesSeen].sort().join(', ') || '(none)'}`,
      '',
      'DEDUPLICATION',
      `  Dedup buckets: ${uniqueDedupBuckets} (replaced ${replacedByDedup} times)`,
      '',
      'POPULATION STATISTICS',
      `  Min population: ${minPop}`,
      `  Median population: ${medianPop}`,
      `  Max population: ${maxPop}`,
      `  Low population (<10) places: ${lowPopCount} (${lowPopPct.toFixed(2)}%) - may indicate many very small places`,
      '',
      'KEY STATISTICS',
      `  Total keys: ${totalKeys}`,
      `  Average keys per place: ${avgKeys.toFixed(2)}`,
      `  Max keys on any place: ${maxKeysAny}`,
      `  Max keys per place constant: ${MAX_KEYS_PER_PLACE}`,
      '',
      'SAMPLE KEYS (first 3 places, first 5 keys each):',
      ...places.slice(0, 3).map((p, i) => `  ${i + 1}. ${p.name} (${p.prov}): ${p.keys.slice(0, 5).join(', ')}`),
      '',
      'INDEX STATISTICS',
      `  Total prefixes: ${totalPrefixes}`,
      `  Total ID references: ${totalIdReferences}`,
      `  Average IDs per prefix: ${avgIdsPerPrefix.toFixed(2)}`,
      `  Largest bucket size: ${largestBucketSize} (prefix: "${largestBucketPrefix}")${largestBucketSize > 1000 ? ' - WARNING: very large bucket' : ''}`,
      '',
      'QUALITY WARNINGS',
      (() => {
        const warnings = [];
        const missingProvPct = places.length ? (missingProvName / places.length) * 100 : 0;
        if (missingProvName > 0) {
          warnings.push(`  Missing province mappings: ${missingProvName} (${missingProvPct.toFixed(2)}%)${missingProvPct > 5 ? ' - WARNING: high missing province mappings' : ''}`);
        }
        if (lowPopCount > 0) {
          warnings.push(`  Low population places: ${lowPopCount} (${lowPopPct.toFixed(2)}%)`);
        }
        if (medianPop < 100) {
          warnings.push('  Median population is below 100 - WARNING: many very small places');
        }
        if (avgKeys < 3) {
          warnings.push('  Average keys per place is below 3 - WARNING: may affect autocomplete quality');
        }
        if (unexpectedFeatureCodes.size > 0) {
          warnings.push(`  Unexpected feature codes encountered: ${[...unexpectedFeatureCodes].sort().join(', ')}`);
        }
        return warnings.length ? warnings.join('\n') : '  None';
      })(),
      '',
      'OUTPUT FILES',
      `  ${path.relative(repoRoot, OUTPUT_PLACES)}: ${formatBytes(placesSize)}; ${placesWrite}`,
      `  ${path.relative(repoRoot, OUTPUT_INDEX)}: ${formatBytes(indexSize)}; ${indexWrite}`,
      '',
      'TOP 10 BY POPULATION',
      ...top10.map((p, i) => `  ${String(i + 1).padStart(2, ' ')}. ${p.name} (${p.prov}) pop=${p.pop} id=${p.id}`),
      '',
      `BUILD TIME: ${elapsedMs}ms`,
      '================================================================================',
      '',
    ].join('\n'),
  );
}

function ensureFileExists(filepath, prefixMessage) {
  try {
    const st = fs.statSync(filepath);
    if (!st.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`${prefixMessage}: ${filepath}`);
  }
}

function findCanadaDumpFile(root) {
  const candidates = [
    path.join(root, 'geodat', 'CA', 'CA.txt'),
    path.join(root, 'geodat', 'CA.txt'),
    path.join(root, 'geodat', 'CA', 'ca.txt'),
    path.join(root, 'geodat', 'ca.txt'),
  ];
  for (const fp of candidates) {
    try {
      const st = fs.statSync(fp);
      if (st.isFile()) return fp;
    } catch {
      // continue
    }
  }
  const dir = path.join(root, 'geodat', 'CA');
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
    for (const name of names) {
      if (/^CA\.txt$/i.test(name)) return path.join(dir, name);
    }
    for (const name of names) {
      if (/\.txt$/i.test(name) && !/^readme\.txt$/i.test(name)) return path.join(dir, name);
    }
  } catch {
    // fallthrough
  }
  throw new Error(`Unable to find Canada dump file under ${path.join(root, 'geodat')}`);
}

async function loadProvinceMap(admin1Path) {
  const provMap = new Map();

  const rl = readline.createInterface({
    input: fs.createReadStream(admin1Path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    const [code, name] = line.split('\t');
    if (!code || !name) continue;
    if (!code.startsWith('CA.')) continue;
    const provCode = code.slice('CA.'.length);
    if (!provCode) continue;
    if (!provMap.has(provCode)) {
      provMap.set(provCode, { provCode, provName: name });
    }
  }

  return provMap;
}

function isValidLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  return true;
}

function formatCoord3(value) {
  const s = value.toFixed(3);
  return s === '-0.000' ? '0.000' : s;
}

function isBetterCandidate(a, b) {
  if (a.pop !== b.pop) return a.pop > b.pop;
  return a.id < b.id;
}

function normalizeKey(input) {
  let s = String(input);
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.toLowerCase();
  s = s.replace(/[.,'’/()\[\]-]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function generateSaintVariants(normalized) {
  const base = normalized;
  const tokens = base.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const out = [];
  const seen = new Set();

  const pushTokens = (arr) => {
    const v = arr.join(' ');
    if (!v || v.length < 2) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  // Always include base first
  pushTokens(tokens);

  // Word-boundary expansions across ALL positions (single replacement at a time; no combinatorial explosion)
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];

    if (t === 'st') {
      const next = tokens.slice();
      next[i] = 'saint';
      pushTokens(next);
    } else if (t === 'ste') {
      const next = tokens.slice();
      next[i] = 'sainte';
      pushTokens(next);
    } else if (t === 'saint') {
      const next = tokens.slice();
      next[i] = 'st';
      pushTokens(next);
    } else if (t === 'sainte') {
      const next = tokens.slice();
      next[i] = 'ste';
      pushTokens(next);
    }
  }

  return out;
}

function generateReorderVariants(normalized) {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 2) {
    const [a, b] = tokens;
    return [`${b} ${a}`];
  }
  if (tokens.length === 3) {
    const [a, b, c] = tokens;
    // Deterministic “major reorderings” (max 5 total)
    const variants = [
      `${b} ${a} ${c}`,
      `${b} ${c} ${a}`,
    ];
    // Add full reverse as a third optional variant while staying under 5
    variants.push(`${c} ${b} ${a}`);
    return variants.slice(0, 5);
  }
  return [];
}

function buildKeys(primaryName, asciiname, alternatenames, maxKeys) {
  const keys = [];
  const seen = new Set();

  const addKey = (k) => {
    if (keys.length >= maxKeys) return false;
    if (k.length < 2) return true;
    if (seen.has(k)) return true;
    seen.add(k);
    keys.push(k);
    return true;
  };

  // Updated addCandidate as per instructions
  const addCandidate = (raw, expandSaint) => {
    if (keys.length >= maxKeys) return false;
    const base = normalizeKey(raw);
    if (!base) return true;

    if (expandSaint) {
      for (const v of generateSaintVariants(base)) {
        if (!addKey(v)) return false;
      }
    } else {
      if (!addKey(base)) return false;
    }
    return true;
  };

  addCandidate(primaryName, true);
  if (keys.length < maxKeys && asciiname && asciiname.trim() && asciiname.trim() !== primaryName) {
    addCandidate(asciiname, true);
  }

  if (keys.length < maxKeys && alternatenames) {
    const parts = alternatenames.split(',');
    for (const part of parts) {
      if (keys.length >= maxKeys) break;
      const raw = part.trim();
      if (!raw) continue;
      addCandidate(raw, false);
    }
  }

  // Reorder variants from primary (with saint-expanded base)
  if (keys.length < maxKeys) {
    const basePrimary = normalizeKey(primaryName);
    if (basePrimary) {
      // Generate reorderings from saint-expanded variants
      for (const saintVariant of generateSaintVariants(basePrimary)) {
        const reorderings = generateReorderVariants(saintVariant);
        for (const r of reorderings) {
          if (keys.length >= maxKeys) break;
          addKey(r);
        }
        if (keys.length >= maxKeys) break;
      }
    }
  }

  return keys;
}

function comparePlaces(a, b) {
  if (a.prov !== b.prov) return a.prov < b.prov ? -1 : 1;
  const an = asciiSortKey(a.name);
  const bn = asciiSortKey(b.name);
  if (an !== bn) return an < bn ? -1 : 1;
  return a.id - b.id;
}

function asciiSortKey(s) {
  return normalizeKey(s).replace(/[^a-z0-9 ]/g, '');
}

function toOutputPlace(p) {
  return {
    id: p.id,
    name: p.name,
    prov: p.prov,
    provName: p.provName,
    lat: p.lat,
    lon: p.lon,
    pop: p.pop,
    keys: p.keys,
  };
}

function buildPrefixIndex(places, maxPrefix, maxKeyLen) {
  const prefixToIds = new Map();

  for (const place of places) {
    for (const key of place.keys) {
      if (key.length > maxKeyLen) continue;
      const max = Math.min(maxPrefix, key.length);
      for (let len = 2; len <= max; len += 1) {
        const prefix = key.slice(0, len);
        let ids = prefixToIds.get(prefix);
        if (!ids) {
          ids = new Set();
          prefixToIds.set(prefix, ids);
        }
        ids.add(place.id);
      }
    }
  }

  const prefixes = Array.from(prefixToIds.keys()).sort();
  const index = {};
  let totalIdReferences = 0;
  let largestBucketSize = 0;
  let largestBucketPrefix = '';

  for (const prefix of prefixes) {
    const ids = Array.from(prefixToIds.get(prefix) ?? []);
    ids.sort((a, b) => a - b);
    index[prefix] = ids;
    totalIdReferences += ids.length;
    if (ids.length > largestBucketSize) {
      largestBucketSize = ids.length;
      largestBucketPrefix = prefix;
    }
  }

  const totalPrefixes = prefixes.length;
  const avgIdsPerPrefix = totalPrefixes === 0 ? 0 : +(totalIdReferences / totalPrefixes).toFixed(2);

  return {
    version: 1,
    maxPrefix,
    stats: {
      totalPrefixes,
      totalIdReferences,
      avgIdsPerPrefix,
      largestBucketSize,
      largestBucketPrefix,
    },
    index,
  };
}

function writeFileIfChanged(filepath, contents) {
  const nextHash = sha256Hex(contents);
  let prevHash = null;
  try {
    const prev = fs.readFileSync(filepath, 'utf8');
    prevHash = sha256Hex(prev);
    if (prev === contents) return `unchanged (sha256 ${nextHash})`;
  } catch {
    // file missing/unreadable -> write
  }

  fs.writeFileSync(filepath, contents, 'utf8');
  if (prevHash) return `updated (sha256 ${nextHash}; was ${prevHash})`;
  return `created (sha256 ${nextHash})`;
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return String(n);
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${fixed} ${units[i]}`;
}

function medianInt(values) {
  if (!values.length) return 0;
  const arr = [...values].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  if (arr.length % 2 === 1) return arr[mid];
  return Math.round((arr[mid - 1] + arr[mid]) / 2);
}
