/**
 * Exact combinatorial and hypergeometric probability engine for Mega-Sena (6 of 60).
 * Uses BigInt for exact combination counts without floating-point precision loss.
 */

export const TOTAL_NUMBERS = 60;
export const DRAW_SIZE = 6;

/**
 * Exact binomial coefficient C(n, k) as BigInt.
 * @param {number} n
 * @param {number} k
 * @returns {bigint}
 */
export function comb(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) {
    return 0n;
  }
  const effectiveK = Math.min(k, n - k);
  let result = 1n;
  for (let i = 1; i <= effectiveK; i++) {
    result = (result * BigInt(n - effectiveK + i)) / BigInt(i);
  }
  return result;
}

export const TOTAL_COMBINATIONS = comb(TOTAL_NUMBERS, DRAW_SIZE); // 50,063,860n

/**
 * Official Caixa reference bet prices (BRL) for 6 to 20 numbers (base unit R$ 5,00).
 * Multiplied by C(k, 6). Users can override base unit price in UI if Caixa updates tariff.
 */
export const DEFAULT_SIMPLE_BET_PRICE = 5.0;

/**
 * Convert an exact BigInt numerator/denominator ratio into probability, odds, and percentage.
 * @param {bigint} favorable
 * @param {bigint} total
 * @returns {{ favorable: bigint, total: bigint, probability: number, odds: number | null, percent: number }}
 */
export function ratioStats(favorable, total = TOTAL_COMBINATIONS) {
  if (favorable <= 0n || total <= 0n) {
    return { favorable: 0n, total, probability: 0, odds: null, percent: 0 };
  }
  // Scale numerator to preserve precision for very small probabilities
  const scale = 10n ** 15n;
  const scaled = Number((favorable * scale) / total);
  const probability = scaled / 1e15;
  const odds = Number(total) / Number(favorable);
  return {
    favorable,
    total,
    probability,
    odds,
    percent: probability * 100
  };
}

/**
 * Calculate exact Sena, Quina, Quadra, and Terno probabilities for a bet of k numbers (6 <= k <= 20).
 * Hypergeometric formula:
 * P(X = m) = [C(k, m) * C(60 - k, 6 - m)] / C(60, 6)
 * Wait: Note carefully! When you play k >= 6 numbers in a single ticket (desdobramento),
 * you win Sena if ALL 6 drawn numbers are inside your k chosen numbers:
 *   favorable_sena = C(k, 6)
 * You hit at least 5 (Quina) when 5 of the 6 drawn numbers are inside your k chosen numbers,
 * and 1 drawn number is outside (among 60 - k):
 *   favorable_quina = C(k, 5) * C(60 - k, 1)
 * You hit 4 (Quadra) when 4 of the 6 drawn numbers are inside your k chosen numbers,
 * and 2 drawn numbers are outside:
 *   favorable_quadra = C(k, 4) * C(60 - k, 2)
 *
 * @param {number} betSize - Number of marked numbers on the ticket (6 to 20).
 * @param {number} [unitPrice=DEFAULT_SIMPLE_BET_PRICE]
 */
export function calculateTicketOdds(betSize, unitPrice = DEFAULT_SIMPLE_BET_PRICE) {
  if (!Number.isInteger(betSize) || betSize < 6 || betSize > 20) {
    throw new RangeError('betSize deve ser um inteiro entre 6 e 20.');
  }

  const gamesCount = comb(betSize, 6);
  const outside = TOTAL_NUMBERS - betSize;

  const senaFav = comb(betSize, 6) * comb(outside, 0);
  const quinaFav = comb(betSize, 5) * comb(outside, 1);
  const quadraFav = comb(betSize, 4) * comb(outside, 2);
  const ternoFav = comb(betSize, 3) * comb(outside, 3);
  const anyPrizeFav = senaFav + quinaFav + quadraFav;

  return {
    betSize,
    gamesCount,
    estimatedCost: Number(gamesCount) * unitPrice,
    sena: ratioStats(senaFav),
    quina: ratioStats(quinaFav),
    quadra: ratioStats(quadraFav),
    terno: ratioStats(ternoFav),
    anyPrize: ratioStats(anyPrizeFav)
  };
}

/**
 * Given M chosen target numbers (1 <= M <= 60), calculate exact hypergeometric probabilities
 * of how many of those M numbers appear in a single 6-number Mega-Sena draw.
 *
 * @param {number} targetCount - M (1..60)
 * @returns {{
 *   targetCount: number,
 *   distribution: Array<{ hits: number, favorable: bigint, probability: number, odds: number | null, percent: number }>,
 *   atLeast: Array<{ minHits: number, favorable: bigint, probability: number, odds: number | null, percent: number }>,
 *   allAppear: { favorable: bigint, probability: number, odds: number | null, percent: number } | null
 * }}
 */
