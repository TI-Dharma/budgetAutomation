import axios, { AxiosInstance } from 'axios';
import { quotePricingEnv } from '../config/quote-pricing.env';

export interface BitrixProductRow {
  id?: number;
  productId: number;
  productName: string;
  price: number;
  quantity: number;
  [key: string]: any;
}

export interface BitrixProductRowInput {
  productId: number;
  productName: string;
  price: number;
  quantity: number;
}

/**
 * Chamadas à API REST do Bitrix24 (webhook de entrada) relacionadas a Orçamentos, Negócios, Empresas e Contatos.
 */
export class BitrixQuoteService {
  private get api(): AxiosInstance {
    return axios.create({
      baseURL: quotePricingEnv.bitrixWebhookUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async call<T = any>(method: string, body: Record<string, any>): Promise<T> {
    try {
      const { data } = await this.api.post(`${method}.json`, body);
      if (data?.error) {
        throw new Error(`Bitrix24 ${method}: ${data.error} - ${data.error_description || ''}`);
      }
      return data as T;
    } catch (error: any) {
      const resp = error?.response?.data;
      if (resp?.error) {
        throw new Error(`Bitrix24 ${method} (HTTP ${error.response.status}): ${resp.error} - ${resp.error_description || ''}`);
      }
      throw error;
    }
  }

  /** crm.quote.get — dados do orçamento (COMPANY_ID, CONTACT_ID, DEAL_ID, campos UF_CRM_*) */
  public async getQuote(quoteId: number): Promise<Record<string, any>> {
    const data: any = await this.call('crm.quote.get', { id: quoteId });
    if (!data?.result) throw new Error(`Orçamento ${quoteId} não encontrado no Bitrix24.`);
    return data.result;
  }

  /** crm.quote.list — orçamento mais recente vinculado a um negócio (card) */
  public async findLatestQuoteIdByDeal(dealId: number): Promise<number | null> {
    const data: any = await this.call('crm.quote.list', {
      filter: { DEAL_ID: dealId },
      order: { ID: 'DESC' },
      select: ['ID'],
    });
    const first = data?.result?.[0];
    return first ? Number(first.ID) : null;
  }

  /** crm.deal.get — dados completos de um card de negócio */
  public async getDeal(dealId: number): Promise<Record<string, any> | null> {
    try {
      const data: any = await this.call('crm.deal.get', { id: dealId });
      return data?.result ?? null;
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Não foi possível ler o negócio ${dealId}: ${err.message}`);
      return null;
    }
  }

  /** crm.deal.list — busca cards de negócio usando filtros específicos (QUOTE_ID, COMPANY_ID, CNPJ, etc.) */
  public async findDeals(
    filter: Record<string, any>,
    select: string[] = ['ID', 'TITLE', 'COMPANY_ID', 'CONTACT_ID', 'QUOTE_ID', 'ASSIGNED_BY_ID', 'UF_*']
  ): Promise<Record<string, any>[]> {
    const data: any = await this.call('crm.deal.list', {
      filter,
      order: { ID: 'DESC' },
      select,
    });
    return Array.isArray(data?.result) ? data.result : [];
  }

  /** crm.company.get — dados da empresa (campos UF_CRM_*) */
  public async getCompany(companyId: number): Promise<Record<string, any>> {
    const data: any = await this.call('crm.company.get', { id: companyId });
    return data?.result ?? {};
  }

  /** crm.requisite.list — requisitos (CNPJ em RQ_INN) de uma empresa */
  public async listCompanyRequisites(companyId: number): Promise<any[]> {
    const data: any = await this.call('crm.requisite.list', {
      filter: { ENTITY_TYPE_ID: 4, ENTITY_ID: companyId },
      select: ['ID', 'RQ_INN', 'RQ_COMPANY_NAME'],
    });
    return data?.result ?? [];
  }

  /** crm.contact.get — contato vinculado */
  public async getContact(contactId: number): Promise<Record<string, any> | null> {
    try {
      const data: any = await this.call('crm.contact.get', { id: contactId });
      return data?.result ?? null;
    } catch {
      return null;
    }
  }

  /** user.get — dados do responsável no Bitrix (para tentar vincular vendedor SA3) */
  public async getUser(userId: number): Promise<Record<string, any> | null> {
    try {
      const data: any = await this.call('user.get', { ID: userId });
      return Array.isArray(data?.result) && data.result.length > 0 ? data.result[0] : null;
    } catch {
      return null;
    }
  }

  /** crm.item.productrow.list — lista os produtos de um orçamento ("Q") ou negócio ("D") */
  public async listProductRows(ownerId: number, ownerType: 'Q' | 'D' = 'Q'): Promise<BitrixProductRow[]> {
    const rows: BitrixProductRow[] = [];
    let start: number | undefined = 0;

    while (start !== undefined) {
      const data: any = await this.call('crm.item.productrow.list', {
        filter: { '=ownerType': ownerType, '=ownerId': ownerId },
        start,
      });
      rows.push(...(data?.result?.productRows ?? []));
      start = typeof data?.next === 'number' ? data.next : undefined;
    }

    return rows;
  }

  /** Alias mantido para compatibilidade */
  public async listQuoteProductRows(quoteId: number): Promise<BitrixProductRow[]> {
    return this.listProductRows(quoteId, 'Q');
  }

  /** crm.item.productrow.set — substitui TODAS as linhas de produto do orçamento */
  public async setQuoteProductRows(quoteId: number, productRows: BitrixProductRowInput[]) {
    return this.call('crm.item.productrow.set', {
      ownerType: 'Q',
      ownerId: quoteId,
      productRows,
    });
  }

  /** crm.quote.update — move o orçamento de etapa */
  public async updateQuoteStatus(quoteId: number, statusId: string) {
    return this.call('crm.quote.update', {
      id: quoteId,
      fields: { STATUS_ID: statusId },
    });
  }
}

export const bitrixQuoteService = new BitrixQuoteService();
