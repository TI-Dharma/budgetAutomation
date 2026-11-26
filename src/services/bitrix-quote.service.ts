import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

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
  discountTypeId?: number;
  discountRate?: number;
  discountSum?: number;
  taxRate?: number;
  taxIncluded?: 'Y' | 'N';
  xmlId?: string;
}

export interface BitrixQuoteStatusInfo {
  STATUS_ID: string;
  NAME: string;
  SORT?: string;
  SEMANTICS?: string | null;
}

export interface BitrixProductFiscalUpdateInput {
  productCode: string;
  rowProductId?: number;
  ncm: string;
  cst: string;
  icmsFormatted: string;
  stUnitFormatted: string;
  unitPriceFormatted?: string;
}

export interface BitrixProductFiscalUpdateResult {
  productCode: string;
  crmProductId: number | null;
  updated: boolean;
  fieldsWritten?: Record<string, string>;
  error?: string;
}

/**
 * Chamadas à API REST do Bitrix24 relacionadas a Orçamentos (Quotes), Negócios (Deals),
 * Empresas, Contatos, Status do Pipeline e Comentários/Timeline.
 */
export class BitrixQuoteService {
  private cachedQuoteStatuses: { expiresAt: number; items: BitrixQuoteStatusInfo[] } | null = null;
  private cachedVatRates: Set<number> | null = null;

  private get api(): AxiosInstance {
    return axios.create({
      baseURL: env.BITRIX_WEBHOOK_URL,
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
      if (resp?.error || resp?.error_description) {
        throw new Error(
          `Bitrix24 ${method} (HTTP ${error.response.status}): ${resp.error || 'ERROR'} - ${resp.error_description || ''}`
        );
      }
      throw new Error(
        `Bitrix24 ${method} (HTTP ${error?.response?.status ?? 'ERR'}): ${
          typeof resp === 'string' && resp ? resp.slice(0, 200) : error.message
        }`
      );
    }
  }

  /** crm.status.list — lista as etapas (colunas) do pipeline de Orçamentos (QUOTE_STATUS) */
  public async listQuoteStatuses(forceRefresh = false): Promise<BitrixQuoteStatusInfo[]> {
    if (!forceRefresh && this.cachedQuoteStatuses && this.cachedQuoteStatuses.expiresAt > Date.now()) {
      return this.cachedQuoteStatuses.items;
    }

    try {
      const data: any = await this.call('crm.status.list', {
        filter: { ENTITY_ID: 'QUOTE_STATUS' },
      });
      const items: BitrixQuoteStatusInfo[] = Array.isArray(data?.result) ? data.result : [];
      this.cachedQuoteStatuses = {
        expiresAt: Date.now() + 5 * 60 * 1000,
        items,
      };
      return items;
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Aviso ao consultar crm.status.list: ${err.message}`);
      return [];
    }
  }

  /**
   * Identifica o STATUS_ID da etapa "Preço Atualizado" no pipeline de Orçamentos do Bitrix24.
   * Prioriza a coluna com nome "Preço Atualizado" ou o ID configurado em BITRIX_QUOTE_PRICE_UPDATED_STATUS (UC_1KJDXH).
   */
  public async resolvePriceUpdatedStatusId(): Promise<{ statusId: string; statusName: string }> {
    const statuses = await this.listQuoteStatuses();
    const configured = env.BITRIX_QUOTE_PRICE_UPDATED_STATUS;

    const byConfiguredId = statuses.find((s) => s.STATUS_ID === configured);
    if (byConfiguredId) {
      return { statusId: byConfiguredId.STATUS_ID, statusName: byConfiguredId.NAME };
    }

    const byName = statuses.find((s) => /pre[cç]o\s+atualizado/i.test(String(s.NAME || '')));
    if (byName) {
      return { statusId: byName.STATUS_ID, statusName: byName.NAME };
    }

    return { statusId: configured || 'UC_1KJDXH', statusName: 'Preço Atualizado' };
  }

  /**
   * Identifica o STATUS_ID da etapa/aba "Erro" no pipeline de Orçamentos do Bitrix24.
   * 1) Procura uma coluna cujo nome contenha "Erro" ou "Falha" no QUOTE_STATUS.
   * 2) Caso contrário, utiliza a coluna configurada em BITRIX_QUOTE_ERROR_STATUS (padrão APOLOGY = "Analisar recusa").
   */
  public async resolveErrorStatusId(): Promise<{ statusId: string; statusName: string }> {
    const statuses = await this.listQuoteStatuses();
    const configured = env.BITRIX_QUOTE_ERROR_STATUS;

    // 1. Se existir uma coluna explicitamente chamada "Erro" ou "Falha" no pipeline de orçamentos, prioriza ela
    const byErrorName = statuses.find((s) => /\b(erro|falha)\b/i.test(String(s.NAME || '')));
    if (byErrorName) {
      return { statusId: byErrorName.STATUS_ID, statusName: byErrorName.NAME };
    }

    // 2. Procura pelo STATUS_ID configurado no .env (ex: APOLOGY = "Analisar recusa")
    const byConfiguredId = statuses.find((s) => s.STATUS_ID === configured);
    if (byConfiguredId) {
      return { statusId: byConfiguredId.STATUS_ID, statusName: byConfiguredId.NAME };
    }

    // 3. Fallback para coluna com semântica de falha (SEMANTICS === 'F')
    const byFailureSemantics = statuses.find((s) => s.SEMANTICS === 'F');
    if (byFailureSemantics) {
      return { statusId: byFailureSemantics.STATUS_ID, statusName: byFailureSemantics.NAME };
    }

    return { statusId: configured || 'APOLOGY', statusName: 'Erro / Analisar recusa' };
  }

  /** crm.quote.get — dados do orçamento */
  public async getQuote(quoteId: number): Promise<Record<string, any>> {
    const data: any = await this.call('crm.quote.get', { id: quoteId });
    if (!data?.result) throw new Error(`Orçamento ${quoteId} não encontrado no Bitrix24.`);
    return data.result;
  }

  /** crm.quote.list — orçamento mais recente vinculado a um card de negócio */
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

  /** crm.deal.list — busca cards de negócio usando filtros específicos */
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

  /** crm.company.get — dados da empresa */
  public async getCompany(companyId: number): Promise<Record<string, any> | null> {
    try {
      const data: any = await this.call('crm.company.get', { id: companyId });
      return data?.result ?? null;
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Aviso ao ler empresa ${companyId}: ${err.message}`);
      return null;
    }
  }

