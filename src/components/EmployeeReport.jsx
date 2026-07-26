import React, { useRef } from 'react';

// Maps both English keys and Russian labels to canonical Russian labels
const NORMALIZE_TYPE = {
  self: 'Самооценка',
  manager: 'Руководитель',
  colleague: 'Коллега',
  subordinate: 'Подчинённый',
  'Самооценка': 'Самооценка',
  'Руководитель': 'Руководитель',
  'Коллега': 'Коллега',
  'Подчинённый': 'Подчинённый',
};

const TYPE_ORDER = ['Самооценка', 'Руководитель', 'Коллега', 'Подчинённый'];
const TYPE_HEADERS = ['Самооценка', 'Руководитель', 'Коллеги', 'Подчинённые'];

function norm(type) {
  return NORMALIZE_TYPE[type] || type;
}

function getScore(feedback, compId) {
  return feedback.competencyScores?.[compId] ??
    feedback.competencyScores?.[String(compId)] ?? null;
}

function average(values) {
  const valid = values.filter(v => v !== null && v !== undefined);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function fmt(n) {
  return n !== null && n !== undefined ? n.toFixed(1) : '—';
}

function ScoreBar({ score }) {
  const pct = score !== null ? Math.round((score / 5) * 100) : 0;
  const color = score === null
    ? 'var(--color-border)'
    : score >= 4 ? 'var(--color-success)'
    : score >= 3 ? 'var(--color-accent)'
    : 'var(--color-danger)';
  return (
    <div style={{ background: 'var(--color-border)', borderRadius: 6, height: 10, overflow: 'hidden', flex: 1 }}>
      <div style={{ background: color, width: `${pct}%`, height: '100%', borderRadius: 6 }} />
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{
      fontFamily: 'Fraunces, Georgia, serif',
      color: 'var(--color-primary)',
      fontSize: '1.1rem',
      margin: '2rem 0 1rem',
      paddingBottom: '0.4rem',
      borderBottom: '2px solid var(--color-border)',
    }}>
      {children}
    </h3>
  );
}

