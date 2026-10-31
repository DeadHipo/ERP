import { createClient, type ClickHouseClient } from '@clickhouse/client';

/** Connection settings of the ClickHouse HTTP client. Names follow the CLICKHOUSE_* variables of .env. */
export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
  /** Maximum parallel HTTP connections (default 10). */
  maxOpenConnections?: number;
  /** One request, for example a large insert, may run this long (default 10 minutes). */
  requestTimeoutMs?: number;
}

export function clickHouseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClickHouseConfig {
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`Environment variable ${name} is required`);
    return v;
  };
  return {
    url: `http://${env.CLICKHOUSE_HOST || 'localhost'}:${env.CLICKHOUSE_HTTP_PORT || '8123'}`,
    username: need('CLICKHOUSE_USERNAME'),
    password: need('CLICKHOUSE_PASSWORD'),
    database: need('CLICKHOUSE_DATABASE'),
    ...(env.CLICKHOUSE_MAX_CONNECTIONS ? { maxOpenConnections: Number(env.CLICKHOUSE_MAX_CONNECTIONS) } : {}),
  };
}

/**
 * ClickHouse client. By default the server writes Decimal and Int64/Int128 into JSON as numbers, and JavaScript
 * rounds them (9007199254740993 becomes 9007199254740992). The two output settings below make them quoted
 * strings, which go to decimal.js or BigInt exactly. Do not remove them.
 */
export function createClickHouse(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    max_open_connections: config.maxOpenConnections ?? 10,
    request_timeout: config.requestTimeoutMs ?? 600_000,
    compression: { request: true, response: true },
    clickhouse_settings: {
      output_format_json_quote_64bit_integers: 1,
      output_format_json_quote_decimals: 1,
      // keeps a long query or insert alive behind proxies; also silences the client's long-timeout warning
      send_progress_in_http_headers: 1,
      http_headers_progress_interval_ms: '110000',
    },
  });
}
