const TAG_RULES: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'wind', patterns: [/wind/i, /gust/i] },
  { tag: 'snow', patterns: [/snow/i, /blizzard/i, /flurr/i] },
  { tag: 'rain', patterns: [/rain/i, /showers?/i, /precip/i] },
  { tag: 'thunder', patterns: [/thunder/i, /lightning/i] },
  { tag: 'fog', patterns: [/fog/i, /visibility/i] },
  { tag: 'heat', patterns: [/heat/i, /hot/i, /humid/i] },
  { tag: 'cold', patterns: [/cold/i, /freeze/i, /frost/i, /chill/i] },
  { tag: 'flooding', patterns: [/flood/i] },
  { tag: 'marine', patterns: [/marine/i, /gale/i, /seas?/i] },
  { tag: 'ice', patterns: [/ice/i, /icy/i, /freezing/i] }
];

export function deriveTags(text: string): string[] {
  const tags = new Set<string>();
  for (const rule of TAG_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      tags.add(rule.tag);
    }
  }
  return Array.from(tags);
}

