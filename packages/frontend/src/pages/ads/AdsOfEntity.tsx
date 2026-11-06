import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLabel, useWriteLabel } from '../../lib/label';
import { adQueries } from '../../api/queries/ads';
import { ActionButton } from '../../components/ActionButton';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { QueryView } from '../../components/PageState';
import { fmt, ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { Section, SimpleTable, Td } from '../owners/components/Fact';
import { CreateAdDialog } from './AdDialogs';

const t = ru.ads;
const LIMIT = 200;

/** «Реклама» of one track (P6, the tab) or one pseudonym (P12): its records, a link to the rest, and adding one here. */
export function AdsOfEntity(props: { isrc?: string; artistId?: string; pseudonym?: string }) {
  const [creating, setCreating] = useState(false);
  const { labelId } = useLabel(); // the label view: the records the label pays (D-169)
  const write = useWriteLabel(); // a record is written under a label: closed under «Все»
  const filter = { ...(props.isrc ? { isrc: props.isrc } : { artistId: props.artistId }), ...(labelId ? { label: labelId } : {}) };
  const query = useQuery(adQueries.list({ ...filter, limit: LIMIT }));
  const e = t.entity;
  const all = props.isrc ? `/ads?isrc=${props.isrc}` : `/ads?artistId=${props.artistId ?? ''}`;
  return (
    <Section
      title={e.title}
      testId="entity-ads"
      toolbar={
        <ActionButton name="create-ad" op="POST /ads" isDisabled={write.closed} reason={write.closed ? write.reason : undefined} onPress={() => setCreating(true)}>
          {t.create.open}
        </ActionButton>
      }
    >
      <QueryView query={query} money isEmpty={(d) => d.count === 0} emptyMessage={e.empty}>
        {(d) => (
          <>
            <SimpleTable head={[e.cols.month, e.cols.isrc, e.cols.amount, e.cols.percent, e.cols.status, e.cols.artists]} testId="entity-ads-table">
              {d.items.map((a) => (
                <tr key={a.id} data-testid={`entity-ad-${a.id}`}>
                  <Td>
                    <EntityLink kind="ad" id={a.id} label={a.month} />
                  </Td>
                  <Td>{a.isrc ? <EntityLink kind="isrc" id={a.isrc} /> : '—'}</Td>
                  <Td col="amount">
                    <Money value={centsToText(a.amountCents)} />
                  </Td>
                  <Td col="percent">{a.recoveryPercent}</Td>
                  <Td>{a.allocation ? t.status[a.allocation.status] : t.inactive}</Td>
                  <Td>
                    <span className="flex flex-col text-xs">
                      {(a.allocation?.parts ?? []).map((p) => (
                        <span key={p.artistId}>
                          <EntityLink kind="artist" id={p.artistId} label={p.pseudonym} /> · <Money value={p.recovered} />
                        </span>
                      ))}
                    </span>
                  </Td>
                </tr>
              ))}
            </SimpleTable>
            <div className="text-sm">
              {d.items.length < d.count ? `${fmt(e.more, { shown: d.items.length, n: d.count })} ` : null}
              <Link className="text-accent hover:underline" to={all} data-testid="entity-ads-all">
                {e.all}
              </Link>
            </div>
          </>
        )}
      </QueryView>
      {creating ? (
        <CreateAdDialog
          onClose={() => setCreating(false)}
          {...(props.isrc ? { isrc: props.isrc } : {})}
          {...(props.artistId ? { artistId: props.artistId } : {})}
          {...(props.pseudonym ? { pseudonym: props.pseudonym } : {})}
        />
      ) : null}
    </Section>
  );
}
