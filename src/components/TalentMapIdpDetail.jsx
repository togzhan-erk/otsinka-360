import React, { useRef, useState } from 'react';
import { Sparkles, RefreshCw, Download } from 'lucide-react';
import { TALENT_COMPETENCIES } from '../talentCompetencies';

const BRAND = {
  primary: '#2F4A3E',
  accent: '#E29147',
  cream: '#FAF7F1',
  muted: '#8A7E6B',
};

function fmt(n) {
  return n !== null && n !== undefined ? n.toFixed(2).replace('.', ',') : '—';
}

// Новые план сохраняется как {strengths, growthAreas, plan} (та же форма,
// что ИПР 360 использует в EmployeeReport.jsx — не общий импорт, компонент
// написан заново специально для карты талантов, чтобы не трогать код 360),
// либо, если модель не вернула валидный JSON, {text: '...'} сырым текстом.
function isStructuredIdp(data) {
  return !!data && typeof data === 'object' && Array.isArray(data.plan);
}

function IdpPlanTable({ plan }) {
  return (
    <div style={{ background: '#fff', borderRadius: '10px', overflow: 'hidden', border: '1px solid #E5DFD3', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '12px' }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <thead>
          <tr style={{ background: BRAND.primary }}>
            <th style={idpThStyle}>Компетенция</th>
            <th style={idpThStyle}>Что делать</th>
            <th style={idpThStyle}>Ожидаемый результат</th>
            <th style={idpThStyle}>Срок</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((item, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : BRAND.cream }}>
              <td style={idpTdStyle}>{item.competency}</td>
              <td style={idpTdStyle}>{item.action}</td>
              <td style={idpTdStyle}>{item.result}</td>
              <td style={idpTdStyle}>{item.timeline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const idpThStyle = { padding: '9px 10px', textAlign: 'left', verticalAlign: 'top', color: BRAND.cream, fontSize: '12px', fontWeight: 700 };
const idpTdStyle = {
  padding: '8px 10px', textAlign: 'left', verticalAlign: 'top', color: '#2B2620', fontSize: '12px',
  lineHeight: 1.5, borderBottom: '1px solid #E5DFD3', overflowWrap: 'break-word', wordBreak: 'break-word',
};
const idpSubheadingStyle = { fontFamily: "'Fraunces', Georgia, serif", color: '#fff', fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' };

function IdpPlanView({ data }) {
  const growthAreas = Array.isArray(data.growthAreas) ? data.growthAreas : [];
  const plan = Array.isArray(data.plan) ? data.plan : [];
  return (
    <div>
      {data.strengths && (
        <div style={{ marginBottom: '1.1rem' }}>
          <div style={idpSubheadingStyle}>Сильные стороны</div>
          <p style={{ margin: 0, color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.6 }}>{data.strengths}</p>
        </div>
      )}
      {growthAreas.length > 0 && (
        <div style={{ marginBottom: '1.1rem' }}>
          <div style={idpSubheadingStyle}>Зоны роста</div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.6 }}>
            {growthAreas.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      )}
      {plan.length > 0 && (
        <div>
          <div style={idpSubheadingStyle}>План развития</div>
          <IdpPlanTable plan={plan} />
        </div>
      )}
    </div>
  );
}

// Отчёт + AI-план развития по одному сотруднику (Фаза 5b). Баллы по 7
// компетенциям берутся из финальных (согласованных на интервью) баллов —
// Фаза 4, ничего не пересчитывает. PDF, который отсюда скачивается,
// содержит ТОЛЬКО баллы по компетенциям и план развития — никаких названий
// квадранта 9-box, полос «Проблема»/«Резерв» или статуса пула (это видно
// только суперадмину в под-шаге «Карта талантов», сюда не передаётся вовсе
// — компонент физически не получает эти данные как props).
function TalentMapIdpDetail({ evaluee, finalAssessment, existingPlan, onSavePlan }) {
  const reportRef = useRef(null);
  const [plan, setPlan] = useState(existingPlan || null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const target = finalAssessment?.targetScore ?? null;
  const compRows = TALENT_COMPETENCIES.map(comp => {
    const score = finalAssessment?.competencyAverages?.[comp.id] ?? null;
    return { id: comp.id, name: comp.name, score, gap: (score !== null && target) ? score - target : null };
  });

  const rowsWithGap = compRows.filter(r => r.gap !== null);
  const weakest = [...rowsWithGap].sort((a, b) => a.gap - b.gap).slice(0, 3).map(r => r.name);
  const strongest = [...compRows].filter(r => r.score !== null).sort((a, b) => b.score - a.score).slice(0, 3).map(r => r.name);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const payload = {
        employeeName: evaluee.fio,
        grade: evaluee.grade || '',
        targetScore: target,
        competencies: compRows
          .filter(r => r.score !== null)
          .map(r => ({
            name: r.name,
            score: Number(r.score.toFixed(2)),
            target,
            gap: r.gap !== null ? Number(r.gap.toFixed(2)) : null,
          })),
        weakest,
        strongest,
      };

      const res = await fetch('/api/talent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'generate-idp', ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось сгенерировать план развития. Попробуйте ещё раз.');
      }

      setPlan(data.idp);
      try {
        await onSavePlan(evaluee.id, data.idp);
      } catch (saveErr) {
        console.error('[TalentMapIdpDetail] Failed to save IDP plan:', saveErr);
        setError('План сгенерирован, но не сохранён — при перезагрузке страницы может исчезнуть.');
      }
    } catch (err) {
      console.error('[TalentMapIdpDetail] IDP generation failed:', err);
      setError(err.message || 'Не удалось сгенерировать план развития.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
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

    const safeName = evaluee.fio.replace(/\s+/g, '_');
    pdf.save(`План_развития_${safeName}.pdf`);
  };

  return (
    <div style={{ maxWidth: '820px' }}>
      <div
        ref={reportRef}
        style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif", color: '#2B2620', background: BRAND.cream,
          borderRadius: 'var(--radius-card)', overflow: 'hidden', border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div style={{ background: BRAND.primary, padding: '2rem 2.25rem' }}>
          <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#fff', fontSize: '1.7rem', fontWeight: 700, margin: '0 0 0.45rem' }}>
            Индивидуальный план развития
          </h1>
          <div style={{ color: 'rgba(250,247,241,0.82)', fontSize: '0.95rem' }}>
            {evaluee.fio} · Грейд: {evaluee.grade || '—'}
          </div>
        </div>

        <div style={{ padding: '2.25rem' }}>
          <h3 style={{ marginTop: 0 }}>Баллы по компетенциям</h3>
          <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem', fontWeight: 600, color: BRAND.muted, textAlign: 'left' }}>Компетенция</th>
                  <th style={{ padding: '0.5rem 0.65rem', fontSize: '0.8rem', fontWeight: 600, color: BRAND.muted, textAlign: 'center', width: '100px' }}>Балл</th>
                </tr>
              </thead>
              <tbody>
                {compRows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '0.5rem 0.65rem', fontSize: '0.88rem' }}>{r.name}</td>
                    <td style={{ padding: '0.5rem 0.65rem', fontSize: '0.9rem', textAlign: 'center', fontWeight: 700, color: BRAND.primary }}>
                      {fmt(r.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '1.5rem', borderRadius: 'var(--radius-card)', background: BRAND.primary, color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
              <span style={{ background: BRAND.accent, color: '#fff', fontSize: '0.7rem', fontWeight: 700, padding: '0.2rem 0.55rem', borderRadius: '999px', letterSpacing: '0.04em' }}>
                AI
              </span>
              <h3 style={{ fontFamily: "'Fraunces', Georgia, serif", margin: 0, fontSize: '1.15rem' }}>План развития</h3>
            </div>

            {!plan && (
              <p style={{ margin: 0, color: 'rgba(250,247,241,0.75)', fontSize: '0.9rem' }}>
                План развития будет сгенерирован на основе баллов выше.
              </p>
            )}

            {plan && isStructuredIdp(plan) && <IdpPlanView data={plan} />}

            {plan && !isStructuredIdp(plan) && plan.text && (
              <p style={{ margin: 0, color: 'rgba(250,247,241,0.92)', fontSize: '0.92rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {plan.text}
              </p>
            )}

            <div className="report-no-pdf" style={{ marginTop: '1rem' }}>
              {error && <p style={{ color: '#FBD3C4', fontSize: '0.85rem', marginBottom: '0.6rem' }}>{error}</p>}
              <button
                onClick={handleGenerate}
                disabled={generating}
                style={plan ? {
                  background: 'none', border: 'none', color: 'rgba(250,247,241,0.85)', fontSize: '0.85rem',
                  cursor: 'pointer', padding: 0, textDecoration: 'underline', opacity: generating ? 0.6 : 1,
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                } : {
                  background: BRAND.accent, color: '#fff', border: 'none', borderRadius: 'var(--radius-btn)',
                  padding: '0.55rem 1.15rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
                  opacity: generating ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                }}
              >
                {generating ? 'Генерируется...' : plan ? (
                  <><RefreshCw size={13} strokeWidth={2} />Перегенерировать</>
                ) : (
                  <><Sparkles size={15} strokeWidth={2} />Сгенерировать план развития</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
        <button className="btn btn-accent" onClick={handleDownloadPdf} disabled={!plan}>
          <Download size={16} strokeWidth={2} />
          Скачать план (PDF)
        </button>
      </div>
    </div>
  );
}

export default TalentMapIdpDetail;
