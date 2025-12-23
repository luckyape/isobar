export interface ConsensusOverviewInput {
  locationName?: string;
  overallScore?: number;
  confidenceLabel?: string;
  temperatureNow?: number;
  condition?: string;
  todayHigh?: number;
  todayLow?: number;
  freshnessLabel?: string;
  freshnessSpreadHours?: number;
  modelCount?: number;
}

const DEFAULT_MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';

function formatNumber(value?: number, digits = 0): string | null {
  if (!Number.isFinite(value ?? NaN)) return null;
  const factor = Math.pow(10, digits);
  return (Math.round((value as number) * factor) / factor).toFixed(digits);
}

function buildUserPrompt(input: ConsensusOverviewInput): string {
  const lines: string[] = [];

  if (input.locationName) {
    lines.push(`Location: ${input.locationName}`);
  }

  const overallScore = formatNumber(input.overallScore, 0);
  if (overallScore) {
    lines.push(`Consensus score: ${overallScore} (0-100)`);
  }

  if (input.confidenceLabel) {
    lines.push(`Confidence label: ${input.confidenceLabel}`);
  }

  const currentTemp = formatNumber(input.temperatureNow, 0);
  if (currentTemp) {
    lines.push(`Current temp: ${currentTemp} C`);
  }

  if (input.condition) {
    lines.push(`Current conditions: ${input.condition}`);
  }

  const high = formatNumber(input.todayHigh, 0);
  const low = formatNumber(input.todayLow, 0);
  if (high && low) {
    lines.push(`Today high/low: ${high} C / ${low} C`);
  } else if (high) {
    lines.push(`Today high: ${high} C`);
  } else if (low) {
    lines.push(`Today low: ${low} C`);
  }

  if (input.freshnessLabel) {
    const spread = formatNumber(input.freshnessSpreadHours, 1);
    const detail = spread ? ` (${spread}h spread)` : '';
    lines.push(`Freshness: ${input.freshnessLabel}${detail}`);
  }

  const modelCount = formatNumber(input.modelCount, 0);
  if (modelCount) {
    lines.push(`Models: ${modelCount}`);
  }

  return lines.join('\n');
}

function buildOpenAiPayload(input: ConsensusOverviewInput) {
  const systemText =
    'You are a weather consensus assistant. Write one sentence (max 22 words), plain text only. ' +
    'Use present tense, no emojis, no quotes, no lists. ' +
    'Mention agreement, current conditions, and today high/low when available. ' +
    'If freshness is provided, include its label briefly.';

  return {
    model: DEFAULT_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'text', text: systemText }]
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildUserPrompt(input)
          }
        ]
      }
    ],
    temperature: 0.3,
    max_output_tokens: 60
  };
}

function extractResponseText(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.output_text === 'string') return data.output_text.trim();
  const output = data.output?.[0]?.content;
  if (!Array.isArray(output)) return null;
  const text = output
    .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
    .join('')
    .trim();
  return text.length > 0 ? text : null;
}

export async function fetchConsensusOverview(
  input: ConsensusOverviewInput,
  signal?: AbortSignal
): Promise<string | null> {
  const payload = buildOpenAiPayload(input);
  try {
    const response = await fetch('/api/consensus-overview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return extractResponseText(data);
  } catch {
    return null;
  }
}
