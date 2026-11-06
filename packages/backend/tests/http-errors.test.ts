import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { newFacade, TMP } from './helpers/fixtures';

// The constant 500 and the malformed body (D-170): an unexpected error answers `internal` with the request id and
// nothing of its text; a body express.json cannot read is `400 validation_error`, and its raw text (a password at the
// login) is neither answered nor logged. Synthetic data only.

describe('HTTP errors (D-170)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a route that throws: 500 internal with the request id, no error text in the answer; the log has the id', async () => {
    const f = await newFacade();
    const app = createApp(
      Object.assign(f, {
        ownerList: () => {
          throw new Error('erp_t_x');
        },
      }),
      { tmpDir: join(TMP, 'http-errors') },
    );
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    const res = await request(app).get('/api/v1/owners');
    expect(res.status).toBe(500);
    const requestId = res.headers['x-request-id'] as string;
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toEqual({ error: { code: 'internal', message: 'Internal error', statusCode: 500, requestId } });
    expect(JSON.stringify(res.body)).not.toContain('erp_t_x');
    expect(logged.join('\n')).toContain(requestId);
    expect(logged.join('\n')).toContain('erp_t_x'); // the log keeps the message and the stack, not the request

    // every answer carries its own id
    const ok = await request(app).get('/api/v1/health').expect(200);
    expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok.headers['x-request-id']).not.toBe(requestId);
  });

  it('a failed query: the log has the request id and the cause code, never the query parameters', async () => {
    const f = await newFacade();
    const app = createApp(f, { tmpDir: join(TMP, 'http-errors') });
    const marker = 'erp_t_param_marker_5d2';
    const logged: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    // PostgreSQL refuses a NUL byte in text: drizzle throws DrizzleQueryError whose message lists the parameters
    const res = await request(app).post('/api/v1/labels').set('X-Operator', 'tests').send({ name: `${marker}\u0000`, kind: 'own' });
    expect(res.status).toBe(500);
    const text = logged.join('\n');
    expect(text).toContain(res.body.error.requestId as string);
    expect(text).toContain('params: <omitted>');
    expect(text).not.toContain(marker);
    expect(JSON.stringify(res.body)).not.toContain(marker);
  });

  it('a label given twice in the query is 400 validation_error', async () => {
    const f = await newFacade();
    const app = createApp(f, { tmpDir: join(TMP, 'http-errors') });
    const res = await request(app).get('/api/v1/owners?label=a&label=b');
    expect([res.status, res.body.error.code]).toEqual([400, 'validation_error']);
  });

  it('POST /auth/login with malformed JSON: 400 validation_error, the password neither answered nor logged', async () => {
    const f = await newFacade();
    const app = createApp(f, { tmpDir: join(TMP, 'http-errors') });
    const marker = 'erp_t_password_marker_7c1';
    const logged: string[] = [];
    const keep = (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
    vi.spyOn(console, 'error').mockImplementation(keep);
    vi.spyOn(console, 'warn').mockImplementation(keep);
    vi.spyOn(console, 'info').mockImplementation(keep);
    vi.spyOn(console, 'log').mockImplementation(keep);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(`{"login":"someone","password":"${marker}"`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'validation_error', statusCode: 400 });
    expect(JSON.stringify(res.body)).not.toContain(marker);
    expect(res.text).not.toContain(marker);
    expect(logged.join('\n')).not.toContain(marker);
  });
});
