import { useQuery } from '@tanstack/react-query';
import type { ArtistDetail } from '@erp/shared/api-responses';
import { ownerQueries } from '../../api/queries/owners';
import { settlementQueries } from '../../api/queries/settlements';
import { AuditTable } from '../../components/AuditTable';
import { EntityLink } from '../../components/EntityLink';
import { QueryView } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { formatDateTime } from '../../lib/datetime';
import { fmt, ru } from '../../i18n/ru';
import { OperationsGrid } from '../operations/OperationsGrid';
import { Section, SimpleTable, Td } from '../owners/components/Fact';
import { DocumentCell, period } from '../reference/shared';

const t = ru.money.artist;
const r = ru.catalog.rules;

/** P12 Сплиты и участия: the tracks, every split with a row of the pseudonym, its participations, the sublabel rules naming it. */
export function ArtistRulesTab(props: { detail: ArtistDetail }) {
  const d = props.detail;
  const mine = new Set([d.artist.id, ...d.previousIds]);
  return (
    <div className="flex flex-col gap-4" data-testid="rules-tab">
      <Section title={t.rules.tracks} testId="artist-tracks">
        {d.tracks.length === 0 ? (
          <span className="text-sm text-muted">{t.rules.noTracks}</span>
        ) : (
          <ul className="flex flex-wrap gap-3 text-sm">
            {d.tracks.map((tr) => (
              <li key={tr.id} data-testid={`artist-track-${tr.isrc ?? tr.id}`}>
                {tr.isrc ? <EntityLink kind="isrc" id={tr.isrc} label={`${tr.isrc} · ${tr.title}`} /> : tr.title}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t.rules.splits} testId="artist-splits">
        {d.splits.length === 0 ? (
          <span className="text-sm text-muted">{ru.reference.artists.noSplits}</span>
        ) : (
          <SimpleTable head={[ru.reference.splits.cols.isrc, r.period, r.shares, t.rules.cols.ourShare, r.document]}>
            {d.splits.map((s) => (
              <tr key={s.id} data-testid={`split-${s.id}`}>
                <Td>
                  <EntityLink kind="isrc" id={s.isrc} />
                </Td>
                <Td>{period(s.validFrom, s.validTo)}</Td>
                <Td>
                  {s.shares.map((sh, i) => (
                    <span key={sh.artistId} className={mine.has(sh.artistId) ? 'font-medium' : ''}>
                      {i > 0 ? ', ' : ''}
                      <EntityLink kind="artist" id={sh.artistId} label={sh.pseudonym} /> {sh.percent} %
                      {sh.documentId ? (
                        <>
                          {' '}
                          <EntityLink kind="document" id={sh.documentId} label="→" />
                        </>
                      ) : null}
                    </span>
                  ))}
                </Td>
                <Td>{s.ourShare} %</Td>
                <Td>
                  <DocumentCell id={s.documentId} status={s.documentStatus} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      <Section title={t.rules.participations} testId="artist-participations">
        {d.participations.length === 0 ? (
          <span className="text-sm text-muted">{ru.reference.artists.noParticipations}</span>
        ) : (
          <SimpleTable head={[ru.reference.splits.cols.isrc, r.percent, r.base, r.fundedFrom, r.fromPseudonym, r.period, r.document]}>
            {d.participations.map((p) => (
              <tr key={p.id} data-testid={`participation-${p.id}`}>
                <Td>
                  <EntityLink kind="isrc" id={p.isrc} />
                </Td>
                <Td>{p.percent}</Td>
                <Td>{r.bases[p.base]}</Td>
                <Td>{ru.signalsPage.funded[p.fundedFrom]}</Td>
                <Td>{p.fromArtistId ? <EntityLink kind="artist" id={p.fromArtistId} label={p.fromPseudonym ?? p.fromArtistId} /> : '—'}</Td>
                <Td>{period(p.validFrom, p.validTo)}</Td>
                <Td>
                  <DocumentCell id={p.documentId} status={p.documentStatus} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      <Section title={t.rules.labelRules} testId="artist-label-rules">
        {d.labelRules.length === 0 ? (
          <span className="text-sm text-muted">{t.rules.noLabelRules}</span>
        ) : (
          <SimpleTable head={[t.rules.cols.label, t.rules.cols.percent, t.rules.cols.period, t.rules.cols.document]}>
            {d.labelRules.map((x) => (
              <tr key={x.id} data-testid={`label-rule-${x.id}`}>
                <Td>
                  <EntityLink kind="label" id={x.labelId} label={x.labelName} />
                </Td>
                <Td>{x.percent} %</Td>
                <Td>{period(x.validFrom, x.validTo)}</Td>
                <Td>
                  <DocumentCell id={x.documentId} status={x.documentStatus} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      {d.merges.length > 0 ? (
        <Section title={t.rules.merges} testId="artist-merges">
          <ul className="list-disc pl-5 text-sm">
            {d.merges.map((m) => (
              <li key={`${m.fromId}-${m.at}`} data-testid={`artist-merge-${m.fromId}`}>
                {fmt(t.rules.mergeLine, { from: m.fromId, into: m.intoId, reason: m.reason, at: formatDateTime(m.at) })}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

/** P12 Документы: the documents the splits, rows, participations, contracts and rules cite, and the contracts naming the pseudonym (read-only; actions live on P13 and P10). */
export function ArtistDocumentsTab(props: { detail: ArtistDetail }) {
  const d = props.detail;
  const titleOf = (id: string) => d.documents.find((x) => x.id === id)?.title ?? id;
  const c = ru.money.documents.cols;
  return (
    <div className="flex flex-col gap-4" data-testid="documents-tab">
      <Section title={t.documents.documents}>
        {d.documents.length === 0 ? (
          <span className="text-sm text-muted">{t.documents.empty}</span>
        ) : (
          <SimpleTable head={[c.title, c.kind, c.status]}>
            {d.documents.map((doc) => (
              <tr key={doc.id} data-testid={`document-${doc.id}`}>
                <Td>
                  <EntityLink kind="document" id={doc.id} label={doc.title} />
                </Td>
                <Td>
                  <StatusChip kind="documentKind" value={doc.kind} />
                </Td>
                <Td>
                  <StatusChip kind="documentStatus" value={doc.status} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      <Section title={t.documents.contracts}>
        {d.contracts.length === 0 ? (
          <span className="text-sm text-muted">{t.documents.contractsEmpty}</span>
        ) : (
          <SimpleTable head={[c.number, c.document]}>
            {d.contracts.map((x) => (
              <tr key={x.id} data-testid={`contract-${x.id}`}>
                <Td>{x.number ?? '—'}</Td>
                <Td>
                  <EntityLink kind="document" id={x.documentId} label={titleOf(x.documentId)} />
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
    </div>
  );
}

/** P12 Операции: the operations tied to the pseudonym (`GET /settlements/operations?artistId=`): advances, deductions, credits. */
export function ArtistOperationsTab(props: { artistId: string; labelId?: string }) {
  const query = useQuery(settlementQueries.operations({ artistId: props.artistId, ...(props.labelId ? { label: props.labelId } : {}) }));
  return (
    <div className="flex flex-col gap-3" data-testid="operations-tab">
      <p className="text-sm text-muted">{t.operations.note}</p>
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.operations.empty}>
        {(rows) => <OperationsGrid rows={rows} showOwner={false} />}
      </QueryView>
    </div>
  );
}

/** P12 История: the audit trail of writes that touched the pseudonym (`GET /audit?entityId=`). */
export function ArtistHistoryTab(props: { artistId: string }) {
  const query = useQuery(ownerQueries.audit(props.artistId));
  return (
    <div data-testid="history-tab">
      <QueryView query={query} isEmpty={(d) => d.items.length === 0} emptyMessage={ru.audit.empty}>
        {(data) => <AuditTable items={data.items} />}
      </QueryView>
    </div>
  );
}
