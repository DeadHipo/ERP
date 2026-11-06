import { useState } from 'react';
import type { z } from 'zod';
import type { fundedFrom as fundedFromSchema, participationBase } from '@erp/shared/api-schemas';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { DateField } from '../../../components/fields/DateField';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../../work/actions/DocumentStep';
import { roundedNote } from './SplitDialogs';
import { periodText, type Participation, type Split } from './types';
import { SPLIT_STEP_KINDS } from '../../../lib/document-kinds';

const r = ru.catalog.rules;
const f = r.fields;
type Base = z.output<typeof participationBase>;
type Funded = z.output<typeof fundedFromSchema>;
const BASES: readonly Base[] = ['net', 'bucket'];
const FUNDED: readonly Funded[] = ['top', 'artist_pool', 'artist_share', 'label_share'];

/**
 * «Создать участие» (`POST /participations`): the backend accepts or refuses the combination (409
 * `double_participation`, `participation_overlap`, 422 `top_above_100` ...); a refusal is a toast with its code.
 */
export function CreateParticipationDialog(props: { isrc: string; splits: readonly Split[]; onClose: () => void }) {
  const rowArtists = [...new Map(props.splits.flatMap((s) => s.shares.map((sh) => [sh.artistId, sh.pseudonym] as const))).entries()];
  const [artist, setArtist] = useState<string | null>(null);
  const [percent, setPercent] = useState('');
  const [base, setBase] = useState<Base>('bucket');
  const [funded, setFunded] = useState<Funded>('label_share');
  const [fromArtist, setFromArtist] = useState<string | null>(null);
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const run = useAction(
    async () => {
      const p = await api.participations.create({
        isrc: props.isrc,
        artistId: artist ?? '',
        percent: percent.trim(),
        base,
        fundedFrom: funded,
        fromArtistId: funded === 'artist_share' ? fromArtist : null,
        validFrom,
        validTo: validTo || null,
        documentId: doc?.id ?? null,
      });
      return fmt(r.toast.participationCreated, { from: p.validFrom }) + roundedNote(validFrom, p.validFrom);
    },
    { invalidate: 'all', success: (text) => text },
  );
  const ready = artist !== null && percent.trim() !== '' && validFrom !== '' && (funded !== 'artist_share' || fromArtist !== null);
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={r.createParticipation}
      subtitle={ru.actions.hints.monthRule}
      footer={
        <ActionButton
          name="participation-submit" op="POST /participations"
          isPending={run.isPending}
          isDisabled={!ready}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {r.createParticipation}
        </ActionButton>
      }
    >
      <div className="text-sm">
        ISRC <b>{props.isrc}</b>
      </div>
      <EntityPicker name="participation-artist" label={f.artist} kind="artists" value={artist} onChange={(id) => setArtist(id)} />
      <TextField name="participation-percent" label={f.percent} value={percent} onChange={setPercent} isRequired />
      <SelectField
        name="participation-base"
        label={f.base}
        value={base}
        onChange={(v) => setBase(BASES.find((b) => b === v) ?? base)}
        options={BASES.map((b) => ({ id: b, label: r.bases[b] }))}
      />
      <SelectField
        name="participation-funded"
        label={f.fundedFrom}
        value={funded}
        onChange={(v) => setFunded(FUNDED.find((x) => x === v) ?? funded)}
        options={FUNDED.map((x) => ({ id: x, label: ru.signalsPage.funded[x] }))}
      />
      {funded === 'artist_share' ? (
        <SelectField
          name="participation-from-artist"
          label={f.fromArtist}
          value={fromArtist}
          onChange={setFromArtist}
          options={rowArtists.map(([id, name]) => ({ id, label: name }))}
        />
      ) : null}
      <DateField name="participation-from" label={f.validFrom} value={validFrom} onChange={setValidFrom} isRequired />
      <DateField name="participation-to" label={f.validTo} value={validTo} onChange={setValidTo} />
      <div className="text-sm font-medium">{r.documentOptional}</div>
      <DocumentStep kinds={SPLIT_STEP_KINDS} defaultTitle={`Приложение ${props.isrc}`} ready={doc} onReady={setDoc} />
    </FormDialog>
  );
}

/** «Закрыть участие» (`POST /participations/:id/close`): the end date (exclusive), with the confirmation. */
export function CloseParticipationDialog(props: { part: Participation; onClose: () => void }) {
  const p = props.part;
  const [to, setTo] = useState('');
  const [confirm, setConfirm] = useState(false);
  const run = useAction(
    async () => {
      const closed = await api.participations.close(p.id, { validTo: to });
      return fmt(r.toast.participationClosed, { to: closed.validTo ?? '' }) + roundedNote(to, closed.validTo ?? '');
    },
    { invalidate: 'all', success: (text) => text },
  );
  const what = `${p.pseudonym} ${p.percent} % (${r.bases[p.base]}, ${ru.signalsPage.funded[p.fundedFrom]}) · ${p.isrc} · ${periodText(p.validFrom, p.validTo, r.open)}`;
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={r.closeParticipation}
        subtitle={ru.actions.hints.monthRule}
        footer={
          <ActionButton
            name="close-participation-submit" op="POST /participations/:id/close"
            isPending={run.isPending}
            isDisabled={to === ''}
            reason={ru.actions.hints.fillFields}
            onPress={() => setConfirm(true)}
          >
            {r.closeParticipation}
          </ActionButton>
        }
      >
        <div className="text-sm" data-testid="close-participation-what">
          {what}
        </div>
        <DateField name="participation-close-at" label={f.closeAt} value={to} onChange={setTo} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={r.confirm.closeTitle}
        lines={[...r.confirm.closeLines(what, to)]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
