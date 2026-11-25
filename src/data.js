import { DRAW_SIZE, TOTAL_NUMBERS } from './math.js';
import { createPrng, drawRandomNumbers } from './stats.js';

export const STORAGE_KEY = 'mega_sena_analytics_dataset_v1';

/**
 * Generate a reproducible offline baseline dataset (2,800 equiprobable synthetic draws)
 * so all charts, heatmaps, and tools work immediately without internet access.
 * Clearly flagged as simulated baseline until real historical data is synced or imported.
 *
 * @param {number} [count=2800]
 * @returns {{ source: string, isSimulated: boolean, updatedAt: string, draws: Array<{ concurso: number, data: string, dezenas: number[] }> }}
 */
export function generateSimulatedBaseline(count = 2800) {
  const rng = createPrng(20261124);
  const draws = [];
  // Start date near Mega-Sena's launch (March 11, 1996), advancing ~3.5 days per draw
  const baseMs = Date.UTC(1996, 2, 11);
  const stepMs = 3.5 * 24 * 60 * 60 * 1000;

  for (let i = 1; i <= count; i++) {
    const dt = new Date(baseMs + (i - 1) * stepMs);
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = dt.getUTCFullYear();
    draws.push({
      concurso: i,
      data: `${dd}/${mm}/${yyyy}`,
      dezenas: drawRandomNumbers(rng, DRAW_SIZE)
    });
  }

  return {
    source: 'Base Simulada Offline (PRNG equiprovável)',
    isSimulated: true,
    updatedAt: new Date().toISOString(),
    draws
  };
}

/**
 * Normalize a list of 6 numbers into sorted valid integers (1..60), or return null if invalid.
 * @param {unknown[]} arr
 * @returns {number[] | null}
 */
function normalizeDezenas(arr) {
  if (!Array.isArray(arr) || arr.length < DRAW_SIZE) return null;
  const nums = arr.slice(0, DRAW_SIZE).map((v) => Number(String(v).trim()));
  const unique = new Set(nums);
  if (unique.size !== DRAW_SIZE) return null;
  for (const n of unique) {
    if (!Number.isInteger(n) || n < 1 || n > TOTAL_NUMBERS) {
      return null;
    }
  }
  return [...unique].sort((a, b) => a - b);
}

/**
 * Parse raw JSON or CSV/text payload into normalized draws array.
 * Supports:
 * 1) guilhermeasn/loteria.json object: { "1": ["04","05",...], ... }
 * 2) loteriascaixa-api array: [{ concurso, data, dezenas: [...] }, ...]
 * 3) CSV/TSV/Text lines with optional concurso and date followed by 6 numbers.
 *
 * @param {string | object | unknown[]} input
 * @returns {Array<{ concurso: number, data: string, dezenas: number[] }>}
 */
export function parseDrawsPayload(input) {
  let data = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      data = JSON.parse(trimmed);
    } else {
      return parseDelimitedText(trimmed);
    }
  }

  const draws = [];

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      if (Array.isArray(item)) {
        const dezenas = normalizeDezenas(item);
        if (dezenas) {
          draws.push({ concurso: i + 1, data: '', dezenas });
        }
      } else if (item && typeof item === 'object') {
        const rawNums = item.dezenas || item.listaDezenas || item.numeros || item.balls;
        const dezenas = normalizeDezenas(rawNums);
        const concurso = Number(item.concurso || item.numero || i + 1);
        const dateStr = String(item.data || item.dataApuracao || '');
        if (dezenas && Number.isFinite(concurso)) {
          draws.push({ concurso, data: dateStr, dezenas });
        }
      }
    }
  } else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      const concurso = Number(key);
      if (!Number.isFinite(concurso)) continue;
      if (Array.isArray(value)) {
        const dezenas = normalizeDezenas(value);
        if (dezenas) {
          draws.push({ concurso, data: '', dezenas });
        }
      } else if (value && typeof value === 'object') {
        const rawNums = value.dezenas || value.listaDezenas || value.numeros;
        const dezenas = normalizeDezenas(rawNums);
        if (dezenas) {
          draws.push({
            concurso,
            data: String(value.data || value.dataApuracao || ''),
            dezenas
          });
        }
      }
    }
  }

  return deduplicateAndSortDraws(draws);
}

/**
 * Parse CSV / semicolon / whitespace text lines containing Mega-Sena results.
 * @param {string} text
 */
function parseDelimitedText(text) {
  const lines = text.split(/\r?\n/);
  const draws = [];
  let autoConcurso = 1;

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    // Skip obvious header lines without enough numbers
    const tokens = clean.split(/[;,\t\s]+/).filter(Boolean);
    const dateToken = tokens.find((t) => /^\d{2}\/\d{2}\/\d{4}$/.test(t) || /^\d{4}-\d{2}-\d{2}$/.test(t)) || '';
    const numericTokens = tokens.filter((t) => /^\d+$/.test(t)).map((t) => Number(t));

    if (numericTokens.length < DRAW_SIZE) continue;

    let concurso = autoConcurso;
    let candidateSlice = numericTokens;

    if (numericTokens.length >= DRAW_SIZE + 1) {
      // First number is typically the concurso id
      concurso = numericTokens[0];
      candidateSlice = numericTokens.slice(1, 1 + DRAW_SIZE);
    }

    const dezenas = normalizeDezenas(candidateSlice);
    if (dezenas) {
      draws.push({ concurso, data: dateToken, dezenas });
      autoConcurso = concurso + 1;
    }
  }

  return deduplicateAndSortDraws(draws);
}

function deduplicateAndSortDraws(draws) {
  const byConcurso = new Map();
  for (const d of draws) {
    byConcurso.set(d.concurso, d);
  }
  return [...byConcurso.values()].sort((a, b) => a.concurso - b.concurso);
}

/**
 * Sync real Mega-Sena historical draws from open public mirrors in the browser.
 * @param {typeof fetch} [fetchImpl=fetch]
 */
export async function syncOnlineDraws(fetchImpl = fetch) {
  const sources = [
    {
      name: 'GitHub loteria.json (Base Oficial Caixa)',
      url: 'https://raw.githubusercontent.com/guilhermeasn/loteria.json/master/data/megasena.json'
    },
    {
      name: 'Loterias Caixa API (Mirror)',
      url: 'https://loteriascaixa-api.herokuapp.com/api/megasena'
    }
  ];

  const errors = [];
  for (const src of sources) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(src.url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      const draws = parseDrawsPayload(json);
      if (draws.length < 100) {
        throw new Error(`Apenas ${draws.length} concursos válidos encontrados`);
      }
      return {
        source: src.name,
        isSimulated: false,
        updatedAt: new Date().toISOString(),
        draws
      };
    } catch (err) {
      errors.push(`${src.name}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Não foi possível sincronizar online (${errors.join(' | ')})`);
}