  /** crm.requisite.list — requisitos (CNPJ em RQ_INN) de uma empresa */
  public async listCompanyRequisites(companyId: number): Promise<any[]> {
    try {
      const data: any = await this.call('crm.requisite.list', {
        filter: { ENTITY_TYPE_ID: 4, ENTITY_ID: companyId },
        select: ['ID', 'RQ_INN', 'RQ_COMPANY_NAME'],
      });
      return Array.isArray(data?.result) ? data.result : [];
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Aviso ao ler requisitos da empresa ${companyId}: ${err.message}`);
      return [];
    }
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

  /** user.get — dados do responsável no Bitrix (para vincular vendedor SA3 por e-mail) */
  public async getUser(userId: number): Promise<Record<string, any> | null> {
    try {
      const data: any = await this.call('user.get', { ID: userId });
      return Array.isArray(data?.result) && data.result.length > 0 ? data.result[0] : null;
    } catch {
      return null;
    }
  }

  /** crm.item.productrow.list — lista os produtos de um orçamento ("Q") ou negócio ("D") com fallback para crm.quote/deal.productrows.get */
  public async listProductRows(ownerId: number, ownerType: 'Q' | 'D' = 'Q'): Promise<BitrixProductRow[]> {
    try {
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
    } catch (err: any) {
      // Fallback para métodos clássicos crm.quote.productrows.get / crm.deal.productrows.get
      try {
        const legacyMethod = ownerType === 'Q' ? 'crm.quote.productrows.get' : 'crm.deal.productrows.get';
        const data: any = await this.call(legacyMethod, { id: ownerId });
        const rawList: any[] = Array.isArray(data?.result) ? data.result : [];
        return rawList.map((r) => ({
          id: r.ID ? Number(r.ID) : undefined,
          productId: Number(r.PRODUCT_ID ?? r.productId ?? 0),
          productName: String(r.PRODUCT_NAME ?? r.productName ?? ''),
          price: Number(r.PRICE ?? r.price ?? 0),
          quantity: Number(r.QUANTITY ?? r.quantity ?? 1),
        }));
      } catch {
        console.warn(`[BitrixQuoteService] Aviso ao listar produtos (${ownerType} ${ownerId}): ${err.message}`);
        return [];
      }
    }
  }

  /**
   * Garante que a alíquota equivalente de ST exista cadastrada em crm.vat no Bitrix24
   * para que o Bitrix aceite o taxRate na linha do produto e some o ST no campo Imposto (TAX_VALUE) e Total (OPPORTUNITY).
   */
  public async ensureVatRate(rate: number): Promise<number> {
    const cleanRate = Math.round((Number(rate || 0) + Number.EPSILON) * 100) / 100;
    if (cleanRate < 0) return 0;

    if (!this.cachedVatRates) {
      this.cachedVatRates = new Set<number>();
      try {
        const data: any = await this.call('crm.vat.list', {});
        const list: any[] = Array.isArray(data?.result) ? data.result : [];
        for (const v of list) {
          const r = Math.round((Number(v?.RATE ?? 0) + Number.EPSILON) * 100) / 100;
          this.cachedVatRates.add(r);
        }
      } catch (err: any) {
        console.warn(`[BitrixQuoteService] Aviso ao listar crm.vat.list: ${err.message}`);
      }
    }

    if (this.cachedVatRates.has(cleanRate)) {
      return cleanRate;
    }

    try {
      await this.call('crm.vat.add', {
        fields: {
          NAME: `ST ${cleanRate}%`,
          RATE: cleanRate,
          ACTIVE: 'Y',
        },
      });
      this.cachedVatRates.add(cleanRate);
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Aviso ao criar taxa ST ${cleanRate}% em crm.vat.add: ${err.message}`);
    }

