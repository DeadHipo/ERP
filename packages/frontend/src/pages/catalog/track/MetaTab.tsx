import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { trackMetaSchema, trackPlatformSchema } from '@erp/shared/api-responses';
import { TRACK_PLATFORMS, TRACK_PLATFORM_STATUSES, type TrackPlatform } from '@erp/shared/track-platforms';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { trackQueries } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { QueryView } from '../../../components/PageState';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { formatDateTime } from '../../../lib/datetime';
import { formatDuration, parseDuration } from '../../../lib/duration';
import { SimpleTable, Td } from '../components/MoneyTable';

const t = ru.catalog.track.meta;
type Meta = z.output<typeof trackMetaSchema>;
type Platform = z.output<typeof trackPlatformSchema>;

const NONE = 'none';
export const platformName = (p: string | null | undefined) => (p ? (t.platformNames[p as TrackPlatform] ?? p) : t.none);
const platformOptions = TRACK_PLATFORMS.map((p) => ({ id: p, label: t.platformNames[p] }));
const explicitOptions = [
  { id: NONE, label: t.explicitValues.unknown },
  { id: 'yes', label: t.explicitValues.yes },
  { id: 'no', label: t.explicitValues.no },
];
const explicitOf = (v: boolean | null) => (v === null ? NONE : v ? 'yes' : 'no');
const explicitFrom = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/** P6 «Мета» (D-238): the shown values of the recording and what each platform holds. Navigation, not money. */
export function MetaTab({ isrc }: { isrc: string }) {
  const query = useQuery(trackQueries.meta(isrc));
  const [editing, setEditing] = useState(false);
  const [platform, setPlatform] = useState<Platform | 'new' | null>(null);
  const [removing, setRemoving] = useState<Platform | null>(null);
  return (
    <div className="flex flex-col gap-6" data-testid="track-meta">
      <p className="text-xs text-muted">{t.hint}</p>
      <QueryView query={query}>
        {(d) => (
          <>
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium">{t.title}</h2>
                <ActionButton name="edit-meta" op="PATCH /tracks/:isrc/meta" variant="secondary" onPress={() => setEditing(true)}>
                  {t.edit}
                </ActionButton>
              </div>
              {d.meta ? <MetaFacts meta={d.meta} /> : <p className="text-sm text-muted">{t.empty}</p>}
            </section>
            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium">{t.platforms}</h2>
                <ActionButton name="add-platform" op="POST /tracks/:isrc/platforms" variant="secondary" onPress={() => setPlatform('new')}>
                  {t.addPlatform}
                </ActionButton>
              </div>
              {d.platforms.length === 0 ? (
                <p className="text-sm text-muted">{t.noPlatforms}</p>
              ) : (
                <SimpleTable
                  testId="track-platforms"
                  headers={[t.cols.platform, t.cols.link, t.cols.title, t.cols.artists, t.cols.duration, t.cols.status, t.cols.source, t.cols.fetched, t.cols.actions]}
                >
                  {d.platforms.map((p) => (
                    <tr key={p.id} data-testid={`platform-${p.id}`} data-platform={p.platform} data-status={p.status}>
                      <Td col="platform">{platformName(p.platform)}</Td>
                      <Td col="link">
                        {p.url ? (
                          <a className="text-accent hover:underline" href={p.url} target="_blank" rel="noreferrer">
                            {t.open}
                          </a>
                        ) : (
                          t.none
                        )}
                      </Td>
                      <Td col="title">{p.title ?? t.none}</Td>
                      <Td col="artists">{p.artists ?? t.none}</Td>
                      <Td col="duration">{formatDuration(p.durationMs) || t.none}</Td>
                      <Td col="status">{t.statuses[p.status]}</Td>
                      <Td col="source">{p.source}</Td>
                      <Td col="fetched">{p.fetchedAt ? formatDateTime(p.fetchedAt) : t.none}</Td>
                      <Td>
                        <span className="flex gap-2">
                          <ActionButton name={`edit-platform-${p.id}`} op="PATCH /tracks/platforms/:id" variant="secondary" compact onPress={() => setPlatform(p)}>
                            {t.edit}
                          </ActionButton>
                          <ActionButton name={`remove-platform-${p.id}`} op="POST /tracks/platforms/:id/remove" variant="tertiary" compact onPress={() => setRemoving(p)}>
                            {t.removePlatform}
                          </ActionButton>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </SimpleTable>
              )}
            </section>
            {editing ? <MetaDialog isrc={isrc} meta={d.meta} onClose={() => setEditing(false)} /> : null}
            {platform ? <PlatformDialog isrc={isrc} platform={platform === 'new' ? null : platform} onClose={() => setPlatform(null)} /> : null}
            {removing ? <RemovePlatform platform={removing} onClose={() => setRemoving(null)} /> : null}
          </>
        )}
      </QueryView>
    </div>
  );
}

function MetaFacts({ meta }: { meta: Meta }) {
  const fact = (key: string, label: string, value: React.ReactNode) => (
    <div key={key} data-testid={`meta-${key}`} className="flex gap-2">
      <span className="w-56 text-muted">{label}</span>
      <span>{value ?? t.none}</span>
    </div>
  );
  return (
    <div className="flex gap-6">
      {meta.coverUrl ? <img data-testid="meta-cover" src={meta.coverUrl} alt="" className="h-32 w-32 rounded-lg object-cover" /> : null}
      <div className="flex flex-col gap-1 text-sm">
        {fact('title', t.fields.title, meta.title)}
        {fact('version', t.fields.version, meta.version)}
        {fact('artists', t.fields.artists, meta.artists)}
        {fact('duration', t.fields.duration, formatDuration(meta.durationMs) || null)}
        {fact('explicit', t.fields.explicit, meta.explicit === null ? null : meta.explicit ? t.explicitValues.yes : t.explicitValues.no)}
        {fact('releaseDate', t.fields.releaseDate, meta.releaseDate)}
        {fact('primaryPlatform', t.fields.primaryPlatform, meta.primaryPlatform ? platformName(meta.primaryPlatform) : null)}
        <span className="text-xs text-muted">{fmt(t.updated, { at: formatDateTime(meta.updatedAt), by: meta.updatedBy })}</span>
      </div>
    </div>
  );
}

function MetaDialog({ isrc, meta, onClose }: { isrc: string; meta: Meta | null; onClose: () => void }) {
  const [title, setTitle] = useState(meta?.title ?? '');
  const [version, setVersion] = useState(meta?.version ?? '');
  const [artists, setArtists] = useState(meta?.artists ?? '');
  const [duration, setDuration] = useState(formatDuration(meta?.durationMs));
  const [explicit, setExplicit] = useState(explicitOf(meta?.explicit ?? null));
  const [releaseDate, setReleaseDate] = useState(meta?.releaseDate ?? '');
  const [coverUrl, setCoverUrl] = useState(meta?.coverUrl ?? '');
  const [primary, setPrimary] = useState(meta?.primaryPlatform ?? NONE);
  const durationMs = parseDuration(duration);
  const run = useAction(
    () =>
      api.tracks.setMeta(isrc, {
        title: orNull(title),
        version: orNull(version),
        artists: orNull(artists),
        durationMs: durationMs ?? null,
        explicit: explicitFrom(explicit),
        releaseDate: orNull(releaseDate),
        coverUrl: orNull(coverUrl),
        primaryPlatform: primary === NONE ? null : (primary as TrackPlatform),
      }),
    { invalidate: 'reference', success: () => t.saved },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : onClose())}
      title={fmt(t.editTitle, { isrc })}
      footer={
        <ActionButton
          name="meta-submit"
          op="PATCH /tracks/:isrc/meta"
          isPending={run.isPending}
          isDisabled={durationMs === undefined}
          reason={t.durationBad}
          onPress={() => run.mutate(undefined, { onSuccess: onClose })}
        >
          {ru.common.save}
        </ActionButton>
      }
    >
      <TextField name="meta-title" label={t.fields.title} value={title} onChange={setTitle} />
      <TextField name="meta-version" label={t.fields.version} value={version} onChange={setVersion} />
      <TextField name="meta-artists" label={t.fields.artists} value={artists} onChange={setArtists} />
      <TextField name="meta-duration" label={t.fields.duration} value={duration} onChange={setDuration} placeholder="2:34" error={durationMs === undefined ? t.durationBad : undefined} />
      <SelectField name="meta-explicit" label={t.fields.explicit} value={explicit} onChange={setExplicit} options={explicitOptions} />
      <TextField name="meta-release-date" label={t.fields.releaseDate} type="date" value={releaseDate} onChange={setReleaseDate} />
      <TextField name="meta-cover-url" label={t.fields.coverUrl} value={coverUrl} onChange={setCoverUrl} placeholder="https://…" />
      <SelectField name="meta-primary-platform" label={t.fields.primaryPlatform} value={primary} onChange={setPrimary} options={[{ id: NONE, label: t.none }, ...platformOptions]} />
    </FormDialog>
  );
}

function PlatformDialog({ isrc, platform, onClose }: { isrc: string; platform: Platform | null; onClose: () => void }) {
  const [name, setName] = useState(platform?.platform ?? 'spotify');
  const [platformId, setPlatformId] = useState(platform?.platformId ?? '');
  const [url, setUrl] = useState(platform?.url ?? '');
  const [albumUrl, setAlbumUrl] = useState(platform?.albumUrl ?? '');
  const [title, setTitle] = useState(platform?.title ?? '');
  const [artists, setArtists] = useState(platform?.artists ?? '');
  const [duration, setDuration] = useState(formatDuration(platform?.durationMs));
  const [coverUrl, setCoverUrl] = useState(platform?.coverUrl ?? '');
  const [status, setStatus] = useState<string>(platform?.status ?? 'found');
  const durationMs = parseDuration(duration);
  const body = {
    platform: name as TrackPlatform,
    platformId: orNull(platformId),
    url: orNull(url),
    albumUrl: orNull(albumUrl),
    title: orNull(title),
    artists: orNull(artists),
    durationMs: durationMs ?? null,
    coverUrl: orNull(coverUrl),
    status: status as (typeof TRACK_PLATFORM_STATUSES)[number],
  };
  const run = useAction(() => (platform ? api.tracks.updatePlatform(platform.id, body) : api.tracks.addPlatform(isrc, body)), {
    invalidate: 'reference',
    success: () => (platform ? t.platformSaved : t.platformAdded),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : onClose())}
      title={t.platformTitle}
      footer={
        <ActionButton
          name="platform-submit"
          op={platform ? 'PATCH /tracks/platforms/:id' : 'POST /tracks/:isrc/platforms'}
          isPending={run.isPending}
          isDisabled={durationMs === undefined}
          reason={t.durationBad}
          onPress={() => run.mutate(undefined, { onSuccess: onClose })}
        >
          {ru.common.save}
        </ActionButton>
      }
    >
      <SelectField name="platform-platform" label={t.platformFields.platform} value={name} onChange={setName} options={platformOptions} />
      <TextField name="platform-id" label={t.platformFields.platformId} value={platformId} onChange={setPlatformId} />
      <TextField name="platform-url" label={t.platformFields.url} value={url} onChange={setUrl} placeholder="https://…" />
      <TextField name="platform-album-url" label={t.platformFields.albumUrl} value={albumUrl} onChange={setAlbumUrl} placeholder="https://…" />
      <TextField name="platform-title" label={t.fields.title} value={title} onChange={setTitle} />
      <TextField name="platform-artists" label={t.fields.artists} value={artists} onChange={setArtists} />
      <TextField name="platform-duration" label={t.fields.duration} value={duration} onChange={setDuration} placeholder="2:34" error={durationMs === undefined ? t.durationBad : undefined} />
      <TextField name="platform-cover-url" label={t.fields.coverUrl} value={coverUrl} onChange={setCoverUrl} placeholder="https://…" />
      <SelectField
        name="platform-status"
        label={t.platformFields.status}
        value={status}
        onChange={setStatus}
        options={TRACK_PLATFORM_STATUSES.map((s) => ({ id: s, label: t.statuses[s] }))}
      />
    </FormDialog>
  );
}

function RemovePlatform({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const run = useAction(() => api.tracks.removePlatform(platform.id), { invalidate: 'reference', success: () => t.platformRemoved });
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(o) => (o ? null : onClose())}
      title={t.removeTitle}
      lines={[fmt(t.removeLine, { platform: platformName(platform.platform), title: platform.title ?? platform.url ?? platform.platformId ?? '' })]}
      confirmLabel={t.removePlatform}
      isPending={run.isPending}
      onConfirm={() => run.mutate(undefined, { onSettled: onClose })}
    />
  );
}
