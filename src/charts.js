/**
 * Lightweight, responsive SVG chart renderers for Mega-Sena Analytics.
 */

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Render a vertical column chart comparing two series (e.g., Observed vs Theoretical %).
 * @param {HTMLElement} container
 * @param {Array<{ label: string, primary: number, secondary?: number, primaryText: string, secondaryText?: string }>} rows
 * @param {{ primaryLabel: string, secondaryLabel?: string }} legend
 */
export function renderComparisonColumnChart(container, rows, legend) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<p class="empty-note">Sem dados suficientes.</p>';
    return;
  }

  const width = 640;
  const height = 240;
  const pad = { top: 24, right: 16, bottom: 42, left: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxVal = Math.max(
    1,
    ...rows.map((r) => Math.max(r.primary, r.secondary ?? 0))
  ) * 1.15;

  const groupW = plotW / rows.length;
  const hasSecondary = rows.some((r) => r.secondary !== undefined);
  const barW = hasSecondary ? Math.min(24, groupW * 0.34) : Math.min(34, groupW * 0.56);

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const val = maxVal * t;
    const y = pad.top + plotH - t * plotH;
    return `
      <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" class="chart-grid" />
      <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="chart-axis-text">${Number(val.toFixed(1))}%</text>
    `;
  }).join('');

  const bars = rows.map((r, idx) => {
    const cx = pad.left + idx * groupW + groupW / 2;
    const h1 = (r.primary / maxVal) * plotH;
    const y1 = pad.top + plotH - h1;
    const x1 = hasSecondary ? cx - barW - 2 : cx - barW / 2;

    let secSvg = '';
    if (hasSecondary && r.secondary !== undefined) {
      const h2 = (r.secondary / maxVal) * plotH;
      const y2 = pad.top + plotH - h2;
      const x2 = cx + 2;
      secSvg = `
        <rect x="${x2.toFixed(1)}" y="${y2.toFixed(1)}" width="${barW.toFixed(1)}" height="${h2.toFixed(1)}" rx="4" class="chart-bar-secondary">
          <title>${escapeHtml(legend.secondaryLabel || 'Teórico')}: ${escapeHtml(r.secondaryText || '')}</title>
        </rect>
      `;
    }

    return `
      <g>
        <rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${barW.toFixed(1)}" height="${h1.toFixed(1)}" rx="4" class="chart-bar-primary">
          <title>${escapeHtml(legend.primaryLabel)}: ${escapeHtml(r.primaryText)}</title>
        </rect>
        ${secSvg}
        <text x="${cx.toFixed(1)}" y="${(y1 - 5).toFixed(1)}" text-anchor="middle" class="chart-val-text">${escapeHtml(r.primaryText)}</text>
        <text x="${cx.toFixed(1)}" y="${height - 14}" text-anchor="middle" class="chart-label-text">${escapeHtml(r.label)}</text>
      </g>
    `;
  }).join('');

  const legendHtml = `
    <div class="chart-legend">
      <span><i class="legend-dot primary"></i>${escapeHtml(legend.primaryLabel)}</span>
      ${hasSecondary && legend.secondaryLabel ? `<span><i class="legend-dot secondary"></i>${escapeHtml(legend.secondaryLabel)}</span>` : ''}
    </div>
  `;

  container.innerHTML = `
    ${legendHtml}
    <svg viewBox="0 0 ${width} ${height}" class="svg-chart" role="img" aria-label="${escapeHtml(legend.primaryLabel)}">
      ${gridLines}
      ${bars}
    </svg>
  `;
}

/**
 * Render a horizontal bar list for rankings or histograms.
 * @param {HTMLElement} container
 * @param {Array<{ label: string, value: number, displayValue: string, subText?: string, tone?: 'emerald' | 'gold' | 'neutral' }>} rows
 */
export function renderHorizontalBars(container, rows) {
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<p class="empty-note">Sem dados disponíveis.</p>';
    return;
  }

  const maxVal = Math.max(1, ...rows.map((r) => r.value));
  container.innerHTML = `<div class="hbar-list">
    ${rows
      .map((r) => {
        const pct = Math.max(2, (r.value / maxVal) * 100);
        const toneClass = r.tone === 'gold' ? 'tone-gold' : r.tone === 'neutral' ? 'tone-neutral' : 'tone-emerald';
        return `
          <div class="hbar-row">
            <div class="hbar-label">${escapeHtml(r.label)}</div>
            <div class="hbar-track">
              <div class="hbar-fill ${toneClass}" style="width: ${pct.toFixed(1)}%"></div>
            </div>
            <div class="hbar-val">
              <strong>${escapeHtml(r.displayValue)}</strong>
              ${r.subText ? `<span>${escapeHtml(r.subText)}</span>` : ''}
            </div>
          </div>
        `;
      })
      .join('')}
  </div>`;
}
