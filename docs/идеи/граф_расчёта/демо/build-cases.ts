// Прототип графа расчёта: прогоняет 16 золотых кейсов через НАСТОЯЩИЕ чистые слои (packages/backend/src/facade/layers),
// выводит рёбра по решениям консилиума Р1–Р10 (../консилиум/итог.md) и пишет cases.js / cases.json для демо.
// Основной код не меняется, базы не нужны. Только синтетические псевдонимы мира тестов (world.ts).
//
// Запуск (из корня репозитория):
//   npx tsx docs/идеи/граф_расчёта/демо/build-cases.ts
// Скрипт падает (exit 1) с понятным сообщением, если хоть одна проверка или ожидание не сходится.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Decimal, ZERO } from '../../../../packages/backend/src/shared/money';
import { pct } from '../../../../packages/backend/src/facade/layers/exact';
import { canonical, reportDate } from '../../../../packages/backend/src/facade/layers/allocation';
import {
  allocateUnit,
  type Allocation,
  type LayerContext,
  type MasterUnit,
  type UnitState,
} from '../../../../packages/backend/src/facade/layers';
import {
  DEFAULT_LABELS,
  I1,
  makeContext,
  unit as mkUnit,
  type LabelSpec,
  type PartSpec,
  type World,
} from '../../../../packages/backend/tests/layers/world';

// ---------------------------------------------------------------------------------------------------------------
// Типы выходного файла (СХЕМА.md)

type EdgeKind =
  | 'top'
  | 'row'
  | 'draw'
  | 'artist_pool'
  | 'artist_share'
  | 'label_share'
  | 'sublabel'
  | 'remainder'
  | 'perimeter';

interface DemoEdge {
  from: string;
  to: string;
  amount: string;
  kind: EdgeKind;
  ruleId: string | null;
  documentId: string | null;
  percent: string | null;
  base: string | null;
  category: 'B' | 'C' | 'ours' | null;
  reason: string | null;
  assumption: 'document' | 'q11' | 'r1' | null;
}
interface DemoNode {
  id: string;
  label: string;
  column: 0 | 1 | 2 | 3 | 4;
  in: string;
  out: string;
  notes: { ruleId: string; missing: string; why: string }[];
  remainderTo?: string;
}
interface DemoUnit {
  unitKey: string;
  unit: {
    isrc: string;
    upc: string;
    reportingMonth: string;
    salesMonth: string;
    labelName: string;
    account: string;
    net: string;
  };
  status: UnitState['status'];
  scheme: 'master/standard';
  nodes: DemoNode[];
  edges: DemoEdge[];
  trace: {
    layer: string;
    scaledNet: string;
    labelShare: string;
    rows: { artistId: string; kind: string; amount: string }[];
  }[];
  checks: { nodeBalance: boolean; sinksEqualNet: boolean; edgesEqualAllocations: boolean; signOk: boolean };
}
interface DemoInput {
  kind: 'unit' | 'label' | 'split_row' | 'participation' | 'label_rule' | 'document';
  id: string;
  summary: string;
  fields: Record<string, string | null>;
  node: string;
}
interface DemoCase {
  id: string;
  title: string;
  level: 'простой' | 'средний' | 'сложный';
  source: string;
  description: string;
  units: DemoUnit[];
  inputs: DemoInput[];
}

// ---------------------------------------------------------------------------------------------------------------
// Деньги

const fmt = (d: Decimal): string => (d.isZero() ? ZERO : d).toFixed(12);
const sum = (xs: Decimal[]): Decimal => xs.reduce((a, x) => a.add(x), ZERO);
const D = (s: string) => new Decimal(s);

// ---------------------------------------------------------------------------------------------------------------
// Вывод рёбер (Р1): из состояния после split и финального, ctx — только участия (fromArtistId, fundedFrom).

const KIND_ORDER: EdgeKind[] = [
  'perimeter',
  'top',
  'row',
  'draw',
  'artist_pool',
  'artist_share',
  'label_share',
  'sublabel',
  'remainder',
];

interface RawEdge extends Omit<DemoEdge, 'amount' | 'percent' | 'base'> {
  amount: Decimal;
  percent: Decimal | null;
  base: Decimal | null;
}

const isSink = (id: string) => id.startsWith('artist:') || id === 'ours' || id.startsWith('c:');

/** Атрибуты категории с аллокации (только у рёбер в artist:*). */
const cat = (a: Allocation) => ({ category: a.category, reason: a.reason, assumption: a.assumption });

/** Найденные при выводе странности (для 01_как_собрать.md): печатаются в конце. */
const findings: string[] = [];

