import { quotePricingEnv } from '../config/quote-pricing.env';
import { bitrixQuoteService, BitrixProductRow } from './bitrix-quote.service';

export interface QuoteTrigger {
  quoteId?: number;
  dealId?: number;
  cnpj?: string;
}

export interface CnpjCrossCheck {
  resolvedCnpj: string;
  source: string;
  consistent: boolean;
  foundBySource: {
    payload?: string;
    quote?: string;
    deal?: string;
    company?: string;
    requisite?: string;
  };
}

export interface BitrixCustomerData {
  name: string;
  shortName?: string;
  cnpj: string;
  email?: string;
  phone?: string;
  address?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  stateRegistration?: string;
}

export interface QuoteContext {
  quoteId: number;
  quoteTitle: string;
  companyId: number | null;
  dealId: number | null;
  dealTitle: string | null;
  dealMatchMethod: string | null;
  assignedUserEmail?: string;
  cnpj: string;
  cnpjSource: string;
  cnpjCrossCheck: CnpjCrossCheck;
  customer: BitrixCustomerData;
  rows: BitrixProductRow[];
}

const onlyDigits = (v: any) => String(v ?? '').replace(/\D/g, '');
const isCnpj = (v: any) => onlyDigits(v).length === 14;
const pickText = (...values: any[]): string | undefined => {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      const first = v[0]?.VALUE ?? v[0];
      if (first && String(first).trim()) return String(first).trim();
      continue;
    }
    const s = String(v).trim();
    if (s && s !== '0') return s;
  }
  return undefined;
};

/**
 * Monta o contexto completo do orçamento a partir de um gatilho mínimo (ID do orçamento ou do negócio):
 *  - Busca o orçamento (crm.quote.get) + linhas de produto (crm.item.productrow.list)
 *  - Encontra e consulta o card de negócio vinculado (DEAL_ID ou busca em crm.deal.list batendo QUOTE_ID / COMPANY_ID / CNPJ)
 *  - Consulta empresa (crm.company.get), requisitos (crm.requisite.list), contato e responsável
 *  - Faz o cruzamento/comparação de CNPJ entre Payload, Orçamento, Negócio e Empresa
 */
