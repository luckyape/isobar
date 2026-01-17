
import { computeLocationScopeId } from '../cdn/location';

// CA Places Roxville
const lat = 44.60746;
const lon = -65.86646;
// User manual ingest
// const lat = 44.6683;
// const lon = -65.7619;
const timezone = 'UTC';

const scopeId = computeLocationScopeId({
    latitude: lat,
    longitude: lon,
    timezone: timezone,
    decimals: 4
});

console.log(`Input: ${lat}, ${lon}, ${timezone}`);
console.log(`Generated Scope ID: ${scopeId}`);
