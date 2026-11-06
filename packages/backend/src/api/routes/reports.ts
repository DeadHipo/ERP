import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import { cReasonSchema } from '@erp/shared/api-responses';
import type { Facade } from '../../facade';
import { ZERO } from '../../shared/money';
import { parse } from '../http';

/** Facade views over everything: reconciliation, signals, overview and the C queue. */
export function reportsRouter(facade: Facade) {
  const r = Router();

  r.get('/reconciliation', async (req, res) =>
    res.json(await facade.reconciliation(parse(S.periodQuery, req.query))),
  );
  r.get('/overview', async (req, res) => res.json(await facade.overview(parse(S.periodQuery, req.query))));
  r.get('/queue/:reason', async (req, res) => {
    const reason = parse(cReasonSchema, req.params.reason);
    const { limit, offset, q, account, month, ownerId, label, ...period } = parse(S.queueQuery, req.query);
    const { calculatedAt, groups } = await facade.queue(reason, period, { q, account, month, ownerId }, label);
    res.json({
      calculatedAt,
      total: groups.length,
      amount: groups.reduce((s, g) => s.add(g.amount), ZERO),
      items: groups.slice(offset, offset + limit),
    });
  });
  r.get('/signals', async (req, res) => {
    const { label, ...period } = parse(S.labelPeriodQuery, req.query);
    const s = await facade.signals(period, label);
    const limit = parse(S.listQuery, req.query).limit ?? 100;
    const cut = <T>(xs: T[]) => xs.slice(0, limit);
    res.json({
      ...s,
      unallocated: { ...s.unallocated, count: s.unallocated.pairs.length, pairs: cut(s.unallocated.pairs) },
      isrcsWithoutSplit: { count: s.isrcsWithoutSplit.length, items: cut(s.isrcsWithoutSplit) },
      ambiguousWriters: cut(s.ambiguousWriters),
      unfunded: cut(s.unfunded),
      labelUnmapped: cut(s.labelUnmapped),
      sublabelWithoutRule: cut(s.sublabelWithoutRule),
      ruleRecipientIsRow: cut(s.ruleRecipientIsRow),
      twoRowsOneOwner: cut(s.twoRowsOneOwner),
      tracksWithNote: cut(s.tracksWithNote),
      participantsWithoutOwner: cut(s.participantsWithoutOwner),
      assumptions: cut(s.assumptions),
      operationsWithoutLabel: cut(s.operationsWithoutLabel),
      labelOutsideAccount: cut(s.labelOutsideAccount),
      filesWithoutLabel: cut(s.filesWithoutLabel),
      adsWithoutLabel: cut(s.adsWithoutLabel),
      adOutsideBook: cut(s.adOutsideBook),
    });
  });

  return r;
}
