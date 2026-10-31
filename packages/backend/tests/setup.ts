// Test files are written under data/test-tmp in the repo root (git-ignored); each test file gets its own run-* folder, removed after the file.
import { afterAll } from 'vitest';
import { closeTestSources } from './helpers/test-sources';
import { removeTmp } from './helpers/tmp-root';

// The private PostgreSQL and ClickHouse databases of a test file (created lazily) are dropped after it.
afterAll(closeTestSources);
afterAll(removeTmp);
