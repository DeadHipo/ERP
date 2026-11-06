import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { createPostgres, postgresConfigFromEnv } from '../src/shared/postgres';
import { postgresMigrations } from '../src/shared/private-stores';
import { postgresUp } from './helpers/stack';

describe.runIf(postgresUp)('postgres wrapper', () => {
  const pgdb = createPostgres(postgresConfigFromEnv());
  afterAll(() => pgdb.close());

  it('reads a date as text, not as a Date', async () => {
    const { rows } = await pgdb.pool.query("SELECT DATE '2026-07-01' AS d");
    expect(rows[0].d).toBe('2026-07-01');
  });

  it('reads timestamptz as ISO UTC text', async () => {
    const { rows } = await pgdb.pool.query("SELECT TIMESTAMPTZ '2026-07-01 12:00:00+03' AS t");
    expect(rows[0].t).toBe('2026-07-01T09:00:00.000Z');
  });

  it('keeps numeric and bigint exact, as text', async () => {
    const { rows } = await pgdb.pool.query(
      'SELECT 0.006989549999::numeric(38,12) AS n, 9007199254740993::bigint AS b, sum(x)::numeric AS s FROM (VALUES (0.1::numeric), (0.2::numeric)) v(x)',
    );
    expect(rows[0]).toEqual({ n: '0.006989549999', b: '9007199254740993', s: '0.3' });
  });

  it('works through drizzle', async () => {
    const res = await pgdb.db.execute(sql`SELECT 1 AS one`);
    expect(res.rows[0]).toEqual({ one: 1 });
  });

  it('has the migrated registry table', async () => {
    const { rows } = await pgdb.pool.query("SELECT to_regclass('source_files') IS NOT NULL AS ok");
    expect(rows[0].ok).toBe(true);
  });
});

