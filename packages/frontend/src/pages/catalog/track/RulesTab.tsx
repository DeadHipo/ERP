import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TrackMoney } from '@erp/shared/api-responses';
import { labelQueries } from '../../../api/queries/labels';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { StatusChip } from '../../../components/StatusChip';
import { fmt, ru } from '../../../i18n/ru';
import { ConfirmSplitDialog } from '../../work/actions/dialogs';
import { SimpleTable, Td } from '../components/MoneyTable';
import { BuyoutDialog, SplitDialog } from './SplitDialogs';
import { CloseParticipationDialog, CreateParticipationDialog } from './ParticipationDialogs';
import { periodText, type Participation, type Split } from './types';
import { AssumeDialog } from '../../reference/splits/AssumeDialog';

const r = ru.catalog.rules;

type Open =
  | { kind: 'create-split' }
  | { kind: 'change-split' }
  | { kind: 'buyout' }
  | { kind: 'confirm-split'; split: Split }
  | { kind: 'create-participation' }
  | { kind: 'close-participation'; part: Participation }
  | { kind: 'assume' }
  | null;

/** Правила: split rows with periods, participations, the sublabel rule of each month; the rule actions of 17 §6. */
export function RulesTab({ isrc, data }: { isrc: string; data: TrackMoney }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const splits = [...data.splits].sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  const undocumented = splits.filter((s) => s.documentId === null).length;
  return (
    <div className="flex flex-col gap-6" data-testid="rules-tab">
      <div className="flex flex-wrap gap-2">
        <ActionButton name="create-split" op="POST /splits" onPress={() => setOpen({ kind: 'create-split' })}>
          {r.createSplit}
        </ActionButton>
        <ActionButton
          name="change-split" op="POST /splits/change"
          isDisabled={splits.length === 0}
          reason={r.noCurrent}
          onPress={() => setOpen({ kind: 'change-split' })}
        >
          {r.changeSplit}
        </ActionButton>
        <ActionButton name="buyout" op="POST /splits/buyout" isDisabled={splits.length === 0} reason={r.noCurrent} onPress={() => setOpen({ kind: 'buyout' })}>
          {r.buyout}
        </ActionButton>
        <ActionButton name="create-participation" op="POST /participations" onPress={() => setOpen({ kind: 'create-participation' })}>
          {r.createParticipation}
        </ActionButton>
        {/* D-172: every split of the ISRC without a document gets one assumption document (the backend picks them) */}
        <ActionButton
          name="assume-isrc"
          op="POST /splits/assume"
          variant="secondary"
          isDisabled={undocumented === 0}
          reason={ru.reference.splits.hasDocument}
          onPress={() => setOpen({ kind: 'assume' })}
        >
          {ru.reference.splits.assume}
        </ActionButton>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-medium">{r.splits}</h2>
        {splits.length === 0 ? (
          <p className="text-sm text-muted" data-testid="no-splits">
            {r.noSplits}
          </p>
        ) : (
          <SimpleTable testId="splits" headers={[r.period, r.shares, r.ourShare, r.document, '']}>
            {splits.map((s) => (
              <tr key={s.id} data-testid={`split-${s.id}`} className="border-t border-border">
                <Td col="period">{periodText(s.validFrom, s.validTo, r.open)}</Td>
                <Td col="shares">
                  <ul className="flex flex-col gap-0.5">
                    {s.shares.map((sh) => (
                      <li key={sh.artistId} data-testid={`share-${sh.artistId}`}>
                        <EntityLink kind="artist" id={sh.artistId} label={sh.pseudonym} /> {sh.percent} %
                        {sh.documentId ? (
                          <span className="text-xs text-muted">
                            {' · '}
                            {r.rowDocument} <EntityLink kind="document" id={sh.documentId} label="→" />
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </Td>
                <Td col="ourShare">{s.ourShare} %</Td>
                <Td col="document">
                  <span className="flex items-center gap-1">
                    {s.documentId ? <EntityLink kind="document" id={s.documentId} label="→" /> : null}
                    <StatusChip kind="documentStatus" value={s.documentStatus} />
                  </span>
                </Td>
                <Td>
                  <ActionButton
                    name="confirm-split" op="POST /splits/:id/confirm"
                    variant="secondary"
                    isDisabled={s.documentId !== null}
                    reason={r.hasDocument}
                    onPress={() => setOpen({ kind: 'confirm-split', split: s })}
                  >
                    {r.confirmSplit}
                  </ActionButton>
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium">{r.participations}</h2>
        {data.participations.length === 0 ? (
          <p className="text-sm text-muted">{r.noParticipations}</p>
        ) : (
          <SimpleTable testId="participations" headers={[r.pseudonym, r.percent, r.base, r.fundedFrom, r.fromPseudonym, r.period, r.document, '']}>
            {data.participations.map((p) => (
              <tr key={p.id} data-testid={`participation-${p.id}`} className="border-t border-border">
                <Td col="pseudonym">
                  <EntityLink kind="artist" id={p.artistId} label={p.pseudonym} />
                </Td>
                <Td col="percent">{p.percent}</Td>
                <Td col="base">{r.bases[p.base]}</Td>
                <Td col="fundedFrom">{ru.signalsPage.funded[p.fundedFrom]}</Td>
                <Td col="fromPseudonym">
                  {p.fromArtistId ? <EntityLink kind="artist" id={p.fromArtistId} label={p.fromPseudonym ?? p.fromArtistId} /> : '—'}
                </Td>
                <Td col="period">{periodText(p.validFrom, p.validTo, r.open)}</Td>
                <Td col="document">
                  <span className="flex items-center gap-1">
                    {p.documentId ? <EntityLink kind="document" id={p.documentId} label="→" /> : null}
                    <StatusChip kind="documentStatus" value={p.documentStatus} />
                  </span>
                </Td>
                <Td>
                  <ActionButton name="close-participation" op="POST /participations/:id/close" variant="secondary" onPress={() => setOpen({ kind: 'close-participation', part: p })}>
                    {r.closeParticipation}
                  </ActionButton>
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </section>
      <LabelRules data={data} />
      {open?.kind === 'create-split' ? <SplitDialog mode="create" isrc={isrc} splits={splits} onClose={close} /> : null}
      {open?.kind === 'change-split' ? <SplitDialog mode="change" isrc={isrc} splits={splits} onClose={close} /> : null}
      {open?.kind === 'buyout' ? <BuyoutDialog isrc={isrc} splits={splits} onClose={close} /> : null}
      {open?.kind === 'confirm-split' ? <ConfirmSplitDialog splitId={open.split.id} isrc={isrc} onClose={close} /> : null}
      {open?.kind === 'create-participation' ? <CreateParticipationDialog isrc={isrc} splits={splits} onClose={close} /> : null}
      {open?.kind === 'close-participation' ? <CloseParticipationDialog part={open.part} onClose={close} /> : null}
      {open?.kind === 'assume' ? (
        <AssumeDialog group={{ isrcs: [isrc] }} candidates={undocumented} title={fmt(ru.reference.splits.assumeIsrc, { isrc })} onClose={close} />
      ) : null}
    </div>
  );
}

/** The sublabel rule in force at each report month (`months[].rule`), resolved against the label list. */
function LabelRules({ data }: { data: TrackMoney }) {
  const labels = useQuery(labelQueries.list());
  const seen = new Set<string>();
  const rows = data.months.filter((m) => {
    if (!m.rule) return false;
    const key = `${m.reportingMonth}|${m.rule}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ruleOf = (id: string) => labels.data?.flatMap((l) => l.rules.map((rule) => ({ label: l, rule }))).find((x) => x.rule.id === id);
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{r.labelRules}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{r.noLabelRules}</p>
      ) : (
        <SimpleTable testId="label-rules" headers={[r.month, r.sublabel, r.recipient, r.percent, r.period, r.document]}>
          {rows.map((m) => {
            const found = m.rule ? ruleOf(m.rule) : undefined;
            return (
              <tr key={`${m.reportingMonth}-${m.rule}`} data-testid={`label-rule-${m.reportingMonth}`} className="border-t border-border">
                <Td>{m.reportingMonth}</Td>
                <Td>{found ? <EntityLink kind="label" id={found.label.id} label={found.label.name} /> : (m.sublabelName ?? '—')}</Td>
                <Td>
                  {found ? <EntityLink kind="artist" id={found.rule.recipientArtistId} label={found.rule.recipientPseudonym} /> : '—'}
                </Td>
                <Td col="percent">{found?.rule.percent ?? '—'}</Td>
                <Td>{found ? periodText(found.rule.validFrom, found.rule.validTo, r.open) : '—'}</Td>
                <Td>
                  {found ? (
                    <span className="flex items-center gap-1">
                      {found.rule.documentId ? <EntityLink kind="document" id={found.rule.documentId} label="→" /> : null}
                      <StatusChip kind="documentStatus" value={found.rule.documentStatus} />
                    </span>
                  ) : null}
                </Td>
              </tr>
            );
          })}
        </SimpleTable>
      )}
    </section>
  );
}
