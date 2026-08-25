import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Download, AlertTriangle } from 'lucide-react';
import { getTalentResponse } from '../talentMap';
import { TALENT_COMPETENCIES } from '../talentCompetencies';

const BRAND = {
  primary: '#2F4A3E',
  leaf: '#3F6152',
  accent: '#E29147',
  cream: '#FAF7F1',
  muted: '#8A7E6B',
  danger: '#C15B4A',
};

// Строка «расходится» при разнице >= 1 балла между самооценкой и оценкой
// руководителя — порог задан методикой (см. текст задачи Фазы 3), не
// подобран эмпирически, поэтому не вынесен в настраиваемую таблицу вроде
// целевых баллов по грейдам.
const DISCREPANCY_THRESHOLD = 1;

function average(values) {
  const valid = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function fmt(n) {
  return n !== null && n !== undefined ? n.toFixed(2).replace('.', ',') : '—';
}

// AI-комментарий сохраняется либо как структурированный объект
// {agreements, disagreements, interviewFocus}, либо — если модель не
// вернула валидный JSON — как {text: '...'} с сырым текстом (тот же приём,
// что EmployeeReport.jsx уже использует для ИПР).
function isStructuredComment(data) {
  return !!data && typeof data === 'object' &&
    (typeof data.agreements === 'string' || typeof data.disagreements === 'string' || typeof data.interviewFocus === 'string');
}

function buildCompetencyRows(selfResponse, managerResponse) {
  return TALENT_COMPETENCIES.map(comp => {
    const indicators = comp.indicators.map(ind => {
      const selfScore = selfResponse.scores?.[ind.id] ?? null;
      const managerScore = managerResponse.scores?.[ind.id] ?? null;
      const diff = (selfScore !== null && managerScore !== null) ? Math.abs(selfScore - managerScore) : null;
      return {
        id: ind.id,
        name: ind.name,
        selfScore,
        managerScore,
        diff,
        higher: diff !== null && diff > 0 ? (selfScore > managerScore ? 'self' : 'manager') : null,
        selfExample: selfResponse.examples?.[ind.id] || null,
        managerExample: managerResponse.examples?.[ind.id] || null,
      };
    });
    return {
      id: comp.id,
      name: comp.name,
      indicators,
      selfAvg: average(indicators.map(r => r.selfScore)),
      managerAvg: average(indicators.map(r => r.managerScore)),
    };
  });
}

// Отчёт по одной паре «оцениваемый + его руководитель» — самооценка против
// оценки руководителя по всем 28 индикаторам, расхождения, AI-комментарий и
// выгрузка в PDF. Данные читаются суперадмином напрямую из
// talentMaps/{ownerUid}/responses/{taskId} (разрешено правилами Firestore,
// см. firestore.rules) — никакого публичного доступа здесь нет.
function TalentMapPairReport({ pair, ownerUid, existingComment, onSaveComment }) {
  const reportRef = useRef(null);
  const [selfResponse, setSelfResponse] = useState(undefined); // undefined = ещё грузится
  const [managerResponse, setManagerResponse] = useState(undefined);
  const [loadError, setLoadError] = useState(null);
  const [comment, setComment] = useState(existingComment || null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSelfResponse(undefined);
    setManagerResponse(undefined);
    setLoadError(null);
    Promise.all([
      getTalentResponse(ownerUid, pair.selfTask.id),
      getTalentResponse(ownerUid, pair.managerTask.id),
    ])
      .then(([selfR, managerR]) => {
        if (cancelled) return;
        setSelfResponse(selfR);
        setManagerResponse(managerR);
      })
      .catch(err => {
        console.error('[TalentMapPairReport] Failed to load responses:', err);
        if (!cancelled) setLoadError(err.message);
      });
    return () => { cancelled = true; };
  }, [ownerUid, pair.selfTask.id, pair.managerTask.id]);

  const bothLoaded = selfResponse !== undefined && managerResponse !== undefined;
  const dataMissing = bothLoaded && (!selfResponse || !managerResponse);

  const compRows = useMemo(() => {
    if (!selfResponse || !managerResponse) return [];
    return buildCompetencyRows(selfResponse, managerResponse);
  }, [selfResponse, managerResponse]);

  const discrepancies = useMemo(() => {
    const list = [];
    compRows.forEach(comp => {
      comp.indicators.forEach(ind => {
        if (ind.diff !== null && ind.diff >= DISCREPANCY_THRESHOLD) {
          list.push({ competency: comp.name, ...ind });
        }
      });
    });
    return list.sort((a, b) => b.diff - a.diff);
  }, [compRows]);

  const handleGenerateComment = async () => {
    setAiGenerating(true);
    setAiError(null);
    try {
      const payload = {
        evalueeName: pair.evaluee.fio,
        managerName: pair.manager.fio,
        competencies: compRows.map(c => ({
          name: c.name,
          selfAvg: c.selfAvg !== null ? Number(c.selfAvg.toFixed(2)) : null,
          managerAvg: c.managerAvg !== null ? Number(c.managerAvg.toFixed(2)) : null,
        })),
        discrepancies: discrepancies.map(d => ({
          competency: d.competency,
          indicator: d.name,
          self: d.selfScore,
          manager: d.managerScore,
          higher: d.higher === 'self' ? 'самооценка' : 'оценка руководителя',
        })),
      };

      const res = await fetch('/api/generate-pair-comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось сгенерировать комментарий. Попробуйте ещё раз.');
      }

      setComment(data.comment);
      try {
        await onSaveComment(data.comment);
      } catch (saveErr) {
        console.error('[TalentMapPairReport] Failed to save AI comment:', saveErr);
        setAiError('Комментарий сгенерирован, но не сохранён — при перезагрузке страницы может исчезнуть.');
      }
    } catch (err) {
      console.error('[TalentMapPairReport] AI comment generation failed:', err);
      setAiError(err.message || 'Не удалось сгенерировать комментарий.');
    } finally {
      setAiGenerating(false);
    }
  };

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

    const safeName = pair.evaluee.fio.replace(/\s+/g, '_');
    pdf.save(`Карта_талантов_${safeName}.pdf`);
  };

  return (
    <div style={{ maxWidth: '900px' }}>
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
        {/* Header */}
        <div style={{
          background: BRAND.primary, padding: '2rem 2.25rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap',
        }}>
          <div>
            <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#fff', fontSize: '1.7rem', fontWeight: 700, margin: '0 0 0.45rem' }}>
              Карта талантов — отчёт по паре
            </h1>
            <div style={{ color: 'rgba(250,247,241,0.82)', fontSize: '0.95rem' }}>
              {pair.evaluee.fio} · руководитель: {pair.manager.fio}
            </div>
          </div>
        </div>

        <div style={{ padding: '2.25rem' }}>
          {!bothLoaded && !loadError && (
            <p style={{ color: BRAND.muted }}>Загрузка ответов...</p>
          )}

          {loadError && (
            <div className="error-message">Ошибка загрузки ответов: {loadError}</div>
          )}

          {dataMissing && (
            <div className="error-message">
              Не удалось найти сохранённые ответы для одной из оценок — возможно, данные были удалены. Попробуйте обновить страницу.
            </div>
          )}

          {bothLoaded && !dataMissing && (
            <>
              {compRows.map(comp => (
                <div key={comp.id} style={{ marginBottom: '1.75rem' }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem',
                    borderBottom: '2px solid var(--color-border)', paddingBottom: '0.4rem', marginBottom: '0.6rem',
                  }}>
                    <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", color: BRAND.primary, fontSize: '1.1rem', margin: 0 }}>
                      {comp.name}
                    </h3>
                    <span style={{ fontSize: '0.82rem', color: BRAND.muted }}>
                      Самооценка: <strong style={{ color: BRAND.accent }}>{fmt(comp.selfAvg)}</strong>
                      {' · '}Руководитель: <strong style={{ color: BRAND.primary }}>{fmt(comp.managerAvg)}</strong>
                    </span>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Индикатор</th>
                          <th style={{ ...thStyle, textAlign: 'center', width: '110px' }}>Самооценка</th>
                          <th style={{ ...thStyle, textAlign: 'center', width: '130px' }}>Руководитель</th>
                          <th style={{ ...thStyle, textAlign: 'center', width: '90px' }}>Разница</th>
                        </tr>
                      </thead>
                      <tbody>
                        {comp.indicators.map(ind => {
                          const isDiscrepancy = ind.diff !== null && ind.diff >= DISCREPANCY_THRESHOLD;
                          const hasExample = ind.selfExample || ind.managerExample;
                          return (
                            <React.Fragment key={ind.id}>
                              <tr style={{ background: isDiscrepancy ? '#FCEBD9' : 'transparent' }}>
                                <td style={tdStyle}>{ind.name}</td>
                                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: BRAND.accent }}>{ind.selfScore ?? '—'}</td>
                                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: BRAND.primary }}>{ind.managerScore ?? '—'}</td>
                                <td style={{ ...tdStyle, textAlign: 'center', color: isDiscrepancy ? BRAND.danger : BRAND.muted, fontWeight: isDiscrepancy ? 700 : 400 }}>
                                  {ind.diff ?? '—'}
                                </td>
                              </tr>
                              {hasExample && (
                                <tr style={{ background: isDiscrepancy ? '#FCEBD9' : 'var(--color-surface-tint)' }}>
                                  <td colSpan={4} style={{ ...tdStyle, paddingTop: 0, fontSize: '0.82rem', color: BRAND.muted, lineHeight: 1.5 }}>
                                    {ind.selfExample && <div><strong style={{ color: BRAND.accent }}>Пример (самооценка):</strong> {ind.selfExample}</div>}
                                    {ind.managerExample && <div><strong style={{ color: BRAND.primary }}>Пример (руководитель):</strong> {ind.managerExample}</div>}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* Основные расхождения */}
              <SectionTitle>Основные расхождения</SectionTitle>
              {discrepancies.length === 0 ? (
                <p style={{ color: BRAND.muted, fontSize: '0.9rem' }}>
                  Существенных расхождений (разница ≥ {DISCREPANCY_THRESHOLD} балла) не найдено — самооценка и оценка руководителя в целом совпадают.
                </p>
              ) : (
                discrepancies.map(d => (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.75rem 1rem',
                    background: '#FCEBD9', border: `1px solid ${BRAND.accent}55`, borderRadius: 10, marginBottom: '0.5rem',
                  }}>
                    <AlertTriangle size={16} strokeWidth={2} style={{ color: BRAND.accent, flexShrink: 0, marginTop: '0.1rem' }} />
                    <div style={{ fontSize: '0.88rem', lineHeight: 1.5 }}>
                      <strong>{d.competency} → {d.name}</strong>: самооценка {d.selfScore}, руководитель {d.managerScore}
                      {' — '}{d.higher === 'self' ? 'самооценка выше' : 'оценка руководителя выше'} на {d.diff}.
                    </div>
                  </div>
                ))
              )}

              {/* AI-комментарий */}
              <div style={{ marginTop: '2rem', padding: '1.5rem', borderRadius: 'var(--radius-card)', background: BRAND.primary, color: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                  <span style={{ background: BRAND.accent, color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '999px', letterSpacing: '0.04em' }}>
                    AI
                  </span>
                  <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", margin: 0, fontSize: '1.15rem' }}>
                    Комментарий к паре
                  </h3>
                </div>

                {!comment && (
                  <p style={{ margin: 0, color: 'rgba(250,247,241,0.75)', fontSize: '0.9rem' }}>
                    AI-комментарий поможет подготовиться к интервью — сгенерируйте его на основе баллов выше.
                  </p>
                )}

                {comment && isStructuredComment(comment) && (
                  <div>
                    {comment.agreements && (
                      <CommentBlock title="Совпадает" text={comment.agreements} />
                    )}
                    {comment.disagreements && (
                      <CommentBlock title="Расходится" text={comment.disagreements} />
                    )}
                    {comment.interviewFocus && (
                      <CommentBlock title="На что обратить внимание на интервью" text={comment.interviewFocus} />
                    )}
                  </div>
                )}

                {comment && !isStructuredComment(comment) && comment.text && (
                  <p style={{ margin: 0, color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                    {comment.text}
                  </p>
                )}

                <div className="report-no-pdf" style={{ marginTop: '1rem' }}>
                  {aiError && <p style={{ color: '#FBD3C4', fontSize: '0.85rem', marginBottom: '0.6rem' }}>{aiError}</p>}
                  <button
                    onClick={handleGenerateComment}
                    disabled={aiGenerating}
                    style={comment ? {
                      background: 'none', border: 'none', color: 'rgba(250,247,241,0.85)',
                      fontSize: '0.85rem', cursor: 'pointer', padding: 0, textDecoration: 'underline',
                      opacity: aiGenerating ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                    } : {
                      background: BRAND.accent, color: '#fff', border: 'none', borderRadius: 'var(--radius-btn)',
                      padding: '0.55rem 1.15rem', fontSize: '0.88rem', fontWeight: 600,
                      cursor: 'pointer', opacity: aiGenerating ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                    }}
                  >
                    {aiGenerating ? 'Генерируется...' : comment ? (
                      <><RefreshCw size={13} strokeWidth={2} />Перегенерировать</>
                    ) : (
                      <><Sparkles size={15} strokeWidth={2} />AI-комментарий</>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {bothLoaded && !dataMissing && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button className="btn btn-accent" onClick={handleDownloadPDF}>
            <Download size={16} strokeWidth={2} />
            Скачать PDF
          </button>
        </div>
      )}
    </div>
  );
}

const thStyle = {
  padding: '0.5rem 0.65rem', fontSize: '0.78rem', fontWeight: 600,
  color: BRAND.muted, textAlign: 'left', borderBottom: '1px solid var(--color-border)',
};
const tdStyle = { padding: '0.5rem 0.65rem', fontSize: '0.85rem', verticalAlign: 'top', borderBottom: '1px solid var(--color-border)' };

function SectionTitle({ children }) {
  return (
    <h3 style={{
      fontFamily: "'Fraunces', Georgia, serif", color: BRAND.primary, fontSize: '1.1rem',
      margin: '2rem 0 1rem', paddingBottom: '0.4rem', borderBottom: '2px solid var(--color-border)',
    }}>
      {children}
    </h3>
  );
}

function CommentBlock({ title, text }) {
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#fff', fontSize: '1rem', fontWeight: 600, marginBottom: '0.4rem' }}>
        {title}
      </div>
      <p style={{ margin: 0, color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {text}
      </p>
    </div>
  );
}

export default TalentMapPairReport;
