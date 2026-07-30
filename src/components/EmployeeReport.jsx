import React, { useRef, useState, useEffect } from 'react';
import { ArrowLeft, Sparkles, RefreshCw, Download, Trash2 } from 'lucide-react';
import { LogoIcon } from './Logo';
import { TRACK_LABELS, DEFAULT_TRACK } from '../competencies';
import { getSavedIpr, saveIpr } from '../cycles';

// Below this many non-self raters, individual scores/comments could be
// traced back to a specific person — keep it a named constant so the
// threshold is easy to tune later.
const MIN_RATERS_FOR_REPORT = 3;

// How far self-assessment must exceed the team's average (on the 1-5 scale)
// before a competency is flagged as a possible blind spot.
const BLIND_SPOT_THRESHOLD = 0.7;

const BRAND = {
  primary: '#2F4A3E',
  leaf: '#3F6152',
  accent: '#E29147',
  cream: '#FAF7F1',
  muted: '#8A7E6B',
};

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
  return n !== null && n !== undefined ? n.toFixed(1).replace('.', ',') : '—';
}

// Newly generated plans are structured objects ({ strengths, growthAreas,
// plan }); plans saved before this format existed are plain strings — both
// need to keep rendering correctly.
function isStructuredIpr(data) {
  return !!data && typeof data === 'object' && Array.isArray(data.plan);
}

function pluralizePeople(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'человек';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'человека';
  return 'человек';
}

