import {
  TOTAL_NUMBERS,
  DRAW_SIZE,
  chiSquarePValue,
  calculateTargetNumbersOdds,
  calculateTicketOdds,
  theoreticalParityDistribution
} from './math.js';

/**
 * Fast seeded PRNG (Mulberry32) for reproducible simulations and baseline datasets.
 * @param {number} seed
 * @returns {() => number}
 */
export function createPrng(seed) {
  let state = seed >>> 0;
  return function nextRandom() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw 6 unique sorted integers in [1, 60] using partial Fisher-Yates shuffle.
 * @param {() => number} [rng=Math.random]
 * @param {number} [count=DRAW_SIZE]
 * @returns {number[]}
 */
export function drawRandomNumbers(rng = Math.random, count = DRAW_SIZE) {
  const pool = new Uint8Array(TOTAL_NUMBERS);
  for (let i = 0; i < TOTAL_NUMBERS; i++) {
    pool[i] = i + 1;
  }
  const picked = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (TOTAL_NUMBERS - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    picked.push(pool[i]);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * Compute comprehensive empirical statistics over an array of Mega-Sena draws.
 * @param {Array<{ concurso: number, data: string, dezenas: number[] }>} rawDraws
 */
export function computeDrawStatistics(rawDraws) {
  const draws = [...rawDraws]
    .filter((d) => Array.isArray(d.dezenas) && d.dezenas.length === DRAW_SIZE)
    .sort((a, b) => a.concurso - b.concurso);

  const totalDraws = draws.length;
  const freq = new Int32Array(TOTAL_NUMBERS + 1);
  const recent100Freq = new Int32Array(TOTAL_NUMBERS + 1);
  const lastIndex = new Int32Array(TOTAL_NUMBERS + 1).fill(-1);
  const maxDelay = new Int32Array(TOTAL_NUMBERS + 1);
  const lastConcurso = new Int32Array(TOTAL_NUMBERS + 1);
  const lastDate = Array(TOTAL_NUMBERS + 1).fill(null);

  const parityCounts = Array(DRAW_SIZE + 1).fill(0);
  const decadeTotals = Array(6).fill(0);
  const sums = [];
  const sumBinLabels = ['21-90', '91-120', '121-150', '151-180', '181-210', '211-240', '241-270', '271-345'];
  const sumBinBounds = [90, 120, 150, 180, 210, 240, 270, 345];
  const sumBins = Array(sumBinLabels.length).fill(0);

  let consecutiveDrawsCount = 0;
  let repeatFromPrevCount = 0;

  // Pair co-occurrence map (key: a * 100 + b for a < b)
  const pairCounts = new Map();
  // Triplet co-occurrence map (key: a * 10000 + b * 100 + c for a < b < c)
  const tripletCounts = new Map();

  const recentStart = Math.max(0, totalDraws - 100);
  let prevSet = null;

  for (let idx = 0; idx < totalDraws; idx++) {
    const draw = draws[idx];
    const nums = [...draw.dezenas].sort((a, b) => a - b);
    let evens = 0;
    let sum = 0;
    let hasConsec = false;
    let hasRepeat = false;

    for (let i = 0; i < DRAW_SIZE; i++) {
      const n = nums[i];
      freq[n]++;
      if (idx >= recentStart) {
        recent100Freq[n]++;
      }

      const prevSeen = lastIndex[n];
      const gap = prevSeen === -1 ? idx : idx - prevSeen - 1;
      if (gap > maxDelay[n]) {
        maxDelay[n] = gap;
      }
      lastIndex[n] = idx;
      lastConcurso[n] = draw.concurso;
      lastDate[n] = draw.data || null;

      if (n % 2 === 0) evens++;
      sum += n;
      decadeTotals[Math.floor((n - 1) / 10)]++;

      if (i > 0 && n === nums[i - 1] + 1) {
        hasConsec = true;
      }
      if (prevSet && prevSet.has(n)) {
        hasRepeat = true;
      }
    }

    // Update pair and triplet co-occurrences
    for (let i = 0; i < DRAW_SIZE; i++) {
      for (let j = i + 1; j < DRAW_SIZE; j++) {
        const pairKey = nums[i] * 100 + nums[j];
        pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        for (let k = j + 1; k < DRAW_SIZE; k++) {
          const tripletKey = nums[i] * 10000 + nums[j] * 100 + nums[k];
          tripletCounts.set(tripletKey, (tripletCounts.get(tripletKey) || 0) + 1);
        }
      }
    }

    parityCounts[evens]++;
    sums.push(sum);
    for (let b = 0; b < sumBinBounds.length; b++) {
      if (sum <= sumBinBounds[b]) {
        sumBins[b]++;
        break;
      }
    }

    if (hasConsec) consecutiveDrawsCount++;
    if (hasRepeat) repeatFromPrevCount++;
    prevSet = new Set(nums);
  }

  // Finalize current delays (including trailing drought up to latest draw)
  const expectedFreq = totalDraws * (DRAW_SIZE / TOTAL_NUMBERS); // 0.1 * totalDraws
  const stdDev = Math.sqrt(totalDraws * 0.1 * 0.9);
  let chiSquare = 0;

  const numbers = [];
  for (let n = 1; n <= TOTAL_NUMBERS; n++) {
    const count = freq[n];
    const currentDelay = lastIndex[n] === -1 ? totalDraws : totalDraws - 1 - lastIndex[n];
    const finalMaxDelay = Math.max(maxDelay[n], currentDelay);
    const zScore = stdDev > 0 ? (count - expectedFreq) / stdDev : 0;
    const avgInterval = count > 0 ? totalDraws / count : null;

    if (expectedFreq > 0) {
      chiSquare += ((count - expectedFreq) ** 2) / expectedFreq;
    }

    numbers.push({
      number: n,
      frequency: count,
      drawRate: totalDraws > 0 ? count / totalDraws : 0,
      expectedFrequency: expectedFreq,
      zScore,
      currentDelay,
      maxDelay: finalMaxDelay,
      avgInterval,
      lastConcurso: lastConcurso[n] || null,
      lastDate: lastDate[n],
      recent100: recent100Freq[n]
    });
  }

  const pValue = totalDraws > 0 ? chiSquarePValue(chiSquare, TOTAL_NUMBERS - 1) : 1;

  // Sort rankings
  const byFrequencyDesc = [...numbers].sort((a, b) => b.frequency - a.frequency || a.number - b.number);
  const byDelayDesc = [...numbers].sort((a, b) => b.currentDelay - a.currentDelay || a.number - b.number);

  // Sum stats
  const sortedSums = [...sums].sort((a, b) => a - b);
  const sumMean = totalDraws > 0 ? sums.reduce((acc, s) => acc + s, 0) / totalDraws : 0;
  const sumMedian =
    totalDraws === 0
      ? 0
      : totalDraws % 2 === 1
      ? sortedSums[(totalDraws - 1) >> 1]
      : (sortedSums[totalDraws / 2 - 1] + sortedSums[totalDraws / 2]) / 2;

  const theoreticalParity = theoreticalParityDistribution();
  const parityComparison = theoreticalParity.map((tp) => ({
    evens: tp.evens,
    oddCount: tp.oddCount,
    observedCount: parityCounts[tp.evens],
    observedPercent: totalDraws > 0 ? (parityCounts[tp.evens] / totalDraws) * 100 : 0,
    theoreticalPercent: tp.percent,
    theoreticalExpectedCount: tp.probability * totalDraws
  }));

  const topPairs = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 20)
    .map(([key, count]) => ({
      a: Math.floor(key / 100),
      b: key % 100,
      count,
      rate: totalDraws > 0 ? count / totalDraws : 0
    }));

  const topTriplets = [...tripletCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 12)
    .map(([key, count]) => ({
      a: Math.floor(key / 10000),
      b: Math.floor((key % 10000) / 100),
      c: key % 100,
      count
    }));

  return {
    totalDraws,
    oldestDraw: totalDraws > 0 ? draws[0] : null,
    latestDraw: totalDraws > 0 ? draws[totalDraws - 1] : null,
    expectedFrequency: expectedFreq,
    chiSquare,
    chiSquarePValue: pValue,
    numbers,
    byFrequencyDesc,
    byDelayDesc,
    parityComparison,
    sumStats: {
      min: sortedSums[0] || 0,
      max: sortedSums[sortedSums.length - 1] || 0,
      mean: sumMean,
      median: sumMedian,
      bins: sumBinLabels.map((label, i) => ({ label, count: sumBins[i] }))
    },
    decadeTotals: decadeTotals.map((count, i) => ({
      label: `${String(i * 10 + 1).padStart(2, '0')}-${String((i + 1) * 10).padStart(2, '0')}`,
      count,
      rate: totalDraws > 0 ? count / (totalDraws * DRAW_SIZE) : 0
    })),
    consecutiveDrawsCount,
    consecutiveRate: totalDraws > 0 ? consecutiveDrawsCount / totalDraws : 0,
    repeatFromPrevCount,
    repeatFromPrevRate: totalDraws > 1 ? repeatFromPrevCount / (totalDraws - 1) : 0,
    topPairs,
    topTriplets,
    pairCounts
  };
}

/**
 * Get the most frequently co-occurring partner numbers for a specific target number (1..60).
 * @param {number} targetNumber
 * @param {Map<number, number>} pairCounts
 * @param {number} [limit=6]
 */
export function getTopPartners(targetNumber, pairCounts, limit = 6) {
  const partners = [];
  for (let other = 1; other <= TOTAL_NUMBERS; other++) {
    if (other === targetNumber) continue;
    const a = Math.min(targetNumber, other);
    const b = Math.max(targetNumber, other);
    const count = pairCounts.get(a * 100 + b) || 0;
    partners.push({ number: other, count });
  }
  return partners.sort((x, y) => y.count - x.count || x.number - y.number).slice(0, limit);
}

/**
 * Check how many times a user's selected numbers matched 3, 4, 5, or 6 drawn numbers across history.
 * @param {number[]} selectedNumbers
 * @param {Array<{ concurso: number, data: string, dezenas: number[] }>} draws
 */
export function checkHistoricalMatches(selectedNumbers, draws) {
  const selectedSet = new Set(selectedNumbers);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const notableMatches = [];

  const minNotable = selectedSet.size >= 6 ? 4 : Math.min(3, selectedSet.size);

  for (let i = draws.length - 1; i >= 0; i--) {
    const draw = draws[i];
    let hits = 0;
    const matched = [];
    for (const n of draw.dezenas) {
      if (selectedSet.has(n)) {
        hits++;
        matched.push(n);
      }
    }
    if (hits >= 1 && hits <= 6) {
      counts[hits]++;
    }
    if (hits >= minNotable && notableMatches.length < 30) {
      notableMatches.push({
        concurso: draw.concurso,
        data: draw.data,
        dezenas: draw.dezenas,
        hits,
        matched: matched.sort((a, b) => a - b)
      });
    }
  }

  return {
    selectedCount: selectedSet.size,
    totalDrawsChecked: draws.length,
    counts,
    notableMatches: notableMatches.sort((a, b) => b.hits - a.hits || b.concurso - a.concurso)
  };
}

/**
 * Run a Monte Carlo simulation of N Mega-Sena draws and compare empirical results
 * against exact hypergeometric theory.
 * @param {number[]} selectedNumbers - User's selected numbers (0..20 or any 1..60 subset)
 * @param {number} iterations - Number of draws to simulate (e.g., 1000..50000)
 * @param {number} [seed]
 */
export function runMonteCarloSimulation(selectedNumbers, iterations = 10000, seed = undefined) {
  const safeIterations = Math.max(100, Math.min(100000, Math.floor(iterations)));
  const rng = seed !== undefined ? createPrng(seed) : Math.random;
  const selected = [...new Set(selectedNumbers)].filter((n) => n >= 1 && n <= 60).sort((a, b) => a - b);
  const selectedSet = new Set(selected);

  const numberFreq = new Int32Array(TOTAL_NUMBERS + 1);
  const hitDistribution = new Int32Array(DRAW_SIZE + 1);

  for (let iter = 0; iter < safeIterations; iter++) {
    const draw = drawRandomNumbers(rng, DRAW_SIZE);
    let hits = 0;
    for (let i = 0; i < DRAW_SIZE; i++) {
      const n = draw[i];
      numberFreq[n]++;
      if (selectedSet.has(n)) {
        hits++;
      }
    }
    hitDistribution[hits]++;
  }

  const expectedNumFreq = safeIterations * (DRAW_SIZE / TOTAL_NUMBERS);
  let simChiSquare = 0;
  let minFreq = Infinity;
  let maxFreq = -1;
  let hottestNumber = 1;
  let coldestNumber = 1;

  for (let n = 1; n <= TOTAL_NUMBERS; n++) {
    const f = numberFreq[n];
    simChiSquare += ((f - expectedNumFreq) ** 2) / expectedNumFreq;
    if (f > maxFreq) {
      maxFreq = f;
      hottestNumber = n;
    }
    if (f < minFreq) {
      minFreq = f;
      coldestNumber = n;
    }
  }

  let comparisonRows = [];
  if (selected.length >= 6 && selected.length <= 20) {
    const ticket = calculateTicketOdds(selected.length);
    comparisonRows = [
      { label: 'Quadra (4 acertos)', hits: 4, observed: hitDistribution[4], theoreticalProb: ticket.quadra.probability },
      { label: 'Quina (5 acertos)', hits: 5, observed: hitDistribution[5], theoreticalProb: ticket.quina.probability },
      { label: 'Sena (6 acertos)', hits: 6, observed: hitDistribution[6], theoreticalProb: ticket.sena.probability }
    ].map((r) => ({
      ...r,
      observedRate: r.observed / safeIterations,
      expectedCount: r.theoreticalProb * safeIterations
    }));
  } else if (selected.length >= 1) {
    const target = calculateTargetNumbersOdds(selected.length);
    comparisonRows = target.distribution.map((row) => ({
      label: `${row.hits} acerto${row.hits === 1 ? '' : 's'}`,
      hits: row.hits,
      observed: hitDistribution[row.hits],
      observedRate: hitDistribution[row.hits] / safeIterations,
      theoreticalProb: row.probability,
      expectedCount: row.probability * safeIterations
    }));
  }

  return {
    iterations: safeIterations,
    selectedCount: selected.length,
    expectedNumFreq,
    simChiSquare,
    simChiSquarePValue: chiSquarePValue(simChiSquare, TOTAL_NUMBERS - 1),
    hottest: { number: hottestNumber, frequency: maxFreq },
    coldest: { number: coldestNumber, frequency: minFreq },
    hitDistribution: Array.from(hitDistribution),
    comparisonRows
  };
}

/**
 * Generate a combination of numbers matching optional structural filters.
 * @param {{
 *   betSize?: number,
 *   fixedNumbers?: number[],
 *   excludedNumbers?: number[],
 *   minEvens?: number,
 *   maxEvens?: number,
 *   minSum?: number,
 *   maxSum?: number,
 *   seed?: number
 * }} options
 */
export function generateSmartCombination(options = {}) {
  const betSize = options.betSize ?? 6;
  if (betSize < 6 || betSize > 15) {
    throw new RangeError('Tamanho da aposta para geração deve ser entre 6 e 15.');
  }

  const fixed = [...new Set(options.fixedNumbers || [])].filter((n) => n >= 1 && n <= 60);
  const excluded = new Set((options.excludedNumbers || []).filter((n) => !fixed.includes(n)));

  if (fixed.length > betSize) {
    return { error: `Você fixou ${fixed.length} dezenas, mas o jogo tem tamanho ${betSize}.` };
  }

  const availablePool = [];
  for (let n = 1; n <= TOTAL_NUMBERS; n++) {
    if (!fixed.includes(n) && !excluded.has(n)) {
      availablePool.push(n);
    }
  }

  const needed = betSize - fixed.length;
  if (availablePool.length < needed) {
    return { error: 'Não há dezenas disponíveis suficientes após aplicar exclusões.' };
  }

  const minEvens = options.minEvens ?? 0;
  const maxEvens = options.maxEvens ?? betSize;
  const minSum = options.minSum ?? 0;
  const maxSum = options.maxSum ?? 9999;
  const rng = options.seed !== undefined ? createPrng(options.seed) : Math.random;

  const maxAttempts = 5000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Partial Fisher-Yates on availablePool copy
    const pool = [...availablePool];
    const picked = [...fixed];
    for (let i = 0; i < needed; i++) {
      const j = i + Math.floor(rng() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      picked.push(pool[i]);
    }

    let evens = 0;
    let sum = 0;
    for (const n of picked) {
      if (n % 2 === 0) evens++;
      sum += n;
    }

    if (evens >= minEvens && evens <= maxEvens && sum >= minSum && sum <= maxSum) {
      return {
        numbers: picked.sort((a, b) => a - b),
        attempts: attempt,
        evens,
        odds: betSize - evens,
        sum
      };
    }
  }

  return {
    error: 'Nenhuma combinação satisfez todos os filtros em 5.000 tentativas. Tente ampliar os intervalos.'
  };
}
