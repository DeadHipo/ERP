import request from 'supertest';
import type { Express } from 'express';

/** The operator the tests write as (D-140): every API write needs the `X-Operator` header. */
export const TEST_OPERATOR = 'test-operator';

/**
 * `request(app)` whose writes (post, put, patch, delete) carry the default `X-Operator` header; reads are plain.
 * Use it in every test that writes through the API; pass `operator` to write as someone else.
 */
export function writer(app: Express, operator: string = TEST_OPERATOR) {
  const agent = request(app);
  const as = <T extends request.Test>(t: T): T => t.set('X-Operator', encodeURIComponent(operator)) as T;
  return {
    get: (url: string) => agent.get(url),
    post: (url: string) => as(agent.post(url)),
    put: (url: string) => as(agent.put(url)),
    patch: (url: string) => as(agent.patch(url)),
    delete: (url: string) => as(agent.delete(url)),
  };
}