export function edgesOf(
  afterSplit: UnitState | undefined,
  final: UnitState,
  ctx: LayerContext,
  u: MasterUnit,
): { edges: RawEdge[]; notes: Map<string, DemoNode['notes']> } {
  const edges: RawEdge[] = [];
  const notes = new Map<string, DemoNode['notes']>();
  const note = (node: string, n: DemoNode['notes'][number]) => notes.set(node, [...(notes.get(node) ?? []), n]);
  const net = u.net;

  // Периметр: одно ребро, дальше ничего не работало.
  if (final.status === 'no_isrc' || final.status === 'unknown_pair') {
    edges.push({
      from: 'net',
      to: `c:${final.labelShareCategory}`,
      amount: final.labelShare,
      kind: 'perimeter',
      ruleId: null,
      documentId: null,
      percent: null,
      base: null,
      category: 'C',
      reason: final.labelShareCategory,
      assumption: null,
    });
    return { edges, notes };
  }
  if (!afterSplit) throw new Error('нет состояния после split у юнита, который не остановлен периметром');

  const parts = ctx.participationsAt(u.isrc, reportDate(u));
  const partById = new Map(parts.map((p) => [p.id, p]));

  // 1. off-the-top: из финала.
  for (const a of final.rows.filter((r) => r.kind === 'top'))
    edges.push({
      from: 'net',
      to: `artist:${a.artistId}`,
      amount: a.amount,
      kind: 'top',
      ruleId: a.ruleId,
      documentId: a.documentId,
      percent: a.percent,
      base: net,
      ...cat(a),
    });
  edges.push(remainder('net', 'scaledNet', final.scaledNet));

  // 2. split: строки после split, остаток = labelShare после split.
  const splitRows = afterSplit.rows.filter((r) => r.kind === 'row');
  for (const a of splitRows)
    edges.push({
      from: 'scaledNet',
      to: `row:${a.artistId}`,
      amount: a.amount,
      kind: 'row',
      ruleId: a.ruleId,
      documentId: a.documentId,
      percent: a.percent,
      base: afterSplit.scaledNet,
      category: null,
      reason: null,
      assumption: null,
    });
  edges.push(remainder('scaledNet', 'labelShare', afterSplit.labelShare));

  // Узлы-строки: id канонический; две строки одного id склеиваются (Р7).
  const rowIds = [...new Set(splitRows.map((r) => r.artistId))];
  const gross = new Map(rowIds.map((id) => [id, sum(splitRows.filter((r) => r.artistId === id).map((r) => r.amount))]));
  if (rowIds.length !== splitRows.length)
    findings.push(`${u.isrc}|${u.upc} net ${u.net.toFixed()}: строки ${splitRows.map((r) => r.artistId).join(', ')} после canonical склеены в узлы ${rowIds.map((i) => `row:${i}`).join(', ')}`);
  const finalRows = final.rows.filter((r) => r.kind === 'row');
  const finalOf = (id: string) => sum(finalRows.filter((r) => r.artistId === id).map((r) => r.amount));
  const shares = final.rows.filter((r) => r.kind === 'artist_share');
  const fromOf = (a: Allocation): string => {
    const p = partById.get(a.ruleId);
    if (!p) throw new Error(`artist_share ${a.ruleId}: участие не найдено в ctx.participationsAt`);
    return canonical(ctx, p.fromArtistId ?? '');
  };
  const sharesFrom = (id: string) => sum(shares.filter((a) => fromOf(a) === id).map((a) => a.amount));

  // 3a. pool: draw = строка после split − финальная строка − Σ artist_share из неё (вычитание, Р2).
  const poolAllocs = final.rows.filter((r) => r.kind === 'artist_pool');
  const draws = new Map<string, Decimal>();
  for (const id of rowIds) {
    const d = (gross.get(id) as Decimal).sub(finalOf(id)).sub(sharesFrom(id));
    draws.set(id, d);
    if (poolAllocs.length === 0 && !d.isZero())
      throw new Error(`${u.isrc}: из строки ${id} убыло ${fmt(d)} без пула и artist_share`);
  }
  if (poolAllocs.length > 0) {
    for (const id of rowIds)
      edges.push({
        from: `row:${id}`,
        to: 'pool',
        amount: draws.get(id) as Decimal,
        kind: 'draw',
        ruleId: null,
        documentId: null,
        percent: null,
        base: null,
        category: null,
        reason: null,
        assumption: null,
      });
    for (const a of poolAllocs)
      edges.push({
        from: 'pool',
        to: `artist:${a.artistId}`,
        amount: a.amount,
        kind: 'artist_pool',
        ruleId: a.ruleId,
        documentId: a.documentId,
        percent: a.percent,
        base: net,
        ...cat(a),
      });
  }

  // 3b. artist_share: от строки после пула (= строка после split − draw).
  for (const a of shares) {
    const from = fromOf(a);
    if (!gross.has(from)) {
      // no_source_row: ребра нет (Р6), подпись у получателя — ниже из shortfalls.
      continue;
    }
    edges.push({
      from: `row:${from}`,
      to: `artist:${a.artistId}`,
      amount: a.amount,
      kind: 'artist_share',
      ruleId: a.ruleId,
      documentId: a.documentId,
      percent: a.percent,
      base: (gross.get(from) as Decimal).sub(draws.get(from) as Decimal),
      ...cat(a),
    });
  }

  // 3c. label_share: base = net или доля лейбла после split.
  for (const a of final.rows.filter((r) => r.kind === 'label_share')) {
    const p = partById.get(a.ruleId);
    edges.push({
      from: 'labelShare',
      to: `artist:${a.artistId}`,
      amount: a.amount,
      kind: 'label_share',
      ruleId: a.ruleId,
      documentId: a.documentId,
      percent: a.percent,
      base: p?.base === 'net' ? net : afterSplit.labelShare,
      ...cat(a),
    });
  }

  // 3d. sublabel: base = доля лейбла после label_share = финальная доля + сам саблейбл.
  for (const a of final.rows.filter((r) => r.kind === 'sublabel'))
    edges.push({
      from: 'labelShare',
      to: `artist:${a.artistId}`,
      amount: a.amount,
      kind: 'sublabel',
      ruleId: a.ruleId,
      documentId: a.documentId,
      percent: a.percent,
      base: final.labelShare.add(a.amount),
      ...cat(a),
    });

  // Остатки: строка → её артист (по аллокации: у двух строк одного id могут быть разные документы → категории).
  for (const a of finalRows)
    edges.push({
      from: `row:${a.artistId}`,
      to: `artist:${a.artistId}`,
      amount: a.amount,
      kind: 'remainder',
      ruleId: a.ruleId,
      documentId: a.documentId,
      percent: null,
      base: null,
      ...cat(a),
    });
  const lsTo = final.labelShareCategory === 'ours' ? 'ours' : `c:${final.labelShareCategory}`;
  edges.push({
    ...remainder('labelShare', lsTo, final.labelShare),
    category: lsTo === 'ours' ? 'ours' : 'C',
    reason: lsTo === 'ours' ? null : final.labelShareCategory,
  });

  // Shortfall — подпись узла (Р9).
  for (const s of final.shortfalls) {
    const n = { ruleId: s.ruleId, missing: fmt(s.missing), why: s.why };
    if (s.why === 'top_above_100') note('net', n);
    else if (s.why === 'no_source_row') {
      const p = partById.get(s.ruleId);
      note(`artist:${canonical(ctx, p?.artistId ?? s.ruleId)}`, n);
    } else {
      const p = partById.get(s.ruleId);
      if (p?.fundedFrom === 'artist_pool') note('pool', n);
      else if (p?.fundedFrom === 'artist_share') note(`row:${canonical(ctx, p.fromArtistId ?? '')}`, n);
      else if (p?.fundedFrom === 'label_share') note('labelShare', n);
      else throw new Error(`shortfall ${s.ruleId} (${s.why}) не к чему привязать`);
    }
  }
  return { edges, notes };
}

