import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ownerQueries } from '../../api/queries/owners';
import { EntityLink } from '../../components/EntityLink';
import { StatusChip } from '../../components/StatusChip';
import { ru } from '../../i18n/ru';

/** Owner names by id from the cached `GET /owners` list. */
export function useOwnerNames(): Map<string, string> {
  const owners = useQuery(ownerQueries.list());
  return useMemo(() => new Map((owners.data ?? []).map((o) => [o.id, o.name])), [owners.data]);
}

/** `from → to` of a rule period (`valid_to` is exclusive; null = open-ended). */
export const period = (from: string, to: string | null) => `${from} → ${to ?? ru.reference.common.open}`;

/** A document link with its status chip (or a dash when the row has no document). */
export function DocumentCell({ id, status }: { id: string | null; status: string }) {
  return (
    <span className="flex items-center gap-1">
      {id ? <EntityLink kind="document" id={id} label="→" /> : null}
      <StatusChip kind="documentStatus" value={status} />
    </span>
  );
}

export function OwnerLink({ ownerId, names }: { ownerId: string | null; names: Map<string, string> }) {
  if (!ownerId) return <span className="text-muted">{ru.reference.common.noOwner}</span>;
  return <EntityLink kind="owner" id={ownerId} label={names.get(ownerId) ?? ownerId} />;
}

/** A non-negative integer from digits (paging values live in the URL as text; R1 bans `Number(`). */
export const toInt = (s: string): number => s.split('').reduce((n, c) => (c >= '0' && c <= '9' ? n * 10 + (c.charCodeAt(0) - 48) : n), 0);
