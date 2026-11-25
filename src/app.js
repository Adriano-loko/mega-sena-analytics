import {
  TOTAL_COMBINATIONS,
  calculateTicketOdds,
  calculateTargetNumbersOdds,
  multiDrawProbability,
  analyzeCombinationStructure,
  theoreticalConsecutivePairOdds
} from './math.js';
import {
  computeDrawStatistics,
  getTopPartners,
  checkHistoricalMatches,
  runMonteCarloSimulation,
  generateSmartCombination,
  drawRandomNumbers
} from './stats.js';
import {
  STORAGE_KEY,
  generateSimulatedBaseline,
  parseDrawsPayload,
  syncOnlineDraws
} from './data.js';
import { renderComparisonColumnChart, renderHorizontalBars } from './charts.js';

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function pad2(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatOdds(odds) {
  if (!odds || !Number.isFinite(odds)) return '—';
  if (odds >= 100) return `1 em ${fmtInt.format(Math.round(odds))}`;
  return `1 em ${odds.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
}

function formatPercent(prob) {
  const pct = prob * 100;
  if (pct === 0) return '0%';
  if (pct >= 1) return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (pct >= 0.01) return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  return `${pct.toLocaleString('pt-BR', { minimumSignificantDigits: 2, maximumSignificantDigits: 3 })}%`;
}

function parseNumberListInput(text) {
  const tokens = String(text || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
  return [...new Set(tokens)].sort((a, b) => a - b);
}

const state = {
  dataset: null,
  stats: null,
  activeTab: 'overview',
  heatmapMode: 'frequency',
  inspectedNumber: 10,
  selectedNumbers: [4, 10, 23, 33, 42, 53],
  horizonDraws: 52,
  ticketSize: 6,
  unitPrice: 5.0,
  historyPage: 1,
  historyPageSize: 20,
  historySearchConcurso: '',
  historySearchNumbers: ''
};

function loadInitialDataset() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.draws) && parsed.draws.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore invalid storage
  }
  return generateSimulatedBaseline(2800);
}

function setDataset(dataset, persist = true) {
  state.dataset = dataset;
  state.stats = computeDrawStatistics(dataset.draws);
  state.historyPage = 1;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
    } catch {
      // Ignore quota errors
    }
  }
  renderAll();
}

function showBanner(message, isError = false) {
  const banner = document.getElementById('status-banner');
  banner.textContent = message;
  banner.classList.toggle('error', isError);
  banner.classList.remove('hidden');
}

function renderDatasetBadge() {
  const badge = document.getElementById('dataset-badge');
  const label = document.getElementById('dataset-label');
  const isReal = !state.dataset.isSimulated;
  badge.classList.toggle('real', isReal);
  badge.classList.toggle('simulated', !isReal);
  const countStr = fmtInt.format(state.stats.totalDraws);
  label.textContent = `${state.dataset.source} • ${countStr} concursos`;
}

function renderOverview() {
  const s = state.stats;
  const hottest = s.byFrequencyDesc[0];
  const mostDelayed = s.byDelayDesc[0];
  const theoConsec = theoreticalConsecutivePairOdds();

  const chiStatus =
    s.chiSquarePValue >= 0.05
      ? 'Compatível com sorteio aleatório'
      : 'Desvio estatístico detectado';

  document.getElementById('overview-kpis').innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">Concursos Analisados</div>
      <div class="kpi-value">${fmtInt.format(s.totalDraws)}</div>
      <div class="kpi-sub">Último: #${s.latestDraw ? s.latestDraw.concurso : '—'} ${s.latestDraw?.data ? `(${escapeHtml(s.latestDraw.data)})` : ''}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Dezena Mais Sorteada</div>
      <div class="kpi-value">#${pad2(hottest.number)} (${fmtInt.format(hottest.frequency)}x)</div>
      <div class="kpi-sub">Esperado: ${s.expectedFrequency.toFixed(1)}x • ${formatPercent(hottest.drawRate)} dos sorteios</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Maior Atraso Atual</div>
      <div class="kpi-value">#${pad2(mostDelayed.number)} (${mostDelayed.currentDelay} conc.)</div>
      <div class="kpi-sub">Máximo histórico desta dezena: ${mostDelayed.maxDelay} concursos</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Teste Qui-Quadrado (χ²)</div>
      <div class="kpi-value">${s.chiSquare.toFixed(1)} (p=${s.chiSquarePValue.toFixed(2)})</div>
      <div class="kpi-sub">${chiStatus} • Consecutivos: ${(s.consecutiveRate * 100).toFixed(1)}% (teoria ${(theoConsec.withConsecutive.percent).toFixed(1)}%)</div>
    </div>
  `;

  renderHeatmap();
  renderInspector();
  renderOverviewCharts();
}

function heatColor(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  // Interpolate deep emerald (#14382c) -> emerald (#00a86b) -> warm gold (#d99b26)
  if (clamped < 0.65) {
    const t = clamped / 0.65;
    const r = Math.round(20 + (0 - 20) * t);
    const g = Math.round(56 + (168 - 56) * t);
    const b = Math.round(44 + (107 - 44) * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const t = (clamped - 0.65) / 0.35;
  const r = Math.round(0 + (217 - 0) * t);
  const g = Math.round(168 + (155 - 168) * t);
  const b = Math.round(107 + (38 - 107) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  const nums = state.stats.numbers;

  const metricGetter = (item) => {
    if (state.heatmapMode === 'delay') return item.currentDelay;
    if (state.heatmapMode === 'recent') return item.recent100;
    return item.frequency;
  };

  const values = nums.map(metricGetter);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const span = Math.max(1, maxVal - minVal);

  grid.innerHTML = nums
    .map((item) => {
      const val = metricGetter(item);
      const ratio = (val - minVal) / span;
      const meta =
        state.heatmapMode === 'delay'
          ? `${val} atr.`
          : state.heatmapMode === 'recent'
          ? `${val}/100`
          : `${val}x`;
      const active = item.number === state.inspectedNumber ? 'active' : '';
      return `
        <button
          type="button"
          class="heat-cell ${active}"
          data-inspect="${item.number}"
          style="background-color: ${heatColor(ratio)}"
          title="Dezena ${pad2(item.number)}: ${item.frequency} sorteios, atraso atual ${item.currentDelay}"
        >
          <span class="heat-num">${pad2(item.number)}</span>
          <span class="heat-meta">${meta}</span>
        </button>
      `;
    })
    .join('');
}

function renderInspector() {
  const target = state.stats.numbers[state.inspectedNumber - 1];
  const partners = getTopPartners(target.number, state.stats.pairCounts, 6);
  const rankFreq = state.stats.byFrequencyDesc.findIndex((n) => n.number === target.number) + 1;
  const zFormatted = (target.zScore >= 0 ? '+' : '') + target.zScore.toFixed(2);

  document.getElementById('number-inspector').innerHTML = `
    <div class="inspector-top">
      <div class="ball hero gold">${pad2(target.number)}</div>
      <div>
        <h3>Dezena ${pad2(target.number)} — #${rankFreq}º lugar em frequência</h3>
        <p class="muted">
          Saiu em <strong>${(target.drawRate * 100).toFixed(2)}%</strong> dos concursos
          (teoria esperada: 10,00% • desvio z = ${zFormatted})
        </p>
      </div>
    </div>

    <div class="stat-list">
      <div class="stat-box">
        <span>Total de Aparições</span>
        <strong>${fmtInt.format(target.frequency)} (esp. ${target.expectedFrequency.toFixed(0)})</strong>
      </div>
      <div class="stat-box">
        <span>Atraso Atual / Máximo</span>
        <strong>${target.currentDelay} / ${target.maxDelay} concursos</strong>
      </div>
      <div class="stat-box">
        <span>Intervalo Médio</span>
        <strong>${target.avgInterval ? `${target.avgInterval.toFixed(1)} concursos` : '—'}</strong>
      </div>
      <div class="stat-box">
        <span>Último Sorteio</span>
        <strong>${target.lastConcurso ? `#${target.lastConcurso}` : 'Nunca'} ${target.lastDate ? `(${escapeHtml(target.lastDate)})` : ''}</strong>
      </div>
    </div>

    <div>
      <div class="muted small-note">Parceiras mais frequentes com a dezena ${pad2(target.number)}:</div>
      <div class="ball-row">
        ${partners
          .map(
            (p) =>
              `<span class="pill-tag"><strong class="ball sm">${pad2(p.number)}</strong> ${p.count}x juntas</span>`
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderOverviewCharts() {
  const s = state.stats;

  renderComparisonColumnChart(
    document.getElementById('chart-parity'),
    s.parityComparison.map((p) => ({
      label: `${p.evens}P/${p.oddCount}I`,
      primary: p.observedPercent,
      secondary: p.theoreticalPercent,
      primaryText: `${p.observedPercent.toFixed(1)}%`,
      secondaryText: `${p.theoreticalPercent.toFixed(1)}%`
    })),
    { primaryLabel: 'Observado (%)', secondaryLabel: 'Teórico Exato (%)' }
  );

  document.getElementById('sum-summary-desc').textContent =
    `Média observada: ${s.sumStats.mean.toFixed(1)} (teórica: 183,0) • Mediana: ${s.sumStats.median.toFixed(0)} • Min/Máx: ${s.sumStats.min}/${s.sumStats.max}`;

  renderComparisonColumnChart(
    document.getElementById('chart-sums'),
    s.sumStats.bins.map((b) => {
      const pct = s.totalDraws > 0 ? (b.count / s.totalDraws) * 100 : 0;
      return {
        label: b.label,
        primary: pct,
        primaryText: `${pct.toFixed(1)}%`
      };
    }),
    { primaryLabel: '% dos Concursos por Faixa de Soma' }
  );

  renderHorizontalBars(
    document.getElementById('chart-hottest'),
    s.byFrequencyDesc.slice(0, 12).map((n) => ({
      label: `Dezena ${pad2(n.number)}`,
      value: n.frequency,
      displayValue: `${fmtInt.format(n.frequency)}x`,
      subText: `${(n.drawRate * 100).toFixed(1)}%`,
      tone: 'emerald'
    }))
  );

  renderHorizontalBars(
    document.getElementById('chart-delayed'),
    s.byDelayDesc.slice(0, 12).map((n) => ({
      label: `Dezena ${pad2(n.number)}`,
      value: n.currentDelay,
      displayValue: `${n.currentDelay} conc.`,
      subText: `máx ${n.maxDelay}`,
      tone: 'gold'
    }))
  );

  renderHorizontalBars(
    document.getElementById('chart-pairs'),
    s.topPairs.slice(0, 12).map((p) => ({
      label: `${pad2(p.a)} & ${pad2(p.b)}`,
      value: p.count,
      displayValue: `${p.count}x`,
      subText: `${(p.rate * 100).toFixed(2)}%`,
      tone: 'neutral'
    }))
  );
}

function renderSelectorBoard() {
  const board = document.getElementById('selector-board');
  const selectedSet = new Set(state.selectedNumbers);

  let html = '';
  for (let n = 1; n <= 60; n++) {
    const isSel = selectedSet.has(n);
    html += `<button type="button" class="sel-btn ${isSel ? 'selected' : ''}" data-pick="${n}">${pad2(n)}</button>`;
  }
  board.innerHTML = html;

  document.getElementById('selected-count').textContent = String(state.selectedNumbers.length);
  const pills = document.getElementById('selected-pills');
  pills.innerHTML = state.selectedNumbers.length
    ? state.selectedNumbers.map((n) => `<span class="ball sm">${pad2(n)}</span>`).join('')
    : '<span class="muted">Nenhuma dezena selecionada.</span>';
}

function renderTargetOdds() {
  const panel = document.getElementById('target-odds-panel');
  const m = state.selectedNumbers.length;

  if (m === 0) {
    panel.innerHTML = '<p class="muted">Selecione ao menos 1 dezena no volante ao lado para ver as possibilidades exatas.</p>';
    return;
  }

  const targetStats = calculateTargetNumbersOdds(m);
  const allAppearHtml = targetStats.allAppear
    ? `
      <div class="stat-box" style="margin-bottom: 12px; border-color: rgba(32,227,155,0.4);">
        <span>Probabilidade de <strong>TODOS os ${m} números</strong> saírem no próximo sorteio</span>
        <strong>${formatOdds(targetStats.allAppear.odds)} (${formatPercent(targetStats.allAppear.probability)})</strong>
      </div>
    `
    : `<p class="muted small-note">Com ${m} dezenas selecionadas (&gt;6), apenas parte delas pode caber nas 6 bolas sorteadas.</p>`;

  const atLeastRows = targetStats.atLeast
    .map(
      (r) => `
      <tr>
        <td>Pelo menos ${r.minHits} de ${m}</td>
        <td><strong>${formatOdds(r.odds)}</strong></td>
        <td>${formatPercent(r.probability)}</td>
        <td>${fmtInt.format(r.favorable)}</td>
      </tr>
    `
    )
    .join('');

  panel.innerHTML = `
    ${allAppearHtml}
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Evento no Sorteio (6 bolas)</th>
            <th>Chance (1 em X)</th>
            <th>Probabilidade</th>
            <th>Combinações</th>
          </tr>
        </thead>
        <tbody>
          ${atLeastRows}
        </tbody>
      </table>
    </div>
    <div id="target-dist-bars" style="margin-top: 14px;"></div>
  `;

  renderHorizontalBars(
    document.getElementById('target-dist-bars'),
    targetStats.distribution.map((d) => ({
      label: `${d.hits} acerto${d.hits === 1 ? '' : 's'}`,
      value: d.percent,
      displayValue: formatPercent(d.probability),
      subText: formatOdds(d.odds),
      tone: d.hits >= 4 ? 'gold' : 'emerald'
    }))
  );
}

function renderHorizonResults() {
  const container = document.getElementById('horizon-results');
  const n = state.horizonDraws;
  const m = state.selectedNumbers.length;

  if (m === 0) {
    container.innerHTML = '<p class="muted">Selecione números no volante para calcular em N concursos.</p>';
    return;
  }

  const target = calculateTargetNumbersOdds(m);
  const rows = [];

  if (m >= 6) {
    const ticket = calculateTicketOdds(m, state.unitPrice);
    rows.push(
      { name: `Quadra (4+ com volante de ${m})`, p: ticket.quadra.probability + ticket.quina.probability + ticket.sena.probability },
      { name: `Quina (5+ com volante de ${m})`, p: ticket.quina.probability + ticket.sena.probability },
      { name: `Sena (6 acertos com volante de ${m})`, p: ticket.sena.probability }
    );
  } else {
    if (target.allAppear) {
      rows.push({ name: `Sair todos os ${m} escolhidos`, p: target.allAppear.probability });
    }
    const atLeastOne = target.atLeast.find((r) => r.minHits === 1);
    if (atLeastOne) {
      rows.push({ name: `Sair ao menos 1 dos ${m} escolhidos`, p: atLeastOne.probability });
    }
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Objetivo</th>
            <th>Em 1 concurso</th>
            <th>Em ${fmtInt.format(n)} concursos</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((r) => {
              const pN = multiDrawProbability(r.p, n);
              return `
                <tr>
                  <td>${escapeHtml(r.name)}</td>
                  <td>${formatPercent(r.p)}</td>
                  <td><strong>${formatPercent(pN)}</strong></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderTicketOdds() {
  const label = document.getElementById('ticket-size-label');
  const slider = document.getElementById('ticket-size-slider');
  slider.value = String(state.ticketSize);
  label.textContent = String(state.ticketSize);

  const res = calculateTicketOdds(state.ticketSize, state.unitPrice);
  const container = document.getElementById('ticket-odds-results');

  container.innerHTML = `
    <div class="stat-list">
      <div class="stat-box">
        <span>Jogos Simples Equivalentes</span>
        <strong>${fmtInt.format(res.gamesCount)} combinações</strong>
      </div>
      <div class="stat-box">
        <span>Custo Estimado do Volante</span>
        <strong>${fmtCurrency.format(res.estimatedCost)}</strong>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Faixa</th>
            <th>Probabilidade (1 em X)</th>
            <th>Percentual</th>
          </tr>
        </thead>
        <tbody>
          <tr class="highlight-row">
            <td>Sena (6 acertos)</td>
            <td><strong>${formatOdds(res.sena.odds)}</strong></td>
            <td>${formatPercent(res.sena.probability)}</td>
          </tr>
          <tr>
            <td>Quina (5 acertos)</td>
            <td><strong>${formatOdds(res.quina.odds)}</strong></td>
            <td>${formatPercent(res.quina.probability)}</td>
          </tr>
          <tr>
            <td>Quadra (4 acertos)</td>
            <td><strong>${formatOdds(res.quadra.odds)}</strong></td>
            <td>${formatPercent(res.quadra.probability)}</td>
          </tr>
          <tr>
            <td>Terno (3 acertos • s/ prêmio)</td>
            <td>${formatOdds(res.terno.odds)}</td>
            <td>${formatPercent(res.terno.probability)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderSelectionHistoryCheck() {
  const container = document.getElementById('selection-history-check');
  const nums = state.selectedNumbers;

  if (nums.length === 0) {
    container.innerHTML = '<p class="muted">Selecione números acima para analisar estrutura e desempenho histórico.</p>';
    return;
  }

  const struct = analyzeCombinationStructure(nums);
  const hist = checkHistoricalMatches(nums, state.dataset.draws);

  const matchesHtml = hist.notableMatches.length
    ? `
      <div class="table-wrap" style="margin-top: 12px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Concurso</th>
              <th>Data</th>
              <th>Acertos</th>
              <th>Dezenas Sorteadas</th>
            </tr>
          </thead>
          <tbody>
            ${hist.notableMatches
              .slice(0, 10)
              .map((m) => {
                const matchedSet = new Set(m.matched);
                return `
                  <tr>
                    <td>#${m.concurso}</td>
                    <td>${escapeHtml(m.data || '—')}</td>
                    <td><strong>${m.hits} acertos</strong></td>
                    <td>
                      <div class="ball-row compact">
                        ${m.dezenas
                          .map((d) => `<span class="ball sm ${matchedSet.has(d) ? 'gold' : ''}">${pad2(d)}</span>`)
                          .join('')}
                      </div>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `
    : '<p class="muted small-note" style="margin-top: 10px;">Nenhuma premiação (Quadra/Quina/Sena) encontrada para esta seleção na base atual.</p>';

  container.innerHTML = `
    <div class="stat-list" style="grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));">
      <div class="stat-box">
        <span>Pares / Ímpares</span>
        <strong>${struct.evens}P / ${struct.odds}I</strong>
      </div>
      <div class="stat-box">
        <span>Soma das Dezenas</span>
        <strong>${struct.sum} (média ${(struct.mean).toFixed(1)})</strong>
      </div>
      <div class="stat-box">
        <span>Pares Consecutivos</span>
        <strong>${struct.consecutivePairs}</strong>
      </div>
      <div class="stat-box">
        <span>Primos / Finais Repetidos</span>
        <strong>${struct.primeCount} / ${struct.repeatedEndings}</strong>
      </div>
      <div class="stat-box">
        <span>Histórico: Quadras (4)</span>
        <strong>${fmtInt.format(hist.counts[4])}x</strong>
      </div>
      <div class="stat-box">
        <span>Histórico: Quinas (5) / Senas (6)</span>
        <strong>${fmtInt.format(hist.counts[5])}x / ${fmtInt.format(hist.counts[6])}x</strong>
      </div>
    </div>
    ${matchesHtml}
  `;
}

function renderProbabilityTab() {
  renderSelectorBoard();
  renderTargetOdds();
  renderHorizonResults();
  renderTicketOdds();
  renderSelectionHistoryCheck();
}

function renderMonteCarlo() {
  const iterations = Number(document.getElementById('sim-iterations').value || 10000);
  const targetNums = state.selectedNumbers.length >= 1 ? state.selectedNumbers : [4, 10, 23, 33, 42, 53];
  const sim = runMonteCarloSimulation(targetNums, iterations);

  const rowsHtml = sim.comparisonRows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.label)}</td>
        <td><strong>${fmtInt.format(r.observed)}</strong></td>
        <td>${r.expectedCount.toFixed(1)}</td>
        <td>${formatPercent(r.observedRate)}</td>
        <td>${formatPercent(r.theoreticalProb)}</td>
      </tr>
    `
    )
    .join('');

  document.getElementById('sim-results').innerHTML = `
    <div class="stat-list">
      <div class="stat-box">
        <span>Amostra Simulada</span>
        <strong>${fmtInt.format(sim.iterations)} sorteios</strong>
      </div>
      <div class="stat-box">
        <span>Dezenas Avaliadas</span>
        <strong>${sim.selectedCount} números</strong>
      </div>
      <div class="stat-box">
        <span>Mais / Menos Frequente</span>
        <strong>#${pad2(sim.hottest.number)} (${sim.hottest.frequency}x) / #${pad2(sim.coldest.number)} (${sim.coldest.frequency}x)</strong>
      </div>
      <div class="stat-box">
        <span>Qui-Quadrado Simulação</span>
        <strong>${sim.simChiSquare.toFixed(1)} (p=${sim.simChiSquarePValue.toFixed(2)})</strong>
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Faixa</th>
            <th>Observado</th>
            <th>Esperado (Teoria)</th>
            <th>Taxa Simulada</th>
            <th>Taxa Exata</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function renderHistoryTab() {
  const searchConcurso = state.historySearchConcurso.trim();
  const filterNums = parseNumberListInput(state.historySearchNumbers);

  const drawsDesc = [...state.dataset.draws].sort((a, b) => b.concurso - a.concurso);
  const filtered = drawsDesc.filter((d) => {
    if (searchConcurso && String(d.concurso) !== searchConcurso) return false;
    if (filterNums.length > 0) {
      const dSet = new Set(d.dezenas);
      for (const req of filterNums) {
        if (!dSet.has(req)) return false;
      }
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / state.historyPageSize));
  state.historyPage = Math.min(state.historyPage, totalPages);
  const start = (state.historyPage - 1) * state.historyPageSize;
  const pageItems = filtered.slice(start, start + state.historyPageSize);

  document.getElementById('history-summary').textContent =
    `Exibindo ${pageItems.length} de ${fmtInt.format(filtered.length)} concursos filtrados (espaço total: ${fmtInt.format(TOTAL_COMBINATIONS)} combinações possíveis).`;

  const filterSet = new Set(filterNums);
  document.getElementById('history-tbody').innerHTML = pageItems.length
    ? pageItems
        .map((d) => {
          const sum = d.dezenas.reduce((a, b) => a + b, 0);
          const evens = d.dezenas.filter((n) => n % 2 === 0).length;
          return `
            <tr>
              <td><strong>#${d.concurso}</strong></td>
              <td>${escapeHtml(d.data || '—')}</td>
              <td>
                <div class="ball-row compact">
                  ${d.dezenas
                    .map((n) => `<span class="ball sm ${filterSet.has(n) ? 'gold' : ''}">${pad2(n)}</span>`)
                    .join('')}
                </div>
              </td>
              <td>${sum}</td>
              <td>${evens}P / ${6 - evens}I</td>
            </tr>
          `;
        })
        .join('')
    : '<tr><td colspan="5" class="muted">Nenhum concurso encontrado com os filtros aplicados.</td></tr>';

  document.getElementById('history-pagination').innerHTML = `
    <span class="muted">Página ${state.historyPage} de ${totalPages}</span>
    <div class="inline-actions">
      <button id="hist-prev" class="btn btn-secondary btn-sm" type="button" ${state.historyPage <= 1 ? 'disabled' : ''}>Anterior</button>
      <button id="hist-next" class="btn btn-secondary btn-sm" type="button" ${state.historyPage >= totalPages ? 'disabled' : ''}>Próxima</button>
    </div>
  `;

  document.getElementById('hist-prev')?.addEventListener('click', () => {
    if (state.historyPage > 1) {
      state.historyPage--;
      renderHistoryTab();
    }
  });
  document.getElementById('hist-next')?.addEventListener('click', () => {
    if (state.historyPage < totalPages) {
      state.historyPage++;
      renderHistoryTab();
    }
  });
}

function renderAll() {
  renderDatasetBadge();
  renderOverview();
  renderProbabilityTab();
  renderMonteCarlo();
  renderHistoryTab();
}

function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach((b) => {
        const active = b.dataset.tab === tab;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      document.querySelectorAll('.tab-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `tab-${tab}`);
      });
    });
  });

  // Heatmap mode & inspect
  document.querySelectorAll('[data-heatmap-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.heatmapMode = btn.dataset.heatmapMode;
      document.querySelectorAll('[data-heatmap-mode]').forEach((b) =>
        b.classList.toggle('active', b.dataset.heatmapMode === state.heatmapMode)
      );
      renderHeatmap();
    });
  });

  document.getElementById('heatmap-grid').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-inspect]');
    if (!cell) return;
    state.inspectedNumber = Number(cell.dataset.inspect);
    renderHeatmap();
    renderInspector();
  });

  // Selector board
  document.getElementById('selector-board').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const num = Number(btn.dataset.pick);
    const idx = state.selectedNumbers.indexOf(num);
    if (idx >= 0) {
      state.selectedNumbers.splice(idx, 1);
    } else {
      if (state.selectedNumbers.length >= 20) {
        showBanner('Máximo de 20 dezenas permitidas no volante oficial da Mega-Sena.', true);
        return;
      }
      state.selectedNumbers.push(num);
      state.selectedNumbers.sort((a, b) => a - b);
    }
    if (state.selectedNumbers.length >= 6 && state.selectedNumbers.length <= 20) {
      state.ticketSize = state.selectedNumbers.length;
    }
    renderProbabilityTab();
  });

  document.getElementById('btn-quick-6').addEventListener('click', () => {
    state.selectedNumbers = drawRandomNumbers(Math.random, 6);
    state.ticketSize = 6;
    renderProbabilityTab();
  });

  document.getElementById('btn-quick-hot6').addEventListener('click', () => {
    state.selectedNumbers = state.stats.byFrequencyDesc
      .slice(0, 6)
      .map((n) => n.number)
      .sort((a, b) => a - b);
    state.ticketSize = 6;
    renderProbabilityTab();
  });

  document.getElementById('btn-clear-selection').addEventListener('click', () => {
    state.selectedNumbers = [];
    renderProbabilityTab();
  });

  // Horizon controls
  const hSlider = document.getElementById('horizon-draws');
  const hInput = document.getElementById('horizon-draws-num');
  hSlider.addEventListener('input', () => {
    state.horizonDraws = Number(hSlider.value);
    hInput.value = String(state.horizonDraws);
    renderHorizonResults();
  });
  hInput.addEventListener('input', () => {
    const val = Math.max(1, Math.min(100000, Number(hInput.value) || 1));
    state.horizonDraws = val;
    if (val <= 500) hSlider.value = String(val);
    renderHorizonResults();
  });

  // Ticket simulator controls
  document.getElementById('ticket-size-slider').addEventListener('input', (e) => {
    state.ticketSize = Number(e.target.value);
    renderTicketOdds();
  });
  document.getElementById('unit-price-input').addEventListener('input', (e) => {
    state.unitPrice = Math.max(0.5, Number(e.target.value) || 5.0);
    renderTicketOdds();
  });

  // Monte Carlo
  document.getElementById('btn-run-sim').addEventListener('click', renderMonteCarlo);

  // Generator
  document.getElementById('generator-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const betSize = Number(document.getElementById('gen-size').value || 6);
    const minEvens = Number(document.getElementById('gen-min-evens').value || 0);
    const maxEvens = Number(document.getElementById('gen-max-evens').value || betSize);
    const minSum = Number(document.getElementById('gen-min-sum').value || 21);
    const maxSum = Number(document.getElementById('gen-max-sum').value || 600);
    const count = Math.max(1, Math.min(10, Number(document.getElementById('gen-count').value || 4)));
    const fixedNumbers = parseNumberListInput(document.getElementById('gen-fixed').value);
    const excludedNumbers = parseNumberListInput(document.getElementById('gen-excluded').value);

    const out = document.getElementById('generator-results');
    const generated = [];
    for (let i = 0; i < count; i++) {
      const res = generateSmartCombination({
        betSize,
        fixedNumbers,
        excludedNumbers,
        minEvens,
        maxEvens,
        minSum,
        maxSum
      });
      if (res.error) {
        out.innerHTML = `<p class="status-banner error">${escapeHtml(res.error)}</p>`;
        return;
      }
      generated.push(res);
    }

    out.innerHTML = `<div class="gen-list">
      ${generated
        .map(
          (g, idx) => `
          <div class="gen-item">
            <div>
              <div class="ball-row compact">
                ${g.numbers.map((n) => `<span class="ball sm">${pad2(n)}</span>`).join('')}
              </div>
              <div class="muted small-note" style="margin: 4px 0 0;">
                Jogo ${idx + 1} • Soma: ${g.sum} • ${g.evens}P / ${g.odds}I
              </div>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" data-use-gen="${g.numbers.join(',')}">
              Analisar
            </button>
          </div>
        `
        )
        .join('')}
    </div>`;
  });

  document.getElementById('generator-results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-use-gen]');
    if (!btn) return;
    state.selectedNumbers = btn.dataset.useGen.split(',').map(Number);
    state.ticketSize = Math.min(20, Math.max(6, state.selectedNumbers.length));
    renderProbabilityTab();
    document.querySelector('[data-tab="probabilities"]').click();
  });

  // History filters
  document.getElementById('history-search-concurso').addEventListener('input', (e) => {
    state.historySearchConcurso = e.target.value;
    state.historyPage = 1;
    renderHistoryTab();
  });
  document.getElementById('history-search-numbers').addEventListener('input', (e) => {
    state.historySearchNumbers = e.target.value;
    state.historyPage = 1;
    renderHistoryTab();
  });
  document.getElementById('btn-clear-history-filter').addEventListener('click', () => {
    state.historySearchConcurso = '';
    state.historySearchNumbers = '';
    document.getElementById('history-search-concurso').value = '';
    document.getElementById('history-search-numbers').value = '';
    state.historyPage = 1;
    renderHistoryTab();
  });

  // Online sync, Import & Reset
  document.getElementById('btn-sync-online').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-online');
    btn.disabled = true;
    btn.textContent = 'Sincronizando...';
    try {
      const ds = await syncOnlineDraws();
      setDataset(ds, true);
      showBanner(`Base atualizada com sucesso: ${fmtInt.format(ds.draws.length)} concursos reais carregados (${ds.source}).`);
    } catch (err) {
      showBanner(`${err.message}. Você pode continuar usando a base offline ou importar um JSON/CSV da Caixa.`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sincronizar Sorteios Reais';
    }
  });

  document.getElementById('input-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const draws = parseDrawsPayload(text);
      if (draws.length === 0) {
        throw new Error('Nenhum concurso válido encontrado no arquivo.');
      }
      setDataset(
        {
          source: `Arquivo importado (${file.name})`,
          isSimulated: false,
          updatedAt: new Date().toISOString(),
          draws
        },
        true
      );
      showBanner(`Arquivo "${file.name}" importado com ${fmtInt.format(draws.length)} concursos.`);
    } catch (err) {
      showBanner(`Falha ao importar arquivo: ${err.message}`, true);
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('btn-reset-baseline').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    setDataset(generateSimulatedBaseline(2800), false);
    showBanner('Base restaurada para a simulação offline equiprovável (2.800 concursos).');
  });
}

// Bootstrap
state.dataset = loadInitialDataset();
state.stats = computeDrawStatistics(state.dataset.draws);
bindEvents();
renderAll();