function EmployeeReport({ employeeName, feedbacks, competencies, department, cycleName, track, cycleId, onBack, onDeleteFeedback }) {
  const reportRef = useRef(null);
  const [iprData, setIprData] = useState(null);
  const [iprLoading, setIprLoading] = useState(false);
  const [iprGenerating, setIprGenerating] = useState(false);
  const [iprError, setIprError] = useState(null);

  const normalizedFeedbacks = feedbacks.map(f => ({ ...f, raterTypeNorm: norm(f.raterType) }));
  const selfFeedbacks = normalizedFeedbacks.filter(f => f.raterTypeNorm === 'Самооценка');
  const nonSelfFeedbacks = normalizedFeedbacks.filter(f => f.raterTypeNorm !== 'Самооценка');
  const raterCount = nonSelfFeedbacks.length;
  const hasEnoughData = raterCount >= MIN_RATERS_FOR_REPORT;
  const hasSelfAssessment = selfFeedbacks.length > 0;
  const trackLabel = TRACK_LABELS[track] || TRACK_LABELS[DEFAULT_TRACK];

  // ── Overall average (all raters incl. self, across all competencies) ──────
  const overallAvg = average(
    normalizedFeedbacks.flatMap(f => competencies.map(c => getScore(f, c.id)))
  );

  // ── Per-competency self vs. team averages ──────────────────────────────────
  const compRows = competencies.map(comp => ({
    ...comp,
    selfAvg: hasSelfAssessment ? average(selfFeedbacks.map(f => getScore(f, comp.id))) : null,
    teamAvg: average(nonSelfFeedbacks.map(f => getScore(f, comp.id))),
  }));

  // ── Blind spot: biggest self > team overshoot beyond the threshold ────────
  let blindSpot = null;
  if (hasSelfAssessment) {
    let maxDiff = BLIND_SPOT_THRESHOLD;
    compRows.forEach(row => {
      if (row.selfAvg !== null && row.teamAvg !== null) {
        const diff = row.selfAvg - row.teamAvg;
        if (diff > maxDiff) {
          maxDiff = diff;
          blindSpot = { name: row.name, selfAvg: row.selfAvg, teamAvg: row.teamAvg };
        }
      }
    });
  }

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

  // ── IPR (individual development plan) ──────────────────────────────────────
  useEffect(() => {
    if (!hasEnoughData || !cycleId || !employeeName) {
      setIprData(null);
      setIprLoading(false);
      return;
    }
    let cancelled = false;
    setIprData(null);
    setIprError(null);
    setIprLoading(true);
    getSavedIpr(cycleId, employeeName)
      .then(saved => {
        if (!cancelled) {
          setIprData(saved?.text || null);
          setIprLoading(false);
        }
      })
      .catch(err => {
        console.error('[EmployeeReport] Failed to load saved IPR:', err);
        if (!cancelled) setIprLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, employeeName, hasEnoughData]);

  const handleGenerateIpr = async () => {
    setIprGenerating(true);
    setIprError(null);
    try {
      const payload = {
        employeeName,
        track: trackLabel,
        averageScore: fmt(overallAvg),
        competencies: compRows
          .filter(row => row.teamAvg !== null)
          .map(row => ({
            name: row.name,
            team: Number(row.teamAvg.toFixed(1)),
            ...(row.selfAvg !== null ? { self: Number(row.selfAvg.toFixed(1)) } : {}),
          })),
        strengthsComments: strengthComments.map(c => c.text),
        growthComments: improveComments.map(c => c.text),
      };

      const res = await fetch('/api/generate-ipr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.');
      }

      setIprData(data.ipr);

      try {
        await saveIpr(cycleId, employeeName, data.ipr);
      } catch (saveErr) {
        console.error('[EmployeeReport] Failed to save IPR:', saveErr);
        setIprError('ИПР сгенерирован, но не удалось сохранить его — при перезагрузке он может исчезнуть.');
      }
    } catch (err) {
      console.error('[EmployeeReport] IPR generation failed:', err);
      setIprError(err.message || 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.');
    } finally {
      setIprGenerating(false);
    }
  };

  // ── PDF export ────────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');

    const el = reportRef.current;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: BRAND.cream,
      logging: false,
      ignoreElements: (element) => element.classList?.contains('report-no-pdf'),
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;

    let remaining = imgH;
    let yOffset = 0;

    pdf.addImage(imgData, 'PNG', 0, yOffset, imgW, imgH);
    remaining -= pageH;

    while (remaining > 0) {
      yOffset -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, yOffset, imgW, imgH);
      remaining -= pageH;
    }

    const safeName = employeeName.replace(/\s+/g, '_');
    pdf.save(`Отчёт_360_${safeName}.pdf`);
  };

  return (
    <div className="container">
      <div style={{ width: '100%', maxWidth: '860px' }}>

        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none',
            color: BRAND.muted, cursor: 'pointer',
            fontSize: '0.9rem', fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem',
            marginBottom: '1.25rem',
          }}
        >
          <ArrowLeft size={16} strokeWidth={2} />
          Назад к результатам
        </button>

        {/* ── REPORT CARD (captured for PDF) ──────────────────────────────── */}
        <div
          ref={reportRef}
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            color: '#2B2620',
            background: BRAND.cream,
            borderRadius: 'var(--radius-card)',
            overflow: 'hidden',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* 1. Header */}
          <div style={{
            background: BRAND.primary, padding: '2rem 2.25rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: '1.5rem', flexWrap: 'wrap',
          }}>
            <div>
              <h1 style={{
                fontFamily: "'Fraunces', Georgia, serif", color: '#fff',
                fontSize: '1.85rem', fontWeight: 700, margin: '0 0 0.45rem',
              }}>
                Индивидуальный отчёт 360°
              </h1>
              <div style={{ color: 'rgba(250,247,241,0.82)', fontSize: '0.95rem' }}>
                {[employeeName, department, cycleName].filter(Boolean).join(' · ')}
              </div>
            </div>
            <LogoIcon style={{ width: 56, height: 56, flexShrink: 0 }} />
          </div>

          <div style={{ padding: '2.25rem' }}>
            {!hasEnoughData ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                <p style={{ color: BRAND.muted, fontSize: '1rem', maxWidth: '520px', margin: '0 auto', lineHeight: 1.6 }}>
                  Слишком мало оценок для отображения результатов — отчёт станет доступен, когда оценку пройдут
                  минимум {MIN_RATERS_FOR_REPORT} {pluralizePeople(MIN_RATERS_FOR_REPORT)} (кроме самооценки).
                  Это нужно для сохранения анонимности.
                </p>
              </div>
            ) : (
              <>
                {/* 2. Stat tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.1rem', marginBottom: '0.5rem' }}>
                  <StatTile label="Средний балл" value={`${fmt(overallAvg)} / 5`} sub="По всем компетенциям и оценивающим" />
                  <StatTile label="Оценивших" value={String(raterCount)} sub={`${raterCount} ${pluralizePeople(raterCount)}, без самооценки`} />
                  <StatTile label="Трек" value={trackLabel} small />
                </div>

                {/* 3. Competencies: self vs. team bars */}
                <SectionTitle>Оценка по компетенциям</SectionTitle>
                <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.82rem', color: BRAND.muted }}>
                  {hasSelfAssessment && <Legend color={BRAND.accent} label="Самооценка" />}
                  <Legend color={BRAND.primary} label="Оценка команды" />
                </div>
                {compRows.map(row => (
                  <CompetencyRow key={row.id} row={row} showSelf={hasSelfAssessment} />
                ))}

                {/* 4. Blind spot callout */}
                {blindSpot && (
                  <div style={{
                    marginTop: '1.5rem', padding: '1rem 1.25rem', borderRadius: '10px',
                    background: '#FCEBD9', border: `1px solid ${BRAND.accent}55`,
                  }}>
                    <strong style={{ color: BRAND.primary }}>Возможная слепая зона:</strong>{' '}
                    «{blindSpot.name}» — самооценка ({fmt(blindSpot.selfAvg)}) заметно выше оценки команды ({fmt(blindSpot.teamAvg)}).
                  </div>
                )}

                {/* 5. Comments */}
                {strengthComments.length > 0 && (
                  <>
                    <SectionTitle>Что делает особенно хорошо</SectionTitle>
                    {strengthComments.map((c, i) => (
                      <CommentCard key={i} label={c.label} text={c.text} index={i} />
                    ))}
                  </>
                )}

                {improveComments.length > 0 && (
                  <>
                    <SectionTitle>Что стоит развить</SectionTitle>
                    {improveComments.map((c, i) => (
                      <CommentCard key={i} label={c.label} text={c.text} index={i} />
                    ))}
                  </>
                )}

                {/* 6. IDP (AI-generated development plan) */}
                <div style={{
                  marginTop: '2rem', padding: '1.5rem', borderRadius: 'var(--radius-card)',
                  background: BRAND.primary, color: '#fff',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                    <span style={{
                      background: BRAND.accent, color: '#fff', fontSize: '0.7rem', fontWeight: 700,
                      padding: '0.2rem 0.55rem', borderRadius: '999px', letterSpacing: '0.04em',
                    }}>
                      AI
                    </span>
                    <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", margin: 0, fontSize: '1.15rem' }}>
                      Индивидуальный план развития
                    </h3>
                  </div>

                  {iprLoading && (
                    <p style={{ margin: 0, color: 'rgba(250,247,241,0.75)', fontSize: '0.9rem' }}>Загрузка…</p>
                  )}

                  {!iprLoading && iprData && (
                    isStructuredIpr(iprData) ? (
                      <IprPlan data={iprData} />
                    ) : (
                      <p style={{ margin: 0, color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                        {iprData}
                      </p>
                    )
                  )}

                  {!iprLoading && !iprData && (
                    <p style={{ margin: 0, color: 'rgba(250,247,241,0.75)', fontSize: '0.9rem' }}>
                      AI-план развития будет сгенерирован на основе результатов.
                    </p>
                  )}

                  {/* Generation is allowed in both the active cycle and read-only
                      archive views — only the underlying scores/comments (via
                      onDeleteFeedback) stay locked for archived cycles. */}
                  {!iprLoading && (
                    <div className="report-no-pdf" style={{ marginTop: '1rem' }}>
                      {iprError && (
                        <p style={{ color: '#FBD3C4', fontSize: '0.85rem', marginBottom: '0.6rem' }}>{iprError}</p>
                      )}
                      <button
                        onClick={handleGenerateIpr}
                        disabled={iprGenerating}
                        style={iprData ? {
                          background: 'none', border: 'none', color: 'rgba(250,247,241,0.85)',
                          fontSize: '0.85rem', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                          opacity: iprGenerating ? 0.6 : 1,
                          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        } : {
                          background: BRAND.accent, color: '#fff', border: 'none', borderRadius: 'var(--radius-btn)',
                          padding: '0.55rem 1.15rem', fontSize: '0.88rem', fontWeight: 600,
                          cursor: 'pointer', opacity: iprGenerating ? 0.7 : 1,
                          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        }}
                      >
                        {iprGenerating ? (
                          'Генерируется…'
                        ) : iprData ? (
                          <>
                            <RefreshCw size={13} strokeWidth={2} />
                            Перегенерировать
                          </>
                        ) : (
                          <>
                            <Sparkles size={15} strokeWidth={2} />
                            Сгенерировать ИПР
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 7. Footer bar (excluded from the PDF) */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginTop: '1.25rem', flexWrap: 'wrap', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '0.8rem', color: BRAND.muted }}>Конфиденциально · Growth 360°</span>
          {hasEnoughData && (
            <button
              onClick={handleDownloadPDF}
              style={{
                background: BRAND.accent, color: '#fff', border: 'none', borderRadius: 'var(--radius-btn)',
                padding: '0.6rem 1.25rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}
            >
              <Download size={16} strokeWidth={2} />
              Скачать PDF
            </button>
          )}
        </div>

        {/* ── Individual answers (management only, excluded from PDF) ──────── */}
        {onDeleteFeedback && anonymizedRows.length > 0 && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)' }}>
            <strong style={{ fontSize: '0.9rem', color: BRAND.muted }}>Отдельные оценки:</strong>
            {anonymizedRows.map(row => (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.4rem 0.6rem',
                  marginTop: '0.4rem',
                  background: 'var(--color-surface-tint)',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  color: BRAND.muted,
                }}
              >
                <span>{row.label}</span>
                <button
                  onClick={() => onDeleteFeedback(row.raw)}
                  title="Удалить эту оценку"
                  className="btn btn-icon btn-danger-ghost"
                >
                  <Trash2 size={14} strokeWidth={2} />
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

function StatTile({ label, value, sub, small }) {
  return (
    <div style={{
      background: '#fff', border: '1.5px solid var(--color-border)',
      borderRadius: 'var(--radius-card)', padding: '1.25rem', textAlign: 'center',
      borderTop: `4px solid ${BRAND.primary}`,
    }}>
      <div style={{
        fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em',
        color: BRAND.muted, textTransform: 'uppercase', marginBottom: '0.5rem',
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Fraunces', Georgia, serif", color: BRAND.primary,
        fontSize: small ? '1.3rem' : '2.4rem', fontWeight: 700, lineHeight: 1.2, marginBottom: sub ? '0.35rem' : 0,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: BRAND.muted, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h3 style={{
      fontFamily: "'Fraunces', Georgia, serif",
      color: BRAND.primary,
      fontSize: '1.1rem',
      margin: '2rem 0 1rem',
      paddingBottom: '0.4rem',
      borderBottom: '2px solid var(--color-border)',
    }}>
      {children}
    </h3>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function CompetencyRow({ row, showSelf }) {
  const pct = (v) => (v !== null ? Math.max(0, Math.min(100, (v / 5) * 100)) : 0);
  return (
    <div style={{ padding: '0.85rem 0', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '0.5rem' }}>{row.name}</div>
      {showSelf && row.selfAvg !== null && (
        <ScoreBarRow pct={pct(row.selfAvg)} value={row.selfAvg} color={BRAND.accent} />
      )}
      <ScoreBarRow pct={pct(row.teamAvg)} value={row.teamAvg} color={BRAND.primary} />
    </div>
  );
}

function ScoreBarRow({ pct, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.35rem' }}>
      <div style={{ flex: 1, background: 'var(--color-border)', borderRadius: 6, height: 9, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 6 }} />
      </div>
      <span style={{ width: '40px', textAlign: 'right', fontSize: '0.85rem', fontWeight: 700, color }}>
        {fmt(value)}
      </span>
    </div>
  );
}

function CommentCard({ label, text, index }) {
  return (
    <div style={{
      padding: '0.875rem 1rem',
      background: index % 2 === 0 ? '#fff' : 'var(--color-surface-tint)',
      borderRadius: 10,
      marginBottom: '0.5rem',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700,
        color: BRAND.accent, marginBottom: '0.3rem',
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: '#2B2620', lineHeight: 1.6 }}>
        {text}
      </div>
    </div>
  );
}

function IprPlan({ data }) {
  const growthAreas = Array.isArray(data.growthAreas) ? data.growthAreas : [];
  const plan = Array.isArray(data.plan) ? data.plan : [];

  return (
    <div>
      {data.strengths && (
        <div style={{ marginBottom: '1.1rem' }}>
          <div style={iprSubheadingStyle}>Сильные стороны</div>
          <p style={{ margin: 0, color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.6 }}>
            {data.strengths}
          </p>
        </div>
      )}

      {growthAreas.length > 0 && (
        <div style={{ marginBottom: '1.1rem' }}>
          <div style={iprSubheadingStyle}>Зоны роста</div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.6 }}>
            {growthAreas.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}

      {plan.length > 0 && (
        <div>
          <div style={iprSubheadingStyle}>План развития</div>
          <IprPlanTable plan={plan} />
        </div>
      )}
    </div>
  );
}

const iprSubheadingStyle = {
  fontFamily: "'Fraunces', Georgia, serif",
  color: '#fff',
  fontSize: '1rem',
  fontWeight: 600,
  marginBottom: '0.5rem',
};

function IprPlanTable({ plan }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '10px', overflow: 'hidden',
      border: '1px solid #E5DFD3', overflowX: 'auto',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12px' }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <thead>
          <tr style={{ background: BRAND.primary }}>
            <th style={iprThStyle}>Компетенция</th>
            <th style={iprThStyle}>Что делать</th>
            <th style={iprThStyle}>Ожидаемый результат</th>
            <th style={iprThStyle}>Срок</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : BRAND.cream }}>
              <td style={iprTdStyle}>{item.competency}</td>
              <td style={iprTdStyle}>{item.action}</td>
              <td style={iprTdStyle}>{item.result}</td>
              <td style={iprTdStyle}>{item.timeline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const iprThStyle = {
  padding: '9px 10px',
  textAlign: 'left',
  verticalAlign: 'top',
  color: BRAND.cream,
  fontSize: '12px',
  fontWeight: 700,
};

const iprTdStyle = {
  padding: '8px 10px',
  textAlign: 'left',
  verticalAlign: 'top',
  color: '#2B2620',
  fontSize: '12px',
  lineHeight: 1.5,
  borderBottom: '1px solid #E5DFD3',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
};

export default EmployeeReport;