function EmployeeReport({ employeeName, feedbacks, competencies, onBack, onDeleteFeedback }) {
  const reportRef = useRef(null);

  // ── Normalize rater types ─────────────────────────────────────────────────
  const normalizedFeedbacks = feedbacks.map(f => ({ ...f, raterTypeNorm: norm(f.raterType) }));

  const byType = {};
  normalizedFeedbacks.forEach(f => {
    const t = f.raterTypeNorm;
    if (!byType[t]) byType[t] = [];
    byType[t].push(f);
  });

  // ── Header counts ─────────────────────────────────────────────────────────
  const typeSummaryParts = TYPE_ORDER
    .filter(t => byType[t]?.length > 0)
    .map(t => `${byType[t].length} ${t.toLowerCase()}`);

  // ── Overall scores ────────────────────────────────────────────────────────
  const allScores = normalizedFeedbacks.flatMap(f =>
    competencies.map(c => getScore(f, c.id)).filter(v => v !== null)
  );
  const overallAvg = average(allScores);

  const selfFeedbacks = byType['Самооценка'] || [];
  const selfScores = selfFeedbacks.flatMap(f =>
    competencies.map(c => getScore(f, c.id)).filter(v => v !== null)
  );
  const selfAvg = average(selfScores);

  // ── Per-competency averages ───────────────────────────────────────────────
  const compAvgs = competencies.map(comp => {
    const vals = normalizedFeedbacks.map(f => getScore(f, comp.id)).filter(v => v !== null);
    return { ...comp, avg: average(vals) };
  });

  const sorted = [...compAvgs].filter(c => c.avg !== null).sort((a, b) => b.avg - a.avg);
  const topStrengths = sorted.slice(0, 3);
  const topZones = [...sorted].reverse().slice(0, 3);

  // ── Breakdown table ───────────────────────────────────────────────────────
  const matrix = competencies.map(comp => {
    const row = { comp, overall: compAvgs.find(c => c.id === comp.id)?.avg ?? null };
    TYPE_ORDER.forEach(key => {
      const vals = (byType[key] || []).map(f => getScore(f, comp.id)).filter(v => v !== null);
      row[key] = average(vals);
    });
    return row;
  });

  // ── Comments (anonymized) ─────────────────────────────────────────────────
  const strengthComments = [];
  const improveComments = [];
  const anonymizedRows = [];
  const typeCounters = {};
  normalizedFeedbacks.forEach(f => {
    const t = f.raterTypeNorm;
    typeCounters[t] = (typeCounters[t] || 0) + 1;
    const label = `${t} #${typeCounters[t]}`;
    anonymizedRows.push({ id: f.id, label, raw: f });
    if (f.openQuestions?.strength?.trim()) {
      strengthComments.push({ label, text: f.openQuestions.strength });
    }
    if (f.openQuestions?.improvement?.trim()) {
      improveComments.push({ label, text: f.openQuestions.improvement });
    }
  });

  // ── PDF export ────────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');

    const el = reportRef.current;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#FAF7F1',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;

    let remaining = imgH;
    let yOffset = margin;

    pdf.addImage(imgData, 'PNG', margin, yOffset, imgW, imgH);
    remaining -= (pageH - margin);

    while (remaining > 0) {
      yOffset -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, yOffset, imgW, imgH);
      remaining -= pageH;
    }

    const safeName = employeeName.replace(/\s+/g, '_');
    pdf.save(`Отчет_360_${safeName}.pdf`);
  };

  const dateStr = new Date().toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: '860px' }}>

        {/* ── Toolbar (excluded from PDF) ─────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--color-border)',
        }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none',
              color: 'var(--color-text-muted)', cursor: 'pointer',
              fontSize: '0.9rem', fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem',
            }}
          >
            ← Назад к результатам
          </button>
          <button className="btn btn-success" onClick={handleDownloadPDF}>
            ⬇ Скачать PDF
          </button>
        </div>

        {/* ── REPORT CONTENT (what gets captured for PDF) ─────────────────── */}
        <div ref={reportRef} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--color-text)' }}>

          {/* Header */}
          <div style={{ borderBottom: '3px solid var(--color-primary)', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase',
            }}>
              Отчёт по результатам оценки 360°
            </div>
            <h1 style={{
              fontFamily: 'Fraunces, Georgia, serif',
              color: 'var(--color-primary)',
              fontSize: '2rem', fontWeight: 700, margin: '0 0 0.75rem',
            }}>
              {employeeName}
            </h1>
            <div style={{ display: 'flex', gap: '2rem', color: 'var(--color-text-muted)', fontSize: '0.9rem', flexWrap: 'wrap' }}>
              <span>📅 {dateStr}</span>
              <span>
                👥 {feedbacks.length} {feedbacks.length === 1 ? 'оценщик' : feedbacks.length < 5 ? 'оценщика' : 'оценщиков'}
                {typeSummaryParts.length > 0 && `: ${typeSummaryParts.join(', ')}`}
              </span>
            </div>
          </div>

          {/* Overall score cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: selfAvg !== null ? '1fr 1fr' : '1fr',
            gap: '1.25rem',
            marginBottom: '0.5rem',
          }}>
            <div style={scoreCardStyle('var(--color-primary)')}>
              <div style={scoreCardLabel}>Общий балл</div>
              <div style={{ ...scoreCardNumber, color: 'var(--color-primary)' }}>{fmt(overallAvg)}</div>
              <div style={scoreCardSub}>Среднее по всем компетенциям и оценщикам</div>
            </div>
            {selfAvg !== null && (
              <div style={scoreCardStyle('var(--color-accent)')}>
                <div style={scoreCardLabel}>Самооценка</div>
                <div style={{ ...scoreCardNumber, color: 'var(--color-accent)' }}>{fmt(selfAvg)}</div>
                <div style={scoreCardSub}>Среднее по собственной оценке</div>
              </div>
            )}
          </div>

          {/* Competency bars */}
          <SectionTitle>Оценка по компетенциям</SectionTitle>
          {compAvgs.map(comp => (
            <div key={comp.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 160px 44px',
              gap: '1rem', alignItems: 'center',
              padding: '0.65rem 0', borderBottom: '1px solid var(--color-border)',
            }}>
              <span style={{ fontSize: '0.9rem' }}>{comp.name}</span>
              <ScoreBar score={comp.avg} />
              <span style={{
                fontWeight: 700, textAlign: 'right', fontSize: '0.95rem',
                color: comp.avg === null ? 'var(--color-border)'
                  : comp.avg >= 4 ? 'var(--color-success)'
                  : comp.avg >= 3 ? 'var(--color-accent)'
                  : 'var(--color-danger)',
              }}>
                {fmt(comp.avg)}
              </span>
            </div>
          ))}

          {/* Breakdown table */}
          <SectionTitle>Разбивка по типам оценщиков</SectionTitle>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-primary)', color: '#FAF7F1' }}>
                  <th style={thStyle({ left: true })}>Компетенция</th>
                  {TYPE_HEADERS.map(h => (
                    <th key={h} style={thStyle({})}>{h}</th>
                  ))}
                  <th style={thStyle({ right: true })}>Среднее</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, i) => (
                  <tr key={row.comp.id} style={{ background: i % 2 === 0 ? '#fff' : 'var(--color-surface)' }}>
                    <td style={tdStyle({ bold: true })}>{row.comp.name}</td>
                    {TYPE_ORDER.map(key => (
                      <td key={key} style={tdStyle({ center: true })}>
                        {row[key] !== null && row[key] !== undefined
                          ? <span style={{ color: scoreColor(row[key]) }}>{row[key].toFixed(1)}</span>
                          : <span style={{ color: 'var(--color-border)' }}>—</span>}
                      </td>
                    ))}
                    <td style={tdStyle({ center: true, bold: true })}>
                      <span style={{ color: 'var(--color-primary)' }}>{fmt(row.overall)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Strengths & Zones */}
          <SectionTitle>Профиль компетенций</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '0.5rem' }}>
            <HighlightBox
              title="Сильные стороны"
              items={topStrengths}
              color="var(--color-success)"
              bg="#F0F5F2"
              border="#5B8C6E33"
            />
            <HighlightBox
              title="Зоны развития"
              items={topZones}
              color="var(--color-danger)"
              bg="#FDF1EF"
              border="#C15B4A33"
            />
          </div>

          {/* Open question comments */}
          {strengthComments.length > 0 && (
            <>
              <SectionTitle>Комментарии: что делает хорошо</SectionTitle>
              {strengthComments.map((c, i) => (
                <CommentCard key={i} label={c.label} text={c.text} index={i} />
              ))}
            </>
          )}

          {improveComments.length > 0 && (
            <>
              <SectionTitle>Комментарии: что развивать</SectionTitle>
              {improveComments.map((c, i) => (
                <CommentCard key={i} label={c.label} text={c.text} index={i} />
              ))}
            </>
          )}

          {/* Footer */}
          <div style={{
            marginTop: '2.5rem', paddingTop: '1rem',
            borderTop: '1px solid var(--color-border)',
            textAlign: 'center', fontSize: '0.78rem',
            color: 'var(--color-text-muted)',
          }}>
            Сгенерировано в Оценка 360 · {dateStr}
          </div>
        </div>

        {/* ── Individual answers (management only, excluded from PDF) ────── */}
        {onDeleteFeedback && anonymizedRows.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
            <strong style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Отдельные оценки:</strong>
            {anonymizedRows.map(row => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.4rem 0.6rem',
                  marginTop: '0.4rem',
                  background: 'var(--color-surface)',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                <span>{row.label}</span>
                <button
                  onClick={() => onDeleteFeedback(row.raw)}
                  title="Удалить эту оценку"
                  style={{
                    background: 'none',
                    border: '1px solid var(--color-border)',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    padding: '0.2rem 0.5rem',
                    fontSize: '0.85rem',
                    color: 'var(--color-danger)',
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function HighlightBox({ title, items, color, bg, border }) {
  return (
    <div style={{
      background: bg, borderRadius: 'var(--radius-card)',
      padding: '1.25rem', border: `1.5px solid ${border}`,
    }}>
      <h4 style={{
        fontFamily: 'Fraunces, Georgia, serif',
        color, fontSize: '1rem', margin: '0 0 0.75rem',
      }}>
        {title}
      </h4>
      {items.length === 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Недостаточно данных</p>
      )}
      {items.map((c, i) => (
        <div key={c.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '0.35rem 0',
          borderBottom: i < items.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none',
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text)' }}>{c.name}</span>
          <span style={{ fontWeight: 700, color, fontSize: '0.9rem', marginLeft: '0.5rem' }}>
            {fmt(c.avg)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CommentCard({ label, text, index }) {
  return (
    <div style={{
      padding: '0.875rem 1rem',
      background: index % 2 === 0 ? '#fff' : 'var(--color-surface)',
      borderRadius: 10,
      marginBottom: '0.5rem',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700,
        color: 'var(--color-accent)', marginBottom: '0.3rem',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--color-text)', lineHeight: 1.6 }}>
        {text}
      </div>
    </div>
  );
}

// ── Style helpers ───────────────────────────────────────────────────────────

const scoreCardStyle = (accent) => ({
  background: '#fff',
  border: '1.5px solid var(--color-border)',
  borderRadius: 'var(--radius-card)',
  padding: '1.5rem',
  textAlign: 'center',
  borderTop: `4px solid ${accent}`,
});
const scoreCardLabel = {
  fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em',
  color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem',
};
const scoreCardNumber = {
  fontFamily: 'Fraunces, Georgia, serif',
  fontSize: '3.5rem', fontWeight: 700, lineHeight: 1, marginBottom: '0.4rem',
};
const scoreCardSub = {
  fontSize: '0.75rem', color: 'var(--color-text-muted)',
  maxWidth: '160px', margin: '0 auto', lineHeight: 1.4,
};

function thStyle({ left, right } = {}) {
  return {
    padding: '0.6rem 0.75rem',
    textAlign: left ? 'left' : 'center',
    fontWeight: 600,
    fontSize: '0.82rem',
    borderRadius: left ? '6px 0 0 0' : right ? '0 6px 0 0' : 0,
  };
}

function tdStyle({ bold, center } = {}) {
  return {
    padding: '0.55rem 0.75rem',
    color: 'var(--color-text)',
    fontWeight: bold ? 600 : 400,
    textAlign: center ? 'center' : 'left',
    fontSize: '0.85rem',
  };
}

function scoreColor(v) {
  if (v === null || v === undefined) return 'var(--color-border)';
  if (v >= 4) return 'var(--color-success)';
  if (v >= 3) return 'var(--color-accent)';
  return 'var(--color-danger)';
}

export default EmployeeReport;