export class QuoteContextService {
  public async resolve(trigger: QuoteTrigger): Promise<QuoteContext> {
    // 1. Descobre o ID do orçamento (direto ou pelo card de negócio)
    let quoteId = trigger.quoteId;
    let prefetchedDeal: Record<string, any> | null = null;

    if (!quoteId && trigger.dealId) {
      prefetchedDeal = await bitrixQuoteService.getDeal(trigger.dealId);
      const fromDealField = Number(prefetchedDeal?.QUOTE_ID) > 0 ? Number(prefetchedDeal?.QUOTE_ID) : null;
      const found = fromDealField ?? (await bitrixQuoteService.findLatestQuoteIdByDeal(trigger.dealId));
      if (!found) {
        throw new Error(`Nenhum orçamento encontrado vinculado ao card de negócio ${trigger.dealId}.`);
      }
      quoteId = found;
      console.log(`[QuoteContext] Negócio ${trigger.dealId} -> orçamento ${quoteId}`);
    }

    if (!quoteId) {
      throw new Error('Informe o ID do orçamento ou do card de negócio.');
    }

    // 2. Orçamento + produtos do orçamento em paralelo
    const [quote, initialRows] = await Promise.all([
      bitrixQuoteService.getQuote(quoteId),
      bitrixQuoteService.listProductRows(quoteId, 'Q'),
    ]);

    // 3. Resolve o card de negócio vinculado (batendo ID do orçamento no card)
    const { deal, matchMethod } = await this.resolveLinkedDeal(quoteId, quote, trigger.cnpj, prefetchedDeal);
    const dealId = deal?.ID ? Number(deal.ID) : Number(quote.DEAL_ID) > 0 ? Number(quote.DEAL_ID) : null;

    // Fallback de linhas de produto no card de negócio caso o orçamento esteja sem linhas
    let rows = initialRows;
    if (rows.length === 0 && dealId) {
      rows = await bitrixQuoteService.listProductRows(dealId, 'D');
      if (rows.length > 0) {
        console.log(`[QuoteContext] Orçamento ${quoteId} sem linhas; usando ${rows.length} produto(s) do card ${dealId}.`);
      }
    }

    // 4. Empresa, contato e responsável
    const companyIdRaw = Number(quote.COMPANY_ID) || Number(deal?.COMPANY_ID) || 0;
    const companyId = companyIdRaw > 0 ? companyIdRaw : null;
    const contactIdRaw = Number(quote.CONTACT_ID) || Number(deal?.CONTACT_ID) || 0;
    const assignedById = Number(quote.ASSIGNED_BY_ID) || Number(deal?.ASSIGNED_BY_ID) || 0;

    const [company, requisites, contact, assignedUser] = await Promise.all([
      companyId ? bitrixQuoteService.getCompany(companyId) : Promise.resolve(null),
      companyId ? bitrixQuoteService.listCompanyRequisites(companyId) : Promise.resolve([]),
      contactIdRaw > 0 ? bitrixQuoteService.getContact(contactIdRaw) : Promise.resolve(null),
      assignedById > 0 ? bitrixQuoteService.getUser(assignedById) : Promise.resolve(null),
    ]);

    // 5. Cruzamento e validação do CNPJ entre Payload, Orçamento, Negócio e Empresa
    const cnpjCrossCheck = this.crossCheckCnpj(trigger.cnpj, quote, deal, company, requisites);
    if (!cnpjCrossCheck.consistent) {
      console.warn(
        `[QuoteContext] ⚠️ Divergência de CNPJ detectada no cruzamento: ${JSON.stringify(cnpjCrossCheck.foundBySource)}`
      );
    }

    // 6. Consolida dados do cliente a partir de Empresa + Negócio + Orçamento + Contato
    const street = pickText(deal?.UF_CRM_1726577404, company?.UF_CRM_1725454111, company?.UF_CRM_1565803283501, quote.UF_CRM_67448D9F76CE1);
    const number = pickText(deal?.UF_CRM_1726577516, company?.UF_CRM_1725453020, quote.UF_CRM_67448D9F86078);
    const fullAddress = [street, number].filter(Boolean).join(', ') || undefined;

    const customer: BitrixCustomerData = {
      name:
        pickText(
          company?.UF_CRM_1725453732,
          company?.TITLE,
          quote.CLIENT_TITLE,
          deal?.TITLE,
          quote.TITLE
        ) || 'CLIENTE BITRIX',
      shortName: pickText(company?.UF_CRM_1573755580, company?.TITLE, quote.CLIENT_TITLE),
      cnpj: cnpjCrossCheck.resolvedCnpj,
      email: pickText(quote.CLIENT_EMAIL, company?.UF_CRM_1725454471, company?.EMAIL, contact?.EMAIL),
      phone: pickText(quote.CLIENT_PHONE, company?.UF_CRM_1573501805, company?.PHONE, contact?.PHONE),
      address: fullAddress,
      neighborhood: pickText(deal?.UF_CRM_1726577546, company?.UF_CRM_1565807081, quote.UF_CRM_67448D9FA3EC1),
      city: pickText(deal?.UF_CRM_1726577682, company?.UF_CRM_1565803343994, quote.UF_CRM_67448D9FCA549)?.toUpperCase(),
      state: pickText(deal?.UF_CRM_1726577723, company?.UF_CRM_1565803332209, quote.UF_CRM_67448D9FD66A9)?.toUpperCase(),
      zipCode: pickText(deal?.UF_CRM_1726577670, company?.UF_CRM_1565806629738, quote.UF_CRM_67448D9FB3992)?.replace(/\D/g, ''),
      stateRegistration: pickText(company?.UF_CRM_1573759004),
    };

    return {
      quoteId,
      quoteTitle: String(quote.TITLE ?? ''),
      companyId,
      dealId,
      dealTitle: deal?.TITLE ? String(deal.TITLE) : null,
      dealMatchMethod: matchMethod,
      assignedUserEmail: assignedUser?.EMAIL ? String(assignedUser.EMAIL).trim() : undefined,
      cnpj: cnpjCrossCheck.resolvedCnpj,
      cnpjSource: cnpjCrossCheck.source,
      cnpjCrossCheck,
      customer,
      rows,
    };
  }

