import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDrawStatistics,
  checkHistoricalMatches,
  runMonteCarloSimulation,
  generateSmartCombination
} from '../src/stats.js';
import { generateSimulatedBaseline, parseDrawsPayload } from '../src/data.js';

test('generateSimulatedBaseline produces valid unique sorted draws', () => {
  const ds = generateSimulatedBaseline(150);
  assert.equal(ds.isSimulated, true);
  assert.equal(ds.draws.length, 150);
  for (const d of ds.draws) {
    assert.equal(d.dezenas.length, 6);
    assert.equal(new Set(d.dezenas).size, 6);
    for (let i = 0; i < d.dezenas.length; i++) {
      assert.ok(d.dezenas[i] >= 1 && d.dezenas[i] <= 60);
      if (i > 0) assert.ok(d.dezenas[i] > d.dezenas[i - 1]);
    }
  }
});

test('computeDrawStatistics computes exact frequencies, delays, and match history', () => {
  const sampleDraws = [
    { concurso: 1, data: '01/01/2024', dezenas: [1, 2, 3, 4, 5, 6] },
    { concurso: 2, data: '04/01/2024', dezenas: [10, 20, 30, 40, 50, 60] },
    { concurso: 3, data: '08/01/2024', dezenas: [1, 15, 25, 35, 45, 55] }
  ];

  const stats = computeDrawStatistics(sampleDraws);
  assert.equal(stats.totalDraws, 3);
  assert.equal(stats.numbers[0].frequency, 2); // number 01 appeared in draws 1 & 3
  assert.equal(stats.numbers[0].currentDelay, 0);
  assert.equal(stats.numbers[0].maxDelay, 1);
  assert.equal(stats.numbers[1].currentDelay, 2); // number 02 only in draw 1
  assert.equal(stats.consecutiveDrawsCount, 1); // draw 1 has 1..6

  const matches = checkHistoricalMatches([1, 2, 3, 4, 5, 6], sampleDraws);
  assert.equal(matches.counts[6], 1);
  assert.equal(matches.counts[1], 1);
  assert.equal(matches.notableMatches.length, 1);
});

test('runMonteCarloSimulation and generateSmartCombination behave deterministically with seed', () => {
  const sim = runMonteCarloSimulation([4, 10, 23, 33, 42, 53], 2000, 12345);
  assert.equal(sim.iterations, 2000);
  assert.equal(sim.hitDistribution.reduce((a, b) => a + b, 0), 2000);
  assert.ok(sim.simChiSquare > 0);

  const gen = generateSmartCombination({
    betSize: 6,
    fixedNumbers: [10, 20],
    excludedNumbers: [1, 60],
    minEvens: 3,
    maxEvens: 3,
    minSum: 150,
    maxSum: 210,
    seed: 999
  });
  assert.equal(gen.error, undefined);
  assert.equal(gen.numbers.length, 6);
  assert.ok(gen.numbers.includes(10) && gen.numbers.includes(20));
  assert.ok(!gen.numbers.includes(1) && !gen.numbers.includes(60));
  assert.equal(gen.evens, 3);
  assert.ok(gen.sum >= 150 && gen.sum <= 210);
});

test('parseDrawsPayload parses loteria.json, array JSON, and CSV text', () => {
  const objFmt = parseDrawsPayload(
    JSON.stringify({
      1: ['04', '05', '30', '33', '41', '52'],
      2: ['09', '37', '39', '41', '43', '49']
    })
  );
  assert.equal(objFmt.length, 2);
  assert.deepEqual(objFmt[0].dezenas, [4, 5, 30, 33, 41, 52]);

  const arrFmt = parseDrawsPayload([
    { concurso: 100, data: '10/10/2020', dezenas: ['01', '02', '03', '04', '05', '06'] }
  ]);
  assert.equal(arrFmt.length, 1);
  assert.equal(arrFmt[0].concurso, 100);

  const csvFmt = parseDrawsPayload('Concurso;Data;B1;B2;B3;B4;B5;B6\n50;15/05/2021;05;12;23;34;45;56');
  assert.equal(csvFmt.length, 1);
  assert.equal(csvFmt[0].concurso, 50);
  assert.deepEqual(csvFmt[0].dezenas, [5, 12, 23, 34, 45, 56]);
});