// 0016 (D-170): idempotent; a database with data and no organization gets organization №1 with its fixed id and every
// row stamped; an empty database gets no organization (the first is created by POST /orgs).
describe.runIf(postgresUp)('migration 0016_organizations', () => {
  const FIRST = '00000000-0000-4000-8000-000000000001';
  const config = postgresConfigFromEnv();
  const admin = createPostgres({ ...config, max: 1 });
  afterAll(() => admin.close());

  /** A private database with the migrations up to `upTo` applied. */
  async function database(upTo: number) {
    const name = `erp_t_m16_${randomBytes(4).toString('hex')}`;
    await admin.pool.query(`CREATE DATABASE ${name}`);
    const pg = createPostgres({ ...config, database: name, max: 1 });
    for (const m of postgresMigrations()) if (m.version <= upTo) await pg.pool.query(m.text);
    return {
      pg,
      async drop() {
        await pg.close();
        await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      },
    };
  }
  const m16 = () => postgresMigrations().find((m) => m.version === 16)?.text as string;

  it('on an empty database: no organization, org_id NOT NULL everywhere; a second run changes nothing', async () => {
    const d = await database(15);
    try {
      await d.pg.pool.query(m16());
      await d.pg.pool.query(m16());
      expect((await d.pg.pool.query('SELECT count(*)::int AS n FROM orgs.organizations')).rows[0].n).toBe(0);
      const nullable = await d.pg.pool.query(
        `SELECT table_schema, table_name FROM information_schema.columns WHERE column_name = 'org_id' AND is_nullable = 'YES'
           AND table_schema <> 'auth'`,
      );
      expect(nullable.rows).toEqual([]);
    } finally {
      await d.drop();
    }
  });

  it('on a database with data: organization №1 with the fixed id, every row stamped, the keys per organization', async () => {
    const d = await database(15);
    try {
      const q = (text: string) => d.pg.pool.query(text);
      await q(`INSERT INTO owners.owners (id, name, name_norm, kind, origin) VALUES ('o1', 'Owner M', 'owner m', 'person', 'manual')`);
      await q(`INSERT INTO labels.labels (id, name, kind) VALUES ('l1', 'Label M', 'own')`);
      await q(`INSERT INTO publishing.pub_writers (writer_norm, display_name, resolution) VALUES ('w m', 'W M', 'unmapped')`);
      await q(
        `INSERT INTO source_files (source, account, reporting_month, file_name, stored_path, sha256)
         VALUES ('believe', '1', '2026-07-01', 'f.csv', '/x', '${'a'.repeat(64)}')`,
      );
      await q(m16());
      await q(m16());
      const orgs = (await q('SELECT id, name, created_by FROM orgs.organizations')).rows;
      expect(orgs).toEqual([{ id: FIRST, name: 'Организация №1', created_by: 'migration 0016' }]);
      for (const t of ['owners.owners', 'labels.labels', 'publishing.pub_writers', 'public.source_files'])
        expect((await q(`SELECT array_agg(DISTINCT org_id) AS o FROM ${t}`)).rows[0].o, t).toEqual([FIRST]);
      // the same writer and label name in a second organization do not conflict
      await q(`INSERT INTO orgs.organizations (id, name, created_by) VALUES ('${'b'.repeat(8)}-0000-4000-8000-000000000002', 'B', 't')`);
      await q(`INSERT INTO publishing.pub_writers (org_id, writer_norm, display_name, resolution)
               VALUES ('${'b'.repeat(8)}-0000-4000-8000-000000000002', 'w m', 'W M', 'unmapped')`);
      await q(`INSERT INTO labels.labels (org_id, id, name, kind)
               VALUES ('${'b'.repeat(8)}-0000-4000-8000-000000000002', 'l2', 'Label M', 'own')`);
      // within one organization the keys still hold
      await expect(q(`INSERT INTO labels.labels (org_id, id, name, kind) VALUES ('${FIRST}', 'l3', 'Label M', 'own')`)).rejects.toThrow(
        /labels_org_name/,
      );
    } finally {
      await d.drop();
    }
  });
  // 0017 (D-171): idempotent; the users of stage 2 become org_admin members of their organization, the column goes.
  const m17 = () => postgresMigrations().find((m) => m.version === 17)?.text as string;

  it('0017 on a stage-2 base: users.org_id moves into memberships (org_admin), the column goes; a second run changes nothing', async () => {
    const d = await database(16);
    try {
      const q = (text: string, values?: unknown[]) => d.pg.pool.query(text, values);
      await q(`INSERT INTO orgs.organizations (id, name, created_by) VALUES ('${FIRST}', 'Org M', 't')`);
      await q("INSERT INTO auth.users (id, login, password_hash, org_id, created_by) VALUES ('u1', 'user-one', 'x', $1, 't')", [FIRST]);
      await q("INSERT INTO auth.users (id, login, password_hash, is_system_admin, created_by) VALUES ('u2', 'sys-one', 'x', true, 't')");
      await q(m17());
      await q(m17());
      const members = (await q('SELECT user_id, org_id, role, created_by, disabled_at FROM auth.memberships')).rows;
      expect(members).toEqual([{ user_id: 'u1', org_id: FIRST, role: 'org_admin', created_by: 'migration 0017', disabled_at: null }]);
      const column = await q("SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'org_id'");
      expect(column.rows).toEqual([]);
      const index = await q("SELECT to_regclass('auth.users_org') AS i");
      expect(index.rows[0].i).toBeNull();
      for (const t of ['auth.memberships', 'auth.user_labels', 'auth.sessions', 'auth.support_grants'])
        expect((await q(`SELECT to_regclass('${t}') IS NOT NULL AS ok`)).rows[0].ok, t).toBe(true);
      await expect(q("INSERT INTO auth.memberships (user_id, org_id, role, created_by) VALUES ('u2', 'o', 'owner', 't')")).rejects.toThrow(/memberships_role/);
      await expect(q("INSERT INTO auth.user_labels (user_id, org_id, label_id, created_by) VALUES ('u2', 'o', 'l', 't')")).rejects.toThrow(/foreign key/);
    } finally {
      await d.drop();
    }
  });

  it('0017 on an empty base: no membership, twice', async () => {
    const d = await database(16);
    try {
      await d.pg.pool.query(m17());
      await d.pg.pool.query(m17());
      expect((await d.pg.pool.query('SELECT count(*)::int AS n FROM auth.memberships')).rows[0].n).toBe(0);
    } finally {
      await d.drop();
    }
  });
});
