import test from 'node:test';
import assert from 'node:assert/strict';
import {
  comb,
  TOTAL_COMBINATIONS,
  calculateTicketOdds,
  calculateTargetNumbersOdds,
  multiDrawProbability,
  theoreticalParityDistribution,
  theoreticalConsecutivePairOdds,
  analyzeCombinationStructure,
  chiSquarePValue
} from '../src/math.js';

test('comb calculates exact Mega-Sena sample space C(60, 6)', () => {
  assert.equal(TOTAL_COMBINATIONS, 50063860n);
  assert.equal(comb(6, 6), 1n);
  assert.equal(comb(60, 0), 1n);
  assert.equal(comb(60, 1), 60n);
  assert.equal(comb(7, 6), 7n);
});

test('calculateTicketOdds matches official Caixa probabilities for 6 and 7 numbers', () => {
  const bet6 = calculateTicketOdds(6, 5.0);
  assert.equal(bet6.gamesCount, 1n);
  assert.equal(bet6.estimatedCost, 5);
  assert.equal(bet6.sena.favorable, 1n);
  assert.equal(Math.round(bet6.sena.odds), 50063860);
  assert.equal(Math.round(bet6.quina.odds), 154518);
  assert.equal(Math.round(bet6.quadra.odds), 2332);

  const bet7 = calculateTicketOdds(7, 5.0);
  assert.equal(bet7.gamesCount, 7n);
  assert.equal(bet7.estimatedCost, 35);
  assert.equal(Math.round(bet7.sena.odds), 7151980);
  assert.equal(Math.round(bet7.quina.odds), 44981);
  assert.equal(Math.round(bet7.quadra.odds), 1038);
});

test('calculateTargetNumbersOdds hypergeometric distribution sums to 100%', () => {
  for (const m of [1, 2, 4, 6, 10, 15]) {
    const res = calculateTargetNumbersOdds(m);
    const totalFav = res.distribution.reduce((acc, row) => acc + row.favorable, 0n);
    assert.equal(totalFav, TOTAL_COMBINATIONS);
  }

  // Exact probability of 1 specific number appearing in 6 drawn balls is 6/60 = 10%
  const oneNum = calculateTargetNumbersOdds(1);
  assert.ok(Math.abs(oneNum.allAppear.probability - 0.1) < 1e-12);
  assert.equal(Math.round(oneNum.allAppear.odds), 10);

  // Exact probability of 2 specific numbers both appearing is C(58,4)/C(60,6) = 1 / 118
  const twoNums = calculateTargetNumbersOdds(2);
  assert.equal(Math.round(twoNums.allAppear.odds), 118);
});

test('multiDrawProbability handles small and normal probabilities accurately', () => {
  assert.equal(multiDrawProbability(0, 100), 0);
  assert.equal(multiDrawProbability(0.1, 1), 0.1);
  // 1 - 0.9^10 = 0.6513215599
  assert.ok(Math.abs(multiDrawProbability(0.1, 10) - 0.6513215599) < 1e-9);
  // Tiny Sena probability over 52 draws should be ~ 52 / 50,063,860
  const pSena = 1 / 50063860;
  const p52 = multiDrawProbability(pSena, 52);
  assert.ok(Math.abs(p52 - 52 * pSena) < 1e-12);
});

test('theoreticalParityDistribution and consecutive pair odds sum to total space', () => {
  const parity = theoreticalParityDistribution();
  const sumFav = parity.reduce((acc, row) => acc + row.favorable, 0n);
  assert.equal(sumFav, TOTAL_COMBINATIONS);
  for (const row of parity) {
    assert.equal(row.evens + row.oddCount, 6);
  }

  const consec = theoreticalConsecutivePairOdds();
  assert.equal(consec.withConsecutive.favorable + consec.withoutConsecutive.favorable, TOTAL_COMBINATIONS);
  // C(55,6) = 28,989,675 => withConsec ~ 42.09%
  assert.ok(consec.withConsecutive.percent > 42 && consec.withConsecutive.percent < 42.2);
});

test('analyzeCombinationStructure and chiSquarePValue compute expected metrics', () => {
  const info = analyzeCombinationStructure([2, 3, 10, 25, 40, 59]);
  assert.equal(info.count, 6);
  assert.equal(info.evens, 3);
  assert.equal(info.odds, 3);
  assert.equal(info.sum, 139);
  assert.equal(info.consecutivePairs, 1); // 2, 3
  assert.equal(info.primeCount, 3); // 2, 3, 59

  // Chi-square near degrees of freedom (59) has p-value near ~0.5
  const pMid = chiSquarePValue(59, 59);
  assert.ok(pMid > 0.4 && pMid < 0.6);
});
