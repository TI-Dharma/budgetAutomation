import { Pool } from 'pg';
import { quotePricingEnv } from './quote-pricing.env';

let pool: Pool | null = null;

/**
 * Pool de conexões do PostgreSQL, criado sob demanda na primeira consulta.
 */
export function getPgPool(): Pool {
  if (!pool) {
    pool = new Pool({
      ...quotePricingEnv.pg,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Erro inesperado no pool de conexões:', err.message);
    });
  }
  return pool;
}
