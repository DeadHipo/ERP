import { describe, expect, it } from 'vitest';
import { clickHouseDatabaseNames, connectSources } from '../src/connect-sources';
import { createBelieveColumnar } from '../src/modules/sources';
import { TMP } from './helpers/tmp-root';

// N20 (D-140): the ClickHouse database named by CLICKHOUSE_DATABASE reaches the columnar, so an API started on private
// stores reads and writes them.

describe('ClickHouse database names', () => {
  it('default to believe and believe_stage; CLICKHOUSE_DATABASE gives <name> and <name>_stage', () => {
    expect(clickHouseDatabaseNames({})).toEqual({ database: 'believe', stageDatabase: 'believe_stage' });
    expect(clickHouseDatabaseNames({ CLICKHOUSE_DATABASE: 'believe_x' })).toEqual({
      database: 'believe_x',
      stageDatabase: 'believe_x_stage',
    });
    expect(() => clickHouseDatabaseNames({ CLICKHOUSE_DATABASE: 'bad name; DROP' })).toThrow();
  });

  it('connectSources builds its columnar on the named databases', async () => {
    // connectSources loads <repo>/.env without overriding variables that are already set
    const saved = process.env.CLICKHOUSE_DATABASE;
    process.env.CLICKHOUSE_DATABASE = 'believe_x';
    const s = connectSources(TMP);
    try {
      expect(s.clickhouseDatabase).toEqual({ database: 'believe_x', stageDatabase: 'believe_x_stage' });
    } finally {
      if (saved === undefined) delete process.env.CLICKHOUSE_DATABASE;
      else process.env.CLICKHOUSE_DATABASE = saved;
      await s.close();
    }
  });

  it('the columnar queries name the databases it was given', async () => {
    const seen: string[] = [];
    const ch = {
      command: async ({ query }: { query: string }) => void seen.push(query),
    } as unknown as Parameters<typeof createBelieveColumnar>[0];
    const columnar = createBelieveColumnar(ch, { database: 'believe_x', stageDatabase: 'believe_x_stage' });
    await columnar.createStage('11111111-1111-1111-1111-111111111111');
    expect(seen.join('\n')).toContain('believe_x_stage.rows_11111111111111111111111111111111');
    expect(seen.join('\n')).toContain('AS believe_x.rows');
  });
});