    return cleanRate;
  }

  /** crm.item.productrow.set — atualiza as linhas de produto do orçamento com os preços e ST calculados pelo Protheus */
  public async setQuoteProductRows(quoteId: number, productRows: BitrixProductRowInput[]) {
    return this.call('crm.item.productrow.set', {
      ownerType: 'Q',
      ownerId: quoteId,
      productRows,
    });
  }

  /**
   * Descobre o código do produto no Protheus (PROPERTY_108 / prefixo do NAME no catálogo)
   * quando o nome da linha no orçamento já foi limpo (sem o prefixo "<CODIGO> - ").
   */
  public async resolveProductCodeByDescription(cleanDescription: string): Promise<string | null> {
    const desc = String(cleanDescription || '').trim();
    if (!desc) return null;

    try {
      const byName: any = await this.call('crm.product.list', {
        filter: { '%NAME': desc },
        select: ['ID', 'NAME', env.BITRIX_PRODUCT_CODE_PROP],
      });
      const list: any[] = Array.isArray(byName?.result) ? byName.result : [];
      for (const prod of list) {
        const propVal = prod?.[env.BITRIX_PRODUCT_CODE_PROP];
        const codeFromProp =
          typeof propVal === 'object' && propVal !== null
            ? String(propVal.value ?? propVal.VALUE ?? '').trim()
            : String(propVal ?? '').trim();
        if (codeFromProp) {
          return codeFromProp;
        }
        const catalogName = String(prod?.NAME || '').trim();
        const m = catalogName.match(/^([A-Z0-9._/-]+)\s*[-–—]\s+/i);
        if (m) {
          return m[1].trim();
        }
      }
    } catch {
      // Ignora erro de busca
    }
    return null;
  }

  /**
   * Localiza o ID do produto pai no catálogo do Bitrix24 (crm.product) a partir do código do Protheus (PROPERTY_108 / NAME)
   */
  public async findCrmProductIdByCode(productCode: string, rowProductId?: number): Promise<number | null> {
    const cleanCode = String(productCode || '').trim();
    if (!cleanCode) return rowProductId && rowProductId > 0 ? rowProductId : null;

    // 1. Busca pela propriedade customizada "Cod" (PROPERTY_108)
    try {
      const byProp: any = await this.call('crm.product.list', {
        filter: { [env.BITRIX_PRODUCT_CODE_PROP]: cleanCode },
        select: ['ID', 'NAME', env.BITRIX_PRODUCT_CODE_PROP],
      });
      const list: any[] = Array.isArray(byProp?.result) ? byProp.result : [];
      if (list.length > 0 && Number(list[0].ID) > 0) {
        return Number(list[0].ID);
      }
    } catch {
      // Continua para fallback por NAME
    }

    // 2. Fallback: busca por %NAME iniciando com o código do produto
    try {
      const byName: any = await this.call('crm.product.list', {
        filter: { '%NAME': cleanCode },
        select: ['ID', 'NAME'],
      });
      const list: any[] = Array.isArray(byName?.result) ? byName.result : [];
      const exactPrefix = list.find((p) =>
        String(p?.NAME || '')
          .trim()
          .toUpperCase()
          .startsWith(cleanCode.toUpperCase())
      );
      if (exactPrefix && Number(exactPrefix.ID) > 0) {
        return Number(exactPrefix.ID);
      }
      if (list.length > 0 && Number(list[0].ID) > 0) {
        return Number(list[0].ID);
      }
    } catch {
      // Continua para fallback
    }

    return rowProductId && rowProductId > 0 ? rowProductId : null;
  }

  /**
   * Atualiza os campos fiscais customizados (NCM, CST, ICMS, Valor Uni ST) no cadastro do produto no Bitrix24 (crm.product.update)
   */
  public async updateCatalogProductsFiscalData(
    items: BitrixProductFiscalUpdateInput[]
  ): Promise<BitrixProductFiscalUpdateResult[]> {
    const results: BitrixProductFiscalUpdateResult[] = [];
    const seenCodes = new Set<string>();

    for (const item of items) {
      const code = String(item.productCode || '').trim();
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);

      const crmProductId = await this.findCrmProductIdByCode(code, item.rowProductId);
      if (!crmProductId) {
        results.push({
          productCode: code,
          crmProductId: null,
          updated: false,
          error: `Produto "${code}" não localizado em crm.product no Bitrix24.`,
        });
        continue;
      }

      const fieldsToWrite: Record<string, string> = {
        [env.BITRIX_PRODUCT_NCM_PROP]: item.ncm || '',
        [env.BITRIX_PRODUCT_CST_PROP]: item.cst || '',
        [env.BITRIX_PRODUCT_ICMS_PROP]: item.icmsFormatted || '0%',
        [env.BITRIX_PRODUCT_ST_UNIT_PROP]: String(item.stUnitFormatted || '0,00').trim().replace('.', ','),
      };
      if (env.BITRIX_PRODUCT_UNIT_PRICE_PROP && item.unitPriceFormatted) {
        fieldsToWrite[env.BITRIX_PRODUCT_UNIT_PRICE_PROP] = String(item.unitPriceFormatted)
          .trim()
          .replace('.', ',');
      }

      try {
        await this.call('crm.product.update', {
          id: crmProductId,
          fields: fieldsToWrite,
        });
        results.push({
          productCode: code,
          crmProductId,
          updated: true,
          fieldsWritten: fieldsToWrite,
        });
      } catch (err: any) {
        console.warn(`[BitrixQuoteService] Aviso ao atualizar produto ${code} (ID ${crmProductId}): ${err.message}`);
        results.push({
          productCode: code,
          crmProductId,
          updated: false,
          error: err.message,
        });
      }
    }

    return results;
  }

  /** crm.quote.update — atualiza campos do orçamento (ex: STATUS_ID, COMMENTS, UF_CRM_*) */
  public async updateQuoteFields(quoteId: number, fields: Record<string, any>) {
    return this.call('crm.quote.update', {
      id: quoteId,
      fields,
    });
  }

  /** crm.quote.update — move o orçamento de etapa */
  public async updateQuoteStatus(quoteId: number, statusId: string, extraFields: Record<string, any> = {}) {
    return this.updateQuoteFields(quoteId, {
      STATUS_ID: statusId,
      ...extraFields,
    });
  }

  /** crm.deal.update — atualiza campos no card de negócio vinculado */
  public async updateDealFields(dealId: number, fields: Record<string, any>) {
    try {
      return await this.call('crm.deal.update', {
        id: dealId,
        fields,
      });
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Aviso ao atualizar negócio ${dealId}: ${err.message}`);
      return null;
    }
  }

  /** crm.timeline.comment.add — adiciona comentário detalhado na timeline do orçamento ou negócio */
  public async addTimelineComment(entityType: 'quote' | 'deal', entityId: number, comment: string): Promise<boolean> {
    try {
      await this.call('crm.timeline.comment.add', {
        fields: {
          ENTITY_ID: entityId,
          ENTITY_TYPE: entityType,
          COMMENT: comment,
        },
      });
      return true;
    } catch (err: any) {
      console.warn(`[BitrixQuoteService] Aviso ao gravar comentário na timeline (${entityType} ${entityId}): ${err.message}`);
      return false;
    }
  }

  /**
   * Salva a amarração da Oportunidade (AD1_NROPOR) gerada na Etapa 1 no orçamento e card do Bitrix24.
   */
  public async saveOpportunityBinding(params: {
    quoteId?: number | null;
    dealId?: number | null;
    opportunityId: string;
    branchId: string;
    customerCode: string;
    storeId: string;
    customerName: string;
    salesmanCode?: string;
    salesmanName?: string;
  }): Promise<{ quoteUpdated: boolean; dealUpdated: boolean; fieldUsed: string | null }> {
    let quoteUpdated = false;
    let dealUpdated = false;
    const fieldUsed = env.BITRIX_QUOTE_PROPOSAL_FIELD || env.BITRIX_QUOTE_TOTVS_ID_FIELD || null;

    if (params.quoteId) {
      const quoteFields: Record<string, any> = {};
      if (env.BITRIX_QUOTE_PROPOSAL_FIELD) {
        quoteFields[env.BITRIX_QUOTE_PROPOSAL_FIELD] = params.opportunityId;
      }
      if (env.BITRIX_QUOTE_TOTVS_ID_FIELD) {
        quoteFields[env.BITRIX_QUOTE_TOTVS_ID_FIELD] = params.opportunityId;
      }
      if (env.BITRIX_QUOTE_SALESMAN_TOTVS_FIELD && params.salesmanCode) {
        quoteFields[env.BITRIX_QUOTE_SALESMAN_TOTVS_FIELD] = params.salesmanCode;
      }

      if (Object.keys(quoteFields).length > 0) {
        try {
          await this.updateQuoteFields(params.quoteId, quoteFields);
          quoteUpdated = true;
        } catch (err: any) {
          console.warn(`[BitrixQuoteService] Não foi possível gravar opportunityId no orçamento ${params.quoteId}: ${err.message}`);
        }
      }

      const comment = [
        `✅ [TOTVS Protheus - Etapa 1: Oportunidade Criada]`,
        `• Oportunidade (AD1): ${params.opportunityId} (Filial ${params.branchId})`,
        `• Cliente (SA1): ${params.customerCode}/${params.storeId} - ${params.customerName}`,
      ].join('\n');
      await this.addTimelineComment('quote', params.quoteId, comment);
    }

    if (params.dealId && env.BITRIX_DEAL_TOTVS_ID_FIELD) {
      try {
        await this.updateDealFields(params.dealId, {
          [env.BITRIX_DEAL_TOTVS_ID_FIELD]: params.opportunityId,
        });
        dealUpdated = true;
      } catch {
        // Ignora erro não crítico no card de negócio
      }
    }

    return { quoteUpdated, dealUpdated, fieldUsed };
  }

  /**
   * Em caso de falha na Etapa 1 ou Etapa 2:
   * 1. Move o orçamento no Bitrix24 para a coluna/aba de Erro
   * 2. Registra o motivo traduzido e o log técnico no campo COMMENTS (Observação) e na Timeline do orçamento
   */
  public async moveQuoteToErrorStage(params: {
    quoteId?: number | null;
    dealId?: number | null;
    stepName: string;
    friendlyMessage: string;
    technicalError: string;
    actionHint?: string;
  }): Promise<{ moved: boolean; statusId?: string; statusName?: string; timelineLogged?: boolean }> {
    if (!params.quoteId) {
      return { moved: false };
    }

    try {
      const { statusId, statusName } = await this.resolveErrorStatusId();
      const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      const logLines = [
        `❌ [ERRO INTEGRAÇÃO TOTVS PROTHEUS - ${params.stepName}] (${timestamp})`,
        `• Diagnóstico: ${params.friendlyMessage}`,
        params.actionHint ? `• Como corrigir: ${params.actionHint}` : null,
        `• Detalhe técnico: ${params.technicalError}`,
      ].filter(Boolean);

      const logText = logLines.join('\n');

      // 1º Grava observação e comentários na Timeline antes de mover de coluna
      await this.updateQuoteFields(params.quoteId, {
        COMMENTS: logText,
      });

      const timelineLogged = await this.addTimelineComment('quote', params.quoteId, logText);
      if (params.dealId) {
        await this.addTimelineComment('deal', params.dealId, logText);
      }

      // 2º Aguarda 5 segundos e só então move para a coluna de Erro
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await this.updateQuoteStatus(params.quoteId, statusId);

      return {
        moved: true,
        statusId,
        statusName,
        timelineLogged,
      };
    } catch (err: any) {
      console.error(`[BitrixQuoteService] Falha ao mover orçamento ${params.quoteId} para etapa de Erro: ${err.message}`);
      return { moved: false };
    }
  }
}

export const bitrixQuoteService = new BitrixQuoteService();
