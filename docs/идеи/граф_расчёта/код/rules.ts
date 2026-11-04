// Правила как размеченное объединение: у каждого вида участия свои обязательные поля.
// Граница с модулем: participationsAt отдаёт общий тип, здесь он сужается и проверяется один раз.
import type { Decimal } from '../../../../packages/backend/src/shared/money';
import type { LayerContext, MasterUnit } from './types';
import { reportDate } from './state';

interface Common { id: string; artistId: string; percent: Decimal; documentId: string | null }
export type Participation =
  | (Common & { fundedFrom: 'top'; base: 'net'; fromArtistId: null })
  | (Common & { fundedFrom: 'artist_pool'; base: 'net'; fromArtistId: null })
  | (Common & { fundedFrom: 'artist_share'; base: 'bucket'; fromArtistId: string })
  | (Common & { fundedFrom: 'label_share'; base: 'net' | 'bucket'; fromArtistId: null });
export type Funded = Participation['fundedFrom'];
export type RuleOf<K extends Funded> = Extract<Participation, { fundedFrom: K }>;

/** Участия вида K, действующие на дату юнита, с нулевыми процентами отброшенными. Неверная форма — ошибка данных. */
export function rulesOf<K extends Funded>(ctx: LayerContext, unit: MasterUnit, kind: K): RuleOf<K>[] {
  return ctx.participationsAt(unit.isrc, reportDate(unit))
    .filter((p) => p.fundedFrom === kind && !p.percent.isZero())
    .map((p) => {
      const ok =
        (kind === 'artist_share' && p.base === 'bucket' && p.fromArtistId !== null) ||
        (kind !== 'artist_share' && p.fromArtistId === null && (kind === 'label_share' || p.base === 'net'));
      if (!ok) throw new Error(`участие ${p.id}: форма не соответствует виду ${kind}`);
      return p as unknown as RuleOf<K>;
    });
}