function remainder(from: string, to: string, amount: Decimal): RawEdge {
  return {
    from,
    to,
    amount,
    kind: 'remainder',
    ruleId: null,
    documentId: null,
    percent: null,
    base: null,
    category: null,
    reason: null,
    assumption: null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Узлы, проверки, юнит

const columnOf = (id: string): DemoNode['column'] =>
  id === 'net'
    ? 0
    : id === 'scaledNet'
      ? 1
      : id === 'pool' || id.startsWith('row:')
        ? 2
        : id === 'labelShare'
          ? 3
          : 4;
const labelOf = (id: string): string =>
  id === 'net'
    ? 'net'
    : id === 'scaledNet'
      ? 'после top'
      : id === 'pool'
        ? 'пул'
        : id === 'labelShare'
          ? 'доля лейбла'
          : id === 'ours'
            ? 'наша доля'
            : id.startsWith('row:')
              ? `строка ${id.slice(4)}`
              : id.startsWith('c:')
                ? `ждёт: ${id.slice(2)}`
                : id.slice(7);

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

function buildUnit(caseId: string, w: World, u: MasterUnit): { du: DemoUnit; final: UnitState } {
  const ctx = makeContext(w);
  const { state: final, states } = allocateUnit(u, ctx);
  const afterSplit = states.find((s) => s.layer === 'split')?.state;
  const { edges: raw, notes } = edgesOf(afterSplit, final, ctx, u);
  const unitKey = `${u.upc}|${u.salesMonth}|${u.labelName}|${u.account}`;
  const where = `${caseId} ${unitKey}`;

  raw.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.to.localeCompare(b.to) ||
      (a.ruleId ?? '').localeCompare(b.ruleId ?? ''),
  );

  // Дубли ключа from→to#kind#ruleId (Р5 суммирует по ним на трек-месяце).
  const keys = new Map<string, number>();
  for (const e of raw) {
    const k = `${e.from}→${e.to}#${e.kind}#${e.ruleId ?? ''}`;
    keys.set(k, (keys.get(k) ?? 0) + 1);
  }
  for (const [k, n] of keys) if (n > 1) findings.push(`${where}: ключ ребра ${k} встречается ${n} раза`);

  // Проверка base: процент × base воспроизводит сумму (если по правилу нет shortfall).
  const short = new Set(final.shortfalls.map((s) => s.ruleId));
  for (const e of raw) {
    if (!e.percent || !e.base || (e.ruleId && short.has(e.ruleId))) continue;
    const want = pct(e.base, e.percent);
    if (!want.eq(e.amount))
      fail(`${where}: base не воспроизводит ребро ${e.from}→${e.to} (${e.kind}): ${fmt(e.base)} × ${e.percent.toFixed()} % = ${fmt(want)}, а ребро ${fmt(e.amount)}`);
  }

  // Узлы.
  const ids = new Set<string>(['net']);
  for (const e of raw) {
    ids.add(e.from);
    ids.add(e.to);
  }
  for (const k of notes.keys()) ids.add(k);
  const inOf = (id: string) => (id === 'net' ? u.net : sum(raw.filter((e) => e.to === id).map((e) => e.amount)));
  const outOf = (id: string) => sum(raw.filter((e) => e.from === id).map((e) => e.amount));
  const remTo = new Map<string, string>();
  for (const e of raw)
    if (e.kind === 'remainder' && (!e.from.startsWith('row:') || e.to === `artist:${e.from.slice(4)}`))
      remTo.set(e.from, e.to);
  const order = (id: string) => columnOf(id) * 1000;
  const nodes: DemoNode[] = [...ids]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((id) => {
      const inn = inOf(id);
      const node: DemoNode = {
        id,
        label: labelOf(id),
        column: columnOf(id),
        in: fmt(inn),
        out: fmt(isSink(id) ? inn : outOf(id)),
        notes: notes.get(id) ?? [],
      };
      const r = remTo.get(id);
      if (r) node.remainderTo = r;
      return node;
    });

  // Проверки.
  const balanced = ['net', 'scaledNet', 'labelShare', 'pool'];
  const nodeBalance = nodes
    .filter((n) => balanced.includes(n.id) || n.id.startsWith('row:'))
    .every((n) => {
      const ok = fmt(inOf(n.id)) === fmt(outOf(n.id));
      if (!ok) fail(`${where}: узел ${n.id} не сходится: in ${fmt(inOf(n.id))} ≠ out ${fmt(outOf(n.id))}`);
      return ok;
    });
  const sinks = sum(raw.filter((e) => isSink(e.to)).map((e) => e.amount));
  const sinksEqualNet = fmt(sinks) === fmt(u.net);
  if (!sinksEqualNet) fail(`${where}: Σ рёбер в стоки ${fmt(sinks)} ≠ net ${fmt(u.net)}`);
  const artists = new Set([...final.rows.map((r) => r.artistId), ...[...ids].filter((i) => i.startsWith('artist:')).map((i) => i.slice(7))]);
  const edgesEqualAllocations = [...artists].every((x) => {
    const e = sum(raw.filter((ed) => ed.to === `artist:${x}`).map((ed) => ed.amount));
    const a = sum(final.rows.filter((r) => r.artistId === x).map((r) => r.amount));
    const ok = fmt(e) === fmt(a);
    if (!ok) fail(`${where}: в artist:${x} рёбрами ${fmt(e)}, аллокациями ${fmt(a)}`);
    return ok;
  });
  const sign = u.net.isZero() ? 0 : u.net.isNeg() ? -1 : 1;
  const signOk = raw.every((e) => {
    const ok = e.amount.isZero() || (e.amount.isNeg() ? -1 : 1) === sign;
    if (!ok) fail(`${where}: ребро ${e.from}→${e.to} (${e.kind}) ${fmt(e.amount)} другого знака, чем net`);
    return ok;
  });

  const edges: DemoEdge[] = raw.map((e) => ({
    from: e.from,
    to: e.to,
    amount: fmt(e.amount),
    kind: e.kind,
    ruleId: e.ruleId,
    documentId: e.documentId,
    percent: e.percent ? e.percent.toFixed() : null,
    base: e.base ? fmt(e.base) : null,
    category: isSink(e.to) ? e.category : null,
    reason: isSink(e.to) ? e.reason : null,
    assumption: isSink(e.to) ? e.assumption : null,
  }));

  return {
    final,
    du: {
      unitKey,
      unit: {
        isrc: u.isrc,
        upc: u.upc,
        reportingMonth: u.reportingMonth,
        salesMonth: u.salesMonth,
        labelName: u.labelName,
        account: u.account,
        net: fmt(u.net),
      },
      status: final.status,
      scheme: 'master/standard',
      nodes,
      edges,
      trace: states.map(({ layer, state }) => ({
        layer,
        scaledNet: fmt(state.scaledNet),
        labelShare: fmt(state.labelShare),
        rows: state.rows.map((r) => ({ artistId: r.artistId, kind: r.kind, amount: fmt(r.amount) })),
      })),
      checks: { nodeBalance, sinksEqualNet, edgesEqualAllocations, signOk },
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Входы (инспектор)

const NODE_OF_FUNDED: Record<string, string> = {
  top: 'off-the-top',
  artist_pool: 'carve:pool',
  artist_share: 'carve:artist_share',
  label_share: 'carve:label_share',
};
const DOC_FIELDS: Record<string, { kind: string; status: string }> = {
  ok: { kind: 'appendix', status: 'approved' },
  no: { kind: 'appendix', status: 'not_approved' },
  assume: { kind: 'assumption', status: 'not_approved' },
};

function inputsOf(w: World, units: MasterUnit[]): DemoInput[] {
  const out: DemoInput[] = [];
  const docs = new Set<string>();
  const ctx = makeContext(w);
  for (const u of units)
    out.push({
      kind: 'unit',
      id: `${u.isrc}|${u.upc}|${u.salesMonth}`,
      summary: `юнит ${u.upc}, ${u.reportingMonth}, «${u.labelName}», net ${u.net.toFixed()}`,
      fields: {
        account: u.account,
        isrc: u.isrc,
        upc: u.upc,
        reporting_month: u.reportingMonth,
        sales_month: u.salesMonth,
        label_name: u.labelName,
        net: u.net.toFixed(),
      },
      node: 'net',
    });
  const labels = w.labels ?? DEFAULT_LABELS;
  const seen = new Set<string>();
  for (const u of units) {
    const lr = ctx.labelOf(u.labelName, reportDate(u));
    if (!lr) {
      if (!seen.has(`?${u.labelName}`)) {
        seen.add(`?${u.labelName}`);
        out.push({
          kind: 'label',
          id: `unmapped:${u.labelName}`,
          summary: `строка лейбла «${u.labelName}» не найдена в словаре алиасов`,
          fields: { label_name: u.labelName, label_id: null },
          node: 'label-of-record',
        });
      }
      continue;
    }
    if (seen.has(lr.id)) continue;
    seen.add(lr.id);
    const spec = labels.find((l) => l.id === lr.id) as LabelSpec;
    out.push({
      kind: 'label',
      id: spec.id,
      summary: `${spec.kind === 'own' ? 'наш лейбл' : 'саблейбл'} ${spec.name}${spec.own ? ` (под ${spec.own})` : ''}`,
      fields: {
        id: spec.id,
        name: spec.name,
        kind: spec.kind,
        own_label_id: spec.own ?? null,
        aliases: spec.aliases.join(', '),
      },
      node: 'label-of-record',
    });
    if (lr.rule) {
      if (lr.rule.documentId) docs.add(lr.rule.documentId);
      out.push({
        kind: 'label_rule',
        id: lr.rule.id,
        summary: `правило саблейбла ${lr.rule.percent.toFixed()} % остатка доли → ${lr.rule.recipientArtistId}, документ ${lr.rule.documentId ?? 'нет'}`,
        fields: {
          id: lr.rule.id,
          label_id: spec.id,
          percent: lr.rule.percent.toFixed(),
          recipient_artist_id: lr.rule.recipientArtistId,
          document_id: lr.rule.documentId,
          valid_from: spec.rule?.from ?? null,
          valid_to: spec.rule?.to ?? null,
        },
        node: 'sublabel',
      });
    }
  }
  const u0 = units[0] as MasterUnit;
  const sp = ctx.splitAt(u0.isrc, reportDate(u0));
  const spec = (w.splits?.[u0.isrc] ?? [])[0];
  if (sp) {
    if (sp.documentId) docs.add(sp.documentId);
    for (const sh of sp.shares) {
      if (sh.documentId) docs.add(sh.documentId);
      out.push({
        kind: 'split_row',
        id: `${sp.splitId}:${sh.artistId}`,
        summary: `строка ${sh.artistId} ${sh.percent.toFixed()} % от scaledNet, документ ${sh.documentId ?? sp.documentId ?? 'нет'}`,
        fields: {
          split_id: sp.splitId,
          isrc: u0.isrc,
          artist_id: sh.artistId,
          percent: sh.percent.toFixed(),
          document_id: sh.documentId,
          split_document_id: sp.documentId,
          valid_from: spec?.from ?? null,
          valid_to: spec?.to ?? null,
        },
        node: 'split',
      });
    }
  }
  const raw = w.parts ?? [];
  for (const p of ctx.participationsAt(u0.isrc, reportDate(u0))) {
    if (p.documentId) docs.add(p.documentId);
    const ps = raw[Number(p.id.split('-')[1])] as PartSpec | undefined;
    out.push({
      kind: 'participation',
      id: p.id,
      summary: `участие ${p.artistId} ${p.percent.toFixed()} % (${p.base}, ${p.fundedFrom}${p.fromArtistId ? ` из ${p.fromArtistId}` : ''}), документ ${p.documentId ?? 'нет'}`,
      fields: {
        id: p.id,
        isrc: u0.isrc,
        artist_id: p.artistId,
        percent: p.percent.toFixed(),
        base: p.base,
        funded_from: p.fundedFrom,
        from_artist_id: p.fromArtistId,
        document_id: p.documentId,
        valid_from: ps?.validFrom ?? null,
        valid_to: ps?.validTo ?? null,
      },
      node: NODE_OF_FUNDED[p.fundedFrom] ?? p.fundedFrom,
    });
  }
  for (const d of [...docs].sort()) {
    const f = DOC_FIELDS[d];
    out.push({
      kind: 'document',
      id: d,
      summary: `документ ${d}: ${f?.kind ?? '?'}, ${f?.status ?? 'missing'}`,
      fields: { id: d, kind: f?.kind ?? null, status: f?.status ?? 'missing' },
      node: 'categorise',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Кейсы (миры 1:1 с packages/backend/tests/golden.test.ts и tests/layers/*.test.ts)

interface Expect {
  B: string;
  C: string;
  ours: string;
  amounts: Record<string, string>;
}
interface CaseSpec {
  id: string;
  title: string;
  level: DemoCase['level'];
  description: string;
  world: World;
  units: MasterUnit[];
  /** По юниту (в порядке units). */
  expect: Expect[];
}

const rows = (...s: [string, string, string?][]): World['splits'] => ({ [I1]: [{ shares: s }] });
const NG = 'NoGhost Records';
const g18: PartSpec[] = [
  { artist: 'R', percent: '15', funded: 'top' },
  { artist: 'M', percent: '13', funded: 'artist_pool' },
  { artist: 'P', percent: '10', funded: 'label_share', base: 'bucket' },
];

const CASES: CaseSpec[] = [
  {
    id: 'G01',
    title: 'Одна строка 50',
    level: 'простой',
    description: 'Сплит с одной строкой A 50 %. A получает половину, остаток доли лейбла — нам.',
    world: { splits: rows(['A', '50']) },
    units: [mkUnit('100')],
    expect: [{ B: '50', C: '0', ours: '50', amounts: { A: '50' } }],
  },
  {
    id: 'G04',
    title: 'Ремиксер с верха',
    level: 'простой',
    description:
      'Участие R 15 % (net, top) берётся до сплита; строки A и B по 25 % считаются от scaledNet 85. Ждём R 15, A 21.25, B 21.25, наши 42.5.',
    world: { splits: rows(['A', '25'], ['B', '25']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] },
    units: [mkUnit('100')],
    expect: [{ B: '57.5', C: '0', ours: '42.5', amounts: { R: '15', A: '21.25', B: '21.25' } }],
  },
  {
    id: 'G05a',
    title: 'Саблейбл NoGhost: половина остатка',
    level: 'простой',
    description:
      'Строка лейбла NoGhost Records — саблейбл 0to8 с правилом 50 % остатка доли лейбла псевдониму NG (документ утверждён). Строка A 50: NG 25 (B), наши 25.',
    world: { splits: rows(['A', '50']) },
    units: [mkUnit('100', { labelName: NG })],
    expect: [{ B: '75', C: '0', ours: '25', amounts: { A: '50', NG: '25' } }],
  },
  {
    id: 'G12',
    title: 'Доля из строки артиста (artist_share)',
    level: 'средний',
    description: 'Битмейкер E получает 10 % строки A (bucket, artist_share из A). Строка A 50: E 5, A 45, наши 50.',
    world: {
      splits: rows(['A', '50']),
      parts: [{ artist: 'E', percent: '10', funded: 'artist_share', from: 'A' }],
    },
    units: [mkUnit('100')],
    expect: [{ B: '50', C: '0', ours: '50', amounts: { A: '45', E: '5' } }],
  },
  {
    id: 'G03b',
    title: 'Пул: два участника по 13 % net',
    level: 'средний',
    description:
      'Строки A 25, B 25; участия M1 и M2 по 13 % (net, artist_pool). Цели 26 берутся из строк пропорционально (по 13), A и B по 12. Узел pool без остатка.',
    world: {
      splits: rows(['A', '25'], ['B', '25']),
      parts: [
        { artist: 'M1', percent: '13', funded: 'artist_pool' },
        { artist: 'M2', percent: '13', funded: 'artist_pool' },
      ],
    },
    units: [mkUnit('100')],
    expect: [{ B: '50', C: '0', ours: '50', amounts: { A: '12', B: '12', M1: '13', M2: '13' } }],
  },
  {
    id: 'G11',
    title: 'A&R из доли лейбла (bucket)',
    level: 'средний',
    description: 'Строка A 50; участие P 15 % (bucket, label_share) — от доли лейбла 50: P 7.5, наши 42.5.',
    world: {
      splits: rows(['A', '50']),
      parts: [{ artist: 'P', percent: '15', funded: 'label_share', base: 'bucket' }],
    },
    units: [mkUnit('100')],
    expect: [{ B: '57.5', C: '0', ours: '42.5', amounts: { A: '50', P: '7.5' } }],
  },
  {
    id: 'G36',
    title: 'Сеттлмент 15 % net из доли лейбла',
    level: 'средний',
    description:
      'Строки A 25, B 25; участие S 15 % (net, label_share): процент от net, но деньги берутся из доли лейбла 50. S 15, наши 35.',
    world: {
      splits: rows(['A', '25'], ['B', '25']),
      parts: [{ artist: 'S', percent: '15', funded: 'label_share', base: 'net' }],
    },
    units: [mkUnit('100')],
    expect: [{ B: '65', C: '0', ours: '35', amounts: { A: '25', B: '25', S: '15' } }],
  },
  {
    id: 'G08c',
    title: 'Строка лейбла не распознана',
    level: 'средний',
    description:
      'Строка лейбла «Mystery Records» нет в словаре. Артист A по своей строке получает 50, остаток доли лейбла 50 ждёт в C label_unmapped.',
    world: { splits: rows(['A', '50']) },
    units: [mkUnit('100', { labelName: 'Mystery Records' })],
    expect: [{ B: '50', C: '50', ours: '0', amounts: { A: '50' } }],
  },
  {
    id: 'G21',
    title: 'Нет сплита, саблейбл (R1)',
    level: 'средний',
    description:
      'У ISRC нет сплита, строка лейбла NoGhost Records. Доля лейбла — весь net 100; NG 50 по правилу саблейбла, но это допущение R1 (C assumption); наши 50.',
    world: {},
    units: [mkUnit('100', { labelName: NG })],
    expect: [{ B: '0', C: '50', ours: '50', amounts: { NG: '50' } }],
  },
  {
    id: 'G22',
    title: 'Пул меньше цели: недостача',
    level: 'средний',
    description:
      'Строка A 10; участие P 20 % (net, artist_pool): цель 20, а в строках только 10. P берёт весь пул, строка A уходит в 0, недостача 10 — подпись у узла pool.',
    world: { splits: rows(['A', '10']), parts: [{ artist: 'P', percent: '20', funded: 'artist_pool' }] },
    units: [mkUnit('100')],
    expect: [{ B: '10', C: '0', ours: '90', amounts: { A: '0', P: '10' } }],
  },
  {
    id: 'G15',
    title: 'Отрицательный юнит −100',
    level: 'средний',
    description:
      'Как G04 плюс саблейбл NoGhost, но net −100 (возврат). Все рёбра со знаком юнита: R −15, A −21.25, B −21.25, NG −21.25, наши −21.25.',
    world: { splits: rows(['A', '25'], ['B', '25']), parts: [{ artist: 'R', percent: '15', funded: 'top' }] },
    units: [mkUnit('-100', { labelName: NG })],
    expect: [
      { B: '-78.75', C: '0', ours: '-21.25', amounts: { R: '-15', A: '-21.25', B: '-21.25', NG: '-21.25' } },
    ],
  },
  {
    id: 'G30',
    title: 'Периметр: неизвестная пара',
    level: 'средний',
    description:
      'Пара ISRC|UPC не известна модулю 1: юнит net 7 целиком ждёт в C unknown_pair, остальные слои не работают. Одно ребро.',
    world: { splits: rows(['A', '50']) },
    units: [mkUnit('7', { upc: '999' })],
    expect: [{ B: '0', C: '7', ours: '0', amounts: {} }],
  },
  {
    id: 'G18b',
    title: 'Всё вместе на одном юните',
    level: 'сложный',
    description:
      'NoGhost; строки A 25, B 25; R 15 (top), M 13 (pool), P 10 (bucket, label_share), E 10 из A (artist_share после пула). P и NG — допущение Q11 (C assumption).',
    world: {
      splits: rows(['A', '25'], ['B', '25']),
      parts: [...g18, { artist: 'E', percent: '10', funded: 'artist_share', from: 'A' }],
    },
    units: [mkUnit('100', { labelName: NG })],
    expect: [
      {
        B: '57.5',
        C: '23.375',
        ours: '19.125',
        amounts: { R: '15', A: '13.275', B: '14.75', M: '13', E: '1.475', P: '4.25', NG: '19.125' },
      },
    ],
  },
  {
    id: 'G34',
    title: 'Пико-остатки пула',
    level: 'сложный',
    description:
      'Строки A, B, C по 16.6; M 13 % (net, artist_pool). Пропорция 13 × 16.6 / 49.8 не конечна: квантуется до 12 знаков, остаток пико — строке с наибольшей суммой (при равенстве первой, A).',
    world: {
      splits: rows(['A', '16.6'], ['B', '16.6'], ['C', '16.6']),
      parts: [{ artist: 'M', percent: '13', funded: 'artist_pool' }],
    },
    units: [mkUnit('100')],
    expect: [
      {
        B: '49.8',
        C: '0',
        ours: '50.2',
        amounts: { A: '12.266666666666', B: '12.266666666667', C: '12.266666666667', M: '13' },
      },
    ],
  },
  {
    id: 'G46',
    title: 'По два artist_share на двух строках',
    level: 'сложный',
    description:
      'Карв Main «16.66 % (8.33/8.33)»: M1 и M2 каждый берут 16.66 % из строки A и 16.66 % из строки B (bucket, artist_share). Каждая строка 25 теряет 2 × 4.165, остаётся 16.67.',
    world: {
      splits: rows(['A', '25'], ['B', '25']),
      parts: ['M1', 'M2'].flatMap((m) =>
        ['A', 'B'].map(
          (src): PartSpec => ({
            artist: m,
            percent: '16.66',
            base: 'bucket',
            funded: 'artist_share',
            from: src,
            validFrom: '2026-01-01',
          }),
        ),
      ),
    },
    units: [mkUnit('100')],
    expect: [{ B: '50', C: '0', ours: '50', amounts: { A: '16.67', B: '16.67', M1: '8.33', M2: '8.33' } }],
  },
  {
    id: 'G24',
    title: 'Трек-месяц из двух юнитов',
    level: 'сложный',
    description:
      'Один ISRC с двумя UPC: юниты net 100 и net 50. Строка A 50, P 10 % (bucket, label_share). Корзины юнитов не склеиваются; на трек-месяце A 75, P 7.5, наши 67.5.',
    world: {
      splits: rows(['A', '50']),
      parts: [{ artist: 'P', percent: '10', funded: 'label_share', base: 'bucket' }],
      pairs: [`${I1}|1111111111111`, `${I1}|2222222222222`],
    },
    units: [mkUnit('100', { upc: '1111111111111' }), mkUnit('50', { upc: '2222222222222' })],
    expect: [
      { B: '55', C: '0', ours: '45', amounts: { A: '50', P: '5' } },
      { B: '27.5', C: '0', ours: '22.5', amounts: { A: '25', P: '2.5' } },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Сверка с 12_golden_cases.md

function totals(s: UnitState) {
  const of = (c: 'B' | 'C') => sum(s.rows.filter((r) => r.category === c).map((r) => r.amount));
  const ours = s.labelShareCategory === 'ours' ? s.labelShare : ZERO;
  const C = of('C').add(s.labelShareCategory === 'ours' ? ZERO : s.labelShare);
  return { B: of('B'), C, ours };
}

function verifyExpect(where: string, s: UnitState, e: Expect) {
  const t = totals(s);
  for (const k of ['B', 'C', 'ours'] as const)
    if (!t[k].eq(D(e[k]))) fail(`${where}: ${k} = ${t[k].toFixed()}, ожидалось ${e[k]} (12_golden_cases.md)`);
  const got = new Map<string, Decimal>();
  for (const r of s.rows) got.set(r.artistId, (got.get(r.artistId) ?? ZERO).add(r.amount));
  const names = new Set([...got.keys(), ...Object.keys(e.amounts)]);
  for (const n of names) {
    const g = got.get(n);
    const want = e.amounts[n];
    if (want === undefined) fail(`${where}: лишняя аллокация ${n} = ${g?.toFixed()}`);
    else if (!g || !g.eq(D(want))) fail(`${where}: ${n} = ${g?.toFixed() ?? 'нет'}, ожидалось ${want}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------

const out: DemoCase[] = [];
let unitCount = 0;
let edgeCount = 0;
for (const c of CASES) {
  const units = c.units.map((u, i) => {
    const { du, final } = buildUnit(c.id, c.world, u);
    verifyExpect(`${c.id} ${du.unitKey}`, final, c.expect[i] as Expect);
    unitCount++;
    edgeCount += du.edges.length;
    return du;
  });
  out.push({
    id: c.id,
    title: c.title,
    level: c.level,
    source: `docs/agents/12_golden_cases.md ${c.id}`,
    description: c.description,
    units,
    inputs: inputsOf(c.world, c.units),
  });
}
// G24: агрегат трек-месяца (Р5).
{
  const g24 = out.find((c) => c.id === 'G24') as DemoCase;
  const agg = new Map<string, Decimal>();
  for (const u of g24.units)
    for (const e of u.edges) agg.set(e.to, (agg.get(e.to) ?? ZERO).add(D(e.amount)));
  for (const [to, want] of [
    ['artist:A', '75'],
    ['artist:P', '7.5'],
    ['ours', '67.5'],
  ] as const)
    if (!(agg.get(to) ?? ZERO).eq(D(want))) fail(`G24 трек-месяц: в ${to} ${agg.get(to)?.toFixed()}, ожидалось ${want}`);
}

// Пробы (не в cases.js): миры, на которых дизайн консилиума проверяется на краях. Их провалы — не ошибка скрипта,
// а находки: они печатаются и описаны в 01_как_собрать.md.
const PROBES: { id: string; what: string; world: World; unit: MasterUnit }[] = [
  {
    id: 'P1',
    what: 'слияние: строки A 25 и A2 25 (A2 влит в A) + E 10 % из A',
    world: {
      splits: rows(['A', '25'], ['A2', '25']),
      parts: [{ artist: 'E', percent: '10', funded: 'artist_share', from: 'A' }],
      merged: { A2: 'A' },
    },
    unit: mkUnit('100'),
  },
  {
    id: 'P2',
    what: 'no_source_row: E 10 % из строки X, которой нет',
    world: { splits: rows(['A', '50']), parts: [{ artist: 'E', percent: '10', funded: 'artist_share', from: 'X' }] },
    unit: mkUnit('100'),
  },
  {
    id: 'P3',
    what: 'строки 50 + 50 на net 1 пико: capToBase срезает пико у строки',
    world: { splits: rows(['A', '50'], ['B', '50']) },
    unit: mkUnit('0.000000000001'),
  },
  {
    id: 'P4',
    what: 'top выше 100 % (плохие данные): R1 60 + R2 60',
    world: {
      splits: rows(['A', '50']),
      parts: [
        { artist: 'R1', percent: '60', funded: 'top' },
        { artist: 'R2', percent: '60', funded: 'top' },
      ],
    },
    unit: mkUnit('100'),
  },
  {
    id: 'P5',
    what: 'строка A 100 и саблейбл: нулевое ребро NG 0 (Р6)',
    world: { splits: rows(['A', '100']) },
    unit: mkUnit('100', { labelName: NG }),
  },
];
for (const p of PROBES) {
  const before = failures.length;
  const { du } = buildUnit(p.id, p.world, p.unit);
  const got = failures.splice(before);
  findings.push(
    `${p.id} (${p.what}): ${got.length ? got.join('; ') : 'все проверки сошлись'}; рёбер ${du.edges.length}` +
      `${du.nodes.some((n) => n.notes.length) ? `, подписи: ${du.nodes.filter((n) => n.notes.length).map((n) => `${n.id} ${n.notes.map((x) => x.why).join('/')}`).join(', ')}` : ''}` +
      `${du.edges.some((e) => e.amount === fmt(ZERO)) ? `, нулевые: ${du.edges.filter((e) => e.amount === fmt(ZERO)).map((e) => `${e.from}→${e.to}`).join(', ')}` : ''}`,
  );
}

if (failures.length) {
  console.error(`ПРОВАЛ: ${failures.length} проверок не сошлись:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

const dir = dirname(fileURLToPath(import.meta.url));
const json = JSON.stringify(out, null, 2);
writeFileSync(join(dir, 'cases.js'), `window.CASES = ${json};\n`);
writeFileSync(join(dir, 'cases.json'), `${json}\n`);
console.log(`OK: ${out.length} кейсов, ${unitCount} юнитов, ${edgeCount} рёбер; все проверки и ожидания сошлись.`);
if (findings.length) console.log(`Замечания при выводе рёбер:\n- ${[...new Set(findings)].join('\n- ')}`);
