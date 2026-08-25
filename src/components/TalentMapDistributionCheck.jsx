import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { TALENT_BAND_LABELS, TALENT_BAND_BELOW, TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS } from '../talentCompliance';
import {
  Y_AXIS_ORDER, X_AXIS_ORDER, quadrantKey, getQuadrant,
  computeAxisDistribution, BAND_DISTRIBUTION_BENCHMARK,
} from '../talentNineBox';

const BAND_ORDER_FOR_STATS = [TALENT_BAND_BELOW, TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS];

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };

function AxisStatsTable({ title, stats }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h5 style={{ marginBottom: '0.6rem' }}>{title}</h5>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: stats.skewed.length > 0 ? '0.75rem' : 0 }}>
        {BAND_ORDER_FOR_STATS.map(band => (
          <div
            key={band}
            style={{
              flex: '1 1 160px', minWidth: '150px', padding: '1rem', textAlign: 'center',
              background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>
              {TALENT_BAND_LABELS[band]}
            </div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: '1.6rem', fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1 }}>
              {stats.pct[band]}%
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
              {stats.counts[band]} чел. · ориентир {BAND_DISTRIBUTION_BENCHMARK[band]}%
            </div>
          </div>
        ))}
      </div>

      {stats.skewed.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.7rem 0.9rem',
          background: 'rgba(226, 145, 71, 0.12)', border: '1px solid rgba(226, 145, 71, 0.4)', borderRadius: '10px',
          fontSize: '0.82rem', color: 'var(--color-text)', lineHeight: 1.45,
        }}>
          <AlertTriangle size={14} strokeWidth={2} style={{ color: 'var(--color-accent-hover)', flexShrink: 0, marginTop: '0.1rem' }} />
          <span>
            Перекос по «{stats.skewed.map(b => TALENT_BAND_LABELS[b]).join('», «')}» — стоит проверить на калибровке.
          </span>
        </div>
      )}
    </div>
  );
}

// Проверка распределения (Фаза 5a) — исключительно для калибровки: сколько
// человек и какой % попало в каждую ячейку и на каждую полосу оси, рядом с
// ориентиром 20/60/20. Явно не квота — если распределение отклоняется,
// показывается мягкая подсказка, а не запрет.
function TalentMapDistributionCheck({ placement, quadrants }) {
  const placed = placement.filter(p => p.xBand && p.yBand);
  const total = placed.length;

  const xStats = computeAxisDistribution(placed.map(p => p.xBand));
  const yStats = computeAxisDistribution(placed.map(p => p.yBand));

  if (total === 0) {
    return (
      <div>
        <h4>Проверка распределения (для калибровки)</h4>
        <p style={{ color: 'var(--color-text-muted)' }}>
          Пока нет ни одного сотрудника с обеими полосами (X и Y) — статистика появится после размещения.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h4 style={{ marginBottom: '0.35rem' }}>Проверка распределения (для калибровки)</h4>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
        Ориентир 20/60/20 по каждой оси — это ориентир для обсуждения на калибровочной сессии, а не квота
        на количество людей в каждой полосе. Всего размещено: {total} чел.
      </p>

      <AxisStatsTable title="Ось X — индекс соответствия" stats={xStats} />
      <AxisStatsTable title="Ось Y — KPI" stats={yStats} />

      <h5 style={{ marginBottom: '0.6rem' }}>По ячейкам</h5>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>Ячейка</th>
              <th style={thStyle}>Y</th>
              <th style={thStyle}>X</th>
              <th style={thStyle}>Человек</th>
              <th style={thStyle}>% от всех</th>
            </tr>
          </thead>
          <tbody>
            {Y_AXIS_ORDER.map(yBand => X_AXIS_ORDER.map(xBand => {
              const key = quadrantKey(yBand, xBand);
              const quadrant = getQuadrant(quadrants, yBand, xBand);
              const count = placed.filter(p => p.yBand === yBand && p.xBand === xBand).length;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={tdStyle}>{quadrant.name}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{TALENT_BAND_LABELS[yBand]}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{TALENT_BAND_LABELS[xBand]}</td>
                  <td style={tdStyle}>{count}</td>
                  <td style={tdStyle}>{pct}%</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TalentMapDistributionCheck;