export function calculateTargetNumbersOdds(targetCount) {
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > TOTAL_NUMBERS) {
    throw new RangeError('targetCount deve ser um inteiro entre 1 e 60.');
  }

  const maxHits = Math.min(DRAW_SIZE, targetCount);
  const minHits = Math.max(0, DRAW_SIZE - (TOTAL_NUMBERS - targetCount));
  const distribution = [];

  for (let hits = minHits; hits <= maxHits; hits++) {
    const favorable = comb(targetCount, hits) * comb(TOTAL_NUMBERS - targetCount, DRAW_SIZE - hits);
    distribution.push({
      hits,
      ...ratioStats(favorable)
    });
  }

  const atLeast = [];
  for (let threshold = 1; threshold <= maxHits; threshold++) {
    let favSum = 0n;
    for (const row of distribution) {
      if (row.hits >= threshold) {
        favSum += row.favorable;
      }
    }
    atLeast.push({
      minHits: threshold,
      ...ratioStats(favSum)
    });
  }

  // Exact probability that ALL M chosen numbers appear in the 6 drawn numbers (only possible if M <= 6)
  let allAppear = null;
  if (targetCount <= DRAW_SIZE) {
    const favAll = comb(TOTAL_NUMBERS - targetCount, DRAW_SIZE - targetCount);
    allAppear = ratioStats(favAll);
  }

  return {
    targetCount,
    distribution,
    atLeast,
    allAppear
  };
}

/**
 * Compute probability of an event with per-draw probability p occurring at least once
 * across N independent draws: 1 - (1 - p)^N.
 * Uses -expm1(N * log1p(-p)) to avoid floating-point cancellation for tiny p.
 *
 * @param {number} singleDrawProbability
 * @param {number} numDraws
 * @returns {number}
 */
export function multiDrawProbability(singleDrawProbability, numDraws) {
  if (singleDrawProbability <= 0 || numDraws <= 0) return 0;
  if (singleDrawProbability >= 1) return 1;
  return -Math.expm1(numDraws * Math.log1p(-singleDrawProbability));
}

/**
 * Exact theoretical distribution of even-number counts (0 to 6) in a 6-number draw.
 * 30 even numbers and 30 odd numbers in 1..60.
 * @returns {Array<{ evens: number, oddCount: number, favorable: bigint, probability: number, odds: number | null, percent: number }>}
 */
export function theoreticalParityDistribution() {
  const rows = [];
  for (let evens = 0; evens <= DRAW_SIZE; evens++) {
    const fav = comb(30, evens) * comb(30, DRAW_SIZE - evens);
    const stats = ratioStats(fav);
    rows.push({
      ...stats,
      evens,
      oddCount: DRAW_SIZE - evens
    });
  }
  return rows;
}

/**
 * Theoretical probability that a 6-number draw contains at least one consecutive pair (e.g., 14 and 15).
 * Number of 6-subsets of {1..60} with NO consecutive elements is C(60 - 6 + 1, 6) = C(55, 6).
 */
export function theoreticalConsecutivePairOdds() {
  const noConsec = comb(55, 6);
  const withConsec = TOTAL_COMBINATIONS - noConsec;
  return {
    withConsecutive: ratioStats(withConsec),
    withoutConsecutive: ratioStats(noConsec)
  };
}

/**
 * Evaluate structural properties of a user's selected numbers (6..20 numbers).
 * @param {number[]} numbers
 */
export function analyzeCombinationStructure(numbers) {
  const uniqueSorted = [...new Set(numbers)].filter((n) => n >= 1 && n <= 60).sort((a, b) => a - b);
  const evens = uniqueSorted.filter((n) => n % 2 === 0).length;
  const odds = uniqueSorted.length - evens;
  const sum = uniqueSorted.reduce((acc, n) => acc + n, 0);
  const mean = uniqueSorted.length > 0 ? sum / uniqueSorted.length : 0;

  let consecutivePairs = 0;
  for (let i = 1; i < uniqueSorted.length; i++) {
    if (uniqueSorted[i] === uniqueSorted[i - 1] + 1) {
      consecutivePairs++;
    }
  }

  const decades = [0, 0, 0, 0, 0, 0];
  const quadrants = [0, 0, 0, 0]; // Q1: col1-5 row1-3, etc. Using 1..15, 16..30, 31..45, 46..60 ranges
  const endings = Array(10).fill(0);
  const primes = new Set([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59]);
  let primeCount = 0;

  for (const n of uniqueSorted) {
    decades[Math.floor((n - 1) / 10)]++;
    quadrants[Math.floor((n - 1) / 15)]++;
    endings[n % 10]++;
    if (primes.has(n)) primeCount++;
  }

  return {
    numbers: uniqueSorted,
    count: uniqueSorted.length,
    evens,
    odds,
    sum,
    mean,
    consecutivePairs,
    decades,
    ranges15: quadrants,
    repeatedEndings: endings.filter((c) => c > 1).length,
    primeCount
  };
}

/**
 * Approximate upper-tail p-value for a Chi-Square statistic using Wilson-Hilferty transformation
 * to the standard normal distribution. Good accuracy for df >= 10 (here df = 59).
 * @param {number} chiSquare
 * @param {number} df
 * @returns {number}
 */
export function chiSquarePValue(chiSquare, df) {
  if (chiSquare <= 0 || df <= 0) return 1;
  const term = 2 / (9 * df);
  const z = (Math.pow(chiSquare / df, 1 / 3) - (1 - term)) / Math.sqrt(term);
  // Standard normal upper tail 1 - Phi(z) using Abramowitz & Stegun 7.1.26 erf approximation
  return 0.5 * erfc(z / Math.SQRT2);
}

function erfc(x) {
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const poly =
    t *
    (0.254829592 +
      t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const res = poly * Math.exp(-absX * absX);
  return x >= 0 ? res : 2 - res;
}