  /**
   * Localiza o card de negócio correspondente ao orçamento:
   *  1) Já pré-carregado (quando gatilho veio por dealId)
   *  2) Pelo QUOTE.DEAL_ID
   *  3) Consultando cards via crm.deal.list filtrando QUOTE_ID = quoteId
   *  4) Fallback via crm.deal.list filtrando COMPANY_ID ou CNPJ e cruzando pelo título
   */
  private async resolveLinkedDeal(
    quoteId: number,
    quote: Record<string, any>,
    payloadCnpj?: string,
    prefetchedDeal?: Record<string, any> | null
  ): Promise<{ deal: Record<string, any> | null; matchMethod: string | null }> {
    if (prefetchedDeal) {
      return { deal: prefetchedDeal, matchMethod: 'trigger.dealId' };
    }

    const directDealId = Number(quote.DEAL_ID) || 0;
    if (directDealId > 0) {
      const deal = await bitrixQuoteService.getDeal(directDealId);
      if (deal) {
        console.log(`[QuoteContext] Card de negócio ${directDealId} encontrado via QUOTE.DEAL_ID.`);
        return { deal, matchMethod: 'quote.DEAL_ID' };
      }
    }

    // Procura nos cards de negócio aquele que aponta QUOTE_ID = quoteId
    const byQuoteField = await bitrixQuoteService.findDeals({ QUOTE_ID: quoteId });
    if (byQuoteField.length > 0) {
      console.log(`[QuoteContext] Card de negócio ${byQuoteField[0].ID} encontrado via crm.deal.list (QUOTE_ID=${quoteId}).`);
      return { deal: byQuoteField[0], matchMethod: 'deal.QUOTE_ID' };
    }

    // Cruzamento auxiliar por Empresa ou CNPJ caso nem DEAL_ID nem QUOTE_ID estejam preenchidos
    const companyId = Number(quote.COMPANY_ID) || 0;
    if (companyId > 0) {
      const byCompany = await bitrixQuoteService.findDeals({ COMPANY_ID: companyId });
      const titleMatch = byCompany.find((d) => String(d.TITLE || '').trim() === String(quote.TITLE || '').trim());
      if (titleMatch) {
        return { deal: titleMatch, matchMethod: 'deal.COMPANY_ID+TITLE' };
      }
    }

    const cleanCnpj = onlyDigits(payloadCnpj) || onlyDigits(quote[quotePricingEnv.quoteCnpjField]);
    if (cleanCnpj.length === 14 && quotePricingEnv.dealCnpjField) {
      const byCnpj = await bitrixQuoteService.findDeals({ [quotePricingEnv.dealCnpjField]: cleanCnpj });
      const titleMatch = byCnpj.find((d) => String(d.TITLE || '').trim() === String(quote.TITLE || '').trim());
      if (titleMatch) {
        return { deal: titleMatch, matchMethod: 'deal.CNPJ+TITLE' };
      }
    }

    return { deal: null, matchMethod: null };
  }

  private crossCheckCnpj(
    payloadCnpj: string | undefined,
    quote: Record<string, any>,
    deal: Record<string, any> | null,
    company: Record<string, any> | null,
    requisites: any[]
  ): CnpjCrossCheck {
    const foundBySource: CnpjCrossCheck['foundBySource'] = {};

    if (isCnpj(payloadCnpj)) foundBySource.payload = onlyDigits(payloadCnpj);
    if (quotePricingEnv.quoteCnpjField && isCnpj(quote[quotePricingEnv.quoteCnpjField])) {
      foundBySource.quote = onlyDigits(quote[quotePricingEnv.quoteCnpjField]);
    }
    if (deal && quotePricingEnv.dealCnpjField && isCnpj(deal[quotePricingEnv.dealCnpjField])) {
      foundBySource.deal = onlyDigits(deal[quotePricingEnv.dealCnpjField]);
    }
    if (company && quotePricingEnv.companyCnpjField && isCnpj(company[quotePricingEnv.companyCnpjField])) {
      foundBySource.company = onlyDigits(company[quotePricingEnv.companyCnpjField]);
    }
    const reqMatch = requisites.find((r) => isCnpj(r.RQ_INN));
    if (reqMatch) foundBySource.requisite = onlyDigits(reqMatch.RQ_INN);

    const priority: Array<[keyof CnpjCrossCheck['foundBySource'], string]> = [
      ['payload', 'payload'],
      ['quote', `orçamento (${quotePricingEnv.quoteCnpjField})`],
      ['deal', `card de negócio (${quotePricingEnv.dealCnpjField})`],
      ['company', `empresa (${quotePricingEnv.companyCnpjField})`],
      ['requisite', 'requisito da empresa (RQ_INN)'],
    ];

    let resolvedCnpj = '';
    let source = '';
    for (const [key, label] of priority) {
      if (foundBySource[key]) {
        resolvedCnpj = foundBySource[key]!;
        source = label;
        break;
      }
    }

    if (!resolvedCnpj) {
      throw new Error(
        `CNPJ não encontrado para o orçamento ${quote.ID}: não veio no payload nem nos campos ` +
          `${quotePricingEnv.quoteCnpjField} (orçamento), ${quotePricingEnv.dealCnpjField} (negócio), ` +
          `${quotePricingEnv.companyCnpjField} (empresa) ou requisitos.`
      );
    }

    const distinctValues = new Set(Object.values(foundBySource).filter(Boolean));
    return {
      resolvedCnpj,
      source,
      consistent: distinctValues.size <= 1,
      foundBySource,
    };
  }
}

export const quoteContextService = new QuoteContextService();
