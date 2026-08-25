import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { POOL_ORDER, POOL_LABELS, computeAutoPoolMembers } from '../talentNineBox';

// Один пул: автосписок из ячеек карты плюс ручные добавления/исключения
// поверх него. Автосписок — предложение, а не окончательное решение:
// финальный список утверждает калибровочный комитет, поэтому у каждой
// строки есть крестик «убрать», а сверху — выбор любого сотрудника для
// ручного добавления (не только тех, кто уже размещён на карте — комитет
// может захотеть отметить кого-то заранее).
function PoolCard({ poolKey, autoIds, override, employees, getEmployeeName, onSaveOverride }) {
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  const added = override?.added || [];
  const removed = new Set(override?.removed || []);
  const memberIds = [...new Set([...autoIds, ...added])].filter(id => !removed.has(id));

  const handleRemove = (id) => {
    const nextRemoved = [...new Set([...(override?.removed || []), id])];
    const nextAdded = (override?.added || []).filter(a => a !== id);
    onSaveOverride({ added: nextAdded, removed: nextRemoved });
  };

  const handleAdd = () => {
    if (!selectedId) return;
    const nextAdded = [...new Set([...(override?.added || []), selectedId])];
    const nextRemoved = (override?.removed || []).filter(r => r !== selectedId);
    onSaveOverride({ added: nextAdded, removed: nextRemoved });
    setSelectedId('');
    setShowAdd(false);
  };

  const availableToAdd = employees.filter(e => !memberIds.includes(e.id));

  return (
    <div style={{
      border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
      padding: '1.1rem 1.25rem', background: '#fff', marginBottom: '0.85rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
        <h5 style={{ margin: 0 }}>{POOL_LABELS[poolKey]} ({memberIds.length})</h5>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(v => !v)}>
          <Plus size={14} strokeWidth={2} />
          Добавить сотрудника
        </button>
      </div>

      {showAdd && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <select className="input" style={{ maxWidth: '320px' }} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">-- выберите сотрудника --</option>
            {availableToAdd.map(e => <option key={e.id} value={e.id}>{e.fio}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={!selectedId}>Добавить</button>
        </div>
      )}

      {memberIds.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.75rem', marginBottom: 0 }}>Пока пусто.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0.75rem 0 0', padding: 0 }}>
          {memberIds.map(id => {
            const manuallyAdded = added.includes(id) && !autoIds.includes(id);
            return (
              <li
                key={id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.4rem 0.6rem', borderRadius: '6px', background: 'var(--color-surface-tint)',
                  marginBottom: '0.35rem', fontSize: '0.85rem',
                }}
              >
                <span>
                  {getEmployeeName(id)}
                  {manuallyAdded && (
                    <em style={{ color: 'var(--color-text-muted)', fontStyle: 'normal', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                      (добавлен вручную)
                    </em>
                  )}
                </span>
                <button className="btn btn-icon btn-danger-ghost" title="Убрать из пула" onClick={() => handleRemove(id)}>
                  <X size={14} strokeWidth={2} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Пулы талантов (Фаза 5a): 4 списка ниже карты, каждый — автопредложение по
// ячейкам плюс ручная правка. placement — тот же массив с посчитанными
// xBand/yBand, что использует сетка 9-box.
function TalentMapTalentPools({ placement, quadrants, talentPoolOverrides, employees, onSaveOverride }) {
  const placed = placement.filter(p => p.xBand && p.yBand);
  const getEmployeeName = (id) => {
    const inPlacement = placed.find(p => p.evalueeId === id);
    if (inPlacement) return inPlacement.evaluee.fio;
    return employees.find(e => e.id === id)?.fio || id;
  };

  return (
    <div>
      <h4 style={{ marginBottom: '0.35rem' }}>Пулы талантов</h4>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
        Списки ниже — автоматическое предложение по ячейкам карты, а не окончательное решение. Добавляйте и убирайте
        сотрудников вручную — финальный список утверждает калибровочный комитет.
      </p>
      {POOL_ORDER.map(poolKey => (
        <PoolCard
          key={poolKey}
          poolKey={poolKey}
          autoIds={computeAutoPoolMembers(poolKey, placed, quadrants)}
          override={talentPoolOverrides?.[poolKey]}
          employees={employees}
          getEmployeeName={getEmployeeName}
          onSaveOverride={(next) => onSaveOverride(poolKey, next)}
        />
      ))}
    </div>
  );
}

export default TalentMapTalentPools;
