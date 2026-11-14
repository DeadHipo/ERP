-- D-216: пометка «MC» у строки сплита. Помеченная строка получает свой процент как обычно, но не несёт вырезы
-- других MC из пула артистов (participations funded_from = 'artist_pool'): вырез делится пропорционально между
-- непомеченными строками того же сплита. По умолчанию false — расчёт без пометок прежний байт в байт.
ALTER TABLE splits.split_shares ADD COLUMN IF NOT EXISTS is_mc boolean NOT NULL DEFAULT false;
