import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { PageHeader } from '../../components/PageHeader';
import { PageState, QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EntityPicker } from '../../components/fields/EntityPicker';
import { Money } from '../../components/Money';
import { StatusChip } from '../../components/StatusChip';
import { call } from '../../api/client';
import { ownerQueries } from '../../api/queries/owners';
import { reportQueries } from '../../api/queries/reports';
import { sourceQueries } from '../../api/queries/sources';
import { trackQueries } from '../../api/queries/tracks';
import { useAction } from '../../api/queries/core';

// The states fixture page: `/dev/states?case=<ss1..ss7|action>`. The checks SS1..SS7 of 19_golden_screens.md run here against `page.route` mocks (e2e/states.spec.ts). Each case
// uses one real client function, so the mocks exercise the real client, schema parse and components.

const CASES = ['ss1', 'ss2', 'ss3', 'ss4', 'ss5', 'ss6', 'ss7', 'action'] as const;

export function StatesPage() {
  const [params] = useSearchParams();
  const which = params.get('case');
  return (
    <div data-testid="states-page">
      <PageHeader title="Состояния (стенд)" subtitle="Стенд для проверок пустого, долгого и ошибочного состояний." />
      {which === 'ss1' ? <Ss1 /> : null}
      {which === 'ss2' ? <Ss2 /> : null}
      {which === 'ss3' ? <Ss3 /> : null}
      {which === 'ss4' ? <Ss4 /> : null}
      {which === 'ss5' ? <Ss5 /> : null}
      {which === 'ss6' ? <Ss6 /> : null}
      {which === 'ss7' ? <Ss7 /> : null}
      {which === 'action' ? <ActionCase /> : null}
      {which === null || !CASES.some((c) => c === which) ? (
        <ul className="list-disc pl-5">
          {CASES.map((c) => (
            <li key={c}>
              <Link className="text-accent hover:underline" to={`/dev/states?case=${c}`}>
                {c}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** SS1: no files loaded -> the empty state with the upload link. */
function Ss1() {
  const query = useQuery(sourceQueries.files(''));
  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.believe.length === 0 && d.b17.length === 0}
      emptyMessage="отчёты не загружены"
      emptyAction={
        <Link className="text-accent hover:underline" to="/sources">
          Загрузить отчёты
        </Link>
      }
    >
      {(d) => <p data-testid="ss1-files">{d.believe.length}</p>}
    </QueryView>
  );
}

/** SS2: a slow money query -> the long state and the recalc indicator; the shell stays usable. */
function Ss2() {
  const query = useQuery(reportQueries.reconciliation({ from: '2001-01' }));
  return (
    <QueryView query={query} money>
      {(rows) => <p data-testid="ss2-rows">{rows.length}</p>}
    </QueryView>
  );
}

/** SS3: a 500 from the balance endpoint -> the error state with code and message; retry refetches. */
function Ss3() {
  const query = useQuery(ownerQueries.balance('o-ss3'));
  return (
    <QueryView query={query} money>
      {(b) => <p data-testid="ss3-owner">{b.owner.name}</p>}
    </QueryView>
  );
}

/** SS4: a response of the wrong shape -> `contract_mismatch`. */
function Ss4() {
  const query = useQuery(trackQueries.explain('QZTST0000001'));
  return (
    <QueryView query={query} money>
      {(t) => <p data-testid="ss4-track">{t.isrc}</p>}
    </QueryView>
  );
}

/** SS5: an action invalidates the money queries; the old numbers stay with the stale badge until the new ones arrive. */
function Ss5() {
  const query = useQuery(reportQueries.reconciliation({ from: '2002-01' }));
  const echo = useAction(() => call('POST', '/dev/echo', { body: {}, schema: z.object({ ok: z.boolean() }) }), {
    invalidate: 'money',
    success: () => 'Записано',
  });
  return (
    <div className="flex flex-col gap-3">
      <ActionButton name="refresh" isPending={echo.isPending} onPress={() => echo.mutate(undefined)}>
        Записать и пересчитать
      </ActionButton>
      <QueryView query={query} money>
        {(rows) => (
          <ul data-testid="ss5-rows">
            {rows.map((r) => (
              <li key={`${r.account}|${r.month}`}>
                {r.account} {r.month}: <Money value={r.A_received} />
              </li>
            ))}
          </ul>
        )}
      </QueryView>
    </div>
  );
}

/** SS6: 26,000 rows in one grid, paged on the client. */
function Ss6() {
  const rows = useMemo(() => {
    const out: { isrc: string; title: string; net: string }[] = [];
    for (let i = 1; i <= 26000; i++) {
      const n = String(i).padStart(5, '0');
      out.push({ isrc: `T${n}`, title: `Трек ${n}`, net: `${i}.${String(i % 100).padStart(2, '0')}6` });
    }
    return out;
  }, []);
  return (
    <DataGrid
      gridStateKey="g"
      rowData={rows}
      getRowId={(r) => r.isrc}
      columnDefs={[
        { field: 'isrc', headerName: 'ISRC' },
        { field: 'title', headerName: 'Название' },
        { field: 'net', headerName: 'Net', cellRenderer: (p: { value: string }) => <Money value={p.value} /> },
      ]}
    />
  );
}

/** SS7: the picker searches (a mocked `/search` with 2,100 owners) and never lists them all. */
function Ss7() {
  const [picked, setPicked] = useState<{ key: string | null; label: string }>({ key: null, label: '' });
  return (
    <div className="max-w-md">
      <EntityPicker
        name="owner"
        label="Владелец"
        kind="owners"
        value={picked.key}
        onChange={(key, label) => setPicked({ key, label })}
      />
      <p className="mt-2 text-sm" data-testid="ss7-picked">
        {picked.key ?? ''}
      </p>
    </div>
  );
}

/** The action controls: ActionButton (operator gate, pending), ConfirmDialog, toasts, StatusChip. */
function ActionCase() {
  const [open, setOpen] = useState(false);
  const echo = useAction(() => call('POST', '/dev/echo', { body: {}, schema: z.object({ ok: z.boolean() }) }), {
    invalidate: 'reference',
    success: () => 'Записано',
  });
  return (
    <div className="flex flex-col gap-3">
      <ActionButton name="demo" isPending={echo.isPending} onPress={() => setOpen(true)}>
        Записать
      </ActionButton>
      <ConfirmDialog
        isOpen={open}
        onOpenChange={setOpen}
        title="Записать"
        lines={['Будет отправлен один запрос']}
        isPending={echo.isPending}
        onConfirm={() => echo.mutate(undefined, { onSettled: () => setOpen(false) })}
      />
      <div className="flex gap-2">
        <StatusChip kind="documentStatus" value="approved" />
        <StatusChip kind="cReason" value="assumption" />
        <StatusChip kind="ownerStatus" value="waiting_documents" />
      </div>
      <PageState variant="empty" message="Пример пустого состояния" />
    </div>
  );
}
