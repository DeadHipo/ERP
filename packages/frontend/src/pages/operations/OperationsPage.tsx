import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { operationsQuery } from '@erp/shared/api-schemas';
import { settlementQueries } from '../../api/queries/settlements';
import { ActionButton } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { statusLabel } from '../../components/StatusChip';
import { DateField } from '../../components/fields/DateField';
import { EntityPicker } from '../../components/fields/EntityPicker';
import { SelectField } from '../../components/fields/SelectField';
import { ru } from '../../i18n/ru';
import { useLabel } from '../../lib/label';
import { OperationsGrid } from './OperationsGrid';

const t = ru.money.operations;
const f = t.filters;
type Filter = z.input<typeof operationsQuery>;
const MEANINGS = ['payout', 'recoupable_payout', 'deduction', 'credit', 'return'] as const;
const KEYS = ['ownerId', 'meaning', 'needsProof', 'from', 'to', 'active'] as const;

/** The filters of P20 from the URL (`ownerId`, `meaning`, `needsProof`, `from`, `to`, `active`), sent as they are. */
function useOperationsFilter(): [Filter, (f: Record<(typeof KEYS)[number], string>) => void] {
  const [params, setParams] = useSearchParams();
  const flag = (v: string | null) => (v === 'true' || v === 'false' ? v : undefined);
  const filter: Filter = {
    ownerId: params.get('ownerId') ?? undefined,
    meaning: MEANINGS.find((m) => m === params.get('meaning')),
    needsProof: flag(params.get('needsProof')),
    active: flag(params.get('active')),
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  };
  const apply = (next: Record<(typeof KEYS)[number], string>) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const k of KEYS) {
        if (next[k]) p.set(k, next[k]);
        else p.delete(k);
      }
      return p;
    });
  return [filter, apply];
}

/** P20 Операции `/operations`: which operations exist, which lack a proof, which are deferred or inactive? */
export function OperationsPage() {
  const [filter, apply] = useOperationsFilter();
  const { labelId } = useLabel(); // the label view (D-168): the operations of the label; «Все» shows those without one too
  const query = useQuery(settlementQueries.operations({ ...filter, ...(labelId ? { label: labelId } : {}) }));
  const filtered = KEYS.some((k) => filter[k] !== undefined);
  return (
    <div data-testid="operations-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <Filters filter={filter} onApply={apply} />
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={filtered ? t.emptyFiltered : t.empty}>
        {(rows) => <OperationsGrid rows={rows} gridStateKey="grid" />}
      </QueryView>
    </div>
  );
}

function Filters(props: { filter: Filter; onApply: (f: Record<(typeof KEYS)[number], string>) => void }) {
  const [owner, setOwner] = useState<string | null>(props.filter.ownerId ?? null);
  const [meaning, setMeaning] = useState<string>(props.filter.meaning ?? 'all');
  const [active, setActive] = useState<string>(props.filter.active ?? 'all');
  const [from, setFrom] = useState(props.filter.from ?? '');
  const [to, setTo] = useState(props.filter.to ?? '');
  const needsProof = props.filter.needsProof === 'true';
  const values = (over: Partial<Record<(typeof KEYS)[number], string>> = {}) => ({
    ownerId: owner ?? '',
    meaning: meaning === 'all' ? '' : meaning,
    needsProof: needsProof ? 'true' : '',
    active: active === 'all' ? '' : active,
    from,
    to,
    ...over,
  });
  return (
    <div className="mb-3 flex flex-col gap-2" data-testid="operations-filters">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            data-testid="filter-needs-proof"
            checked={needsProof}
            onChange={(e) => props.onApply(values({ needsProof: e.target.checked ? 'true' : '' }))}
          />
          {f.needsProof}
        </label>
        <div className="w-44">
          <SelectField
            name="filter-meaning"
            label={f.meaning}
            value={meaning}
            onChange={setMeaning}
            options={[{ id: 'all', label: f.all }, ...MEANINGS.map((m) => ({ id: m, label: statusLabel('operationMeaning', m) }))]}
          />
        </div>
        <div className="w-40">
          <SelectField
            name="filter-active"
            label={f.active}
            value={active}
            onChange={setActive}
            options={[
              { id: 'all', label: f.all },
              { id: 'true', label: f.activeOnly },
              { id: 'false', label: f.inactiveOnly },
            ]}
          />
        </div>
        <div className="w-64">
          <EntityPicker name="filter-owner" label={f.owner} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
        </div>
        <div className="w-40">
          <DateField name="filter-from" label={f.from} value={from} onChange={setFrom} />
        </div>
        <div className="w-40">
          <DateField name="filter-to" label={f.to} value={to} onChange={setTo} />
        </div>
        <ActionButton name="operations-apply" write={false} onPress={() => props.onApply(values())}>
          {f.apply}
        </ActionButton>
        <ActionButton
          name="operations-reset"
          write={false}
          variant="secondary"
          onPress={() => {
            setOwner(null);
            setMeaning('all');
            setActive('all');
            setFrom('');
            setTo('');
            props.onApply({ ownerId: '', meaning: '', needsProof: '', active: '', from: '', to: '' });
          }}
        >
          {f.reset}
        </ActionButton>
      </div>
      {props.filter.ownerId ? (
        <div className="text-sm" data-testid="filter-owner-chip">
          {f.owner}: <EntityLink kind="owner" id={props.filter.ownerId} />
        </div>
      ) : null}
    </div>
  );
}
