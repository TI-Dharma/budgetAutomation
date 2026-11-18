import { getPgPool } from '../config/database';

export interface PriceRadioRow {
  idDataBase: any;
  cod: string;
  name: string;
  description: string;
  price: number; // preço base em dólar
}

/**
 * Acesso ao PostgreSQL: cotação do dólar e preços base dos produtos.
 */
export class PricingRepository {
  /** SELECT value FROM sys_parameters WHERE key = 'dolar' */
  public async getDollarRate(): Promise<number> {
    const { rows } = await getPgPool().query(
      `SELECT value FROM "sys_parameters" WHERE key = $1 LIMIT 1`,
      ['dolar']
    );

    if (rows.length === 0) {
      throw new Error("Cotação do dólar não encontrada na tabela sys_parameters (key = 'dolar').");
    }

    const rate = Number(String(rows[0].value).replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Cotação do dólar inválida em sys_parameters: "${rows[0].value}".`);
    }
    return rate;
  }

  /** SELECT * FROM "priceRadios" WHERE cod IN (...) — com parâmetros (sem SQL injection) */
  public async getProductsByCodes(codes: string[]): Promise<PriceRadioRow[]> {
    const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
    if (unique.length === 0) return [];

    const { rows } = await getPgPool().query(
      `SELECT * FROM "priceRadios" WHERE cod = ANY($1::text[])`,
      [unique]
    );

    return rows.map((r: any) => ({
      idDataBase: r.idDataBase,
      cod: String(r.cod).trim(),
      name: r.name,
      description: r.description,
      price: Number(r.price || 0),
    }));
  }
}

export const pricingRepository = new PricingRepository();
