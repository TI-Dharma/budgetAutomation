import { env } from '../config/env';
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
  quoteAndDealConfirmed: boolean;
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
  assignedUserName?: string;
  assignedUserEmail?: string;
  salesmanFromBitrix?: string;
  linkedTotvsId?: string;
  paymentConditionFromBitrix?: string;
  branchFromBitrix?: string;
  operationTypeFromBitrix?: string;
  deliveryDaysFromBitrix?: string;
  freightTypeFromBitrix?: string;
  cnpj: string;
  cnpjSource: string;
  cnpjCrossCheck: CnpjCrossCheck;
  customer: BitrixCustomerData;
  rows: BitrixProductRow[];
}

const onlyDigits = (v: any) => String(v ?? '').replace(/\D/g, '');
const isCnpj = (v: any) => onlyDigits(v).length === 14;

/** Formata 14 dígitos em XX.XXX.XXX/XXXX-XX para buscar tanto com máscara quanto sem máscara no Bitrix24 */
function formatCnpjMask(cnpj14: string): string {
  const d = onlyDigits(cnpj14);
  if (d.length !== 14) return d;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

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

const NAME_SEPARATOR = ' - ';

/**
 * Verifica se o texto começa com "<CODIGO> - <DESCRIÇÃO>" (onde <CODIGO> não possui espaços)
 * Ex: "PMPN4468A - CARREGADOR RAPIDO (PAREDE) - DTR 720" => "PMPN4468A"
 * Já se o nome já tiver sido limpo para "CARREGADOR RAPIDO (PAREDE) - DTR 720", retorna ''
 * para que o código seja resolvido via xmlId ou catálogo do Bitrix.
 */
export function extractProductCode(productName: string, xmlId?: string): string {
  const cleanXmlId = String(xmlId || '').trim();
  if (cleanXmlId && /^[A-Z0-9._/-]+$/i.test(cleanXmlId)) {
    return cleanXmlId;
  }

  const name = String(productName || '').trim();
  if (!name) return '';

  const prefixMatch = name.match(/^([A-Z0-9._/-]+)\s*[-–—]\s+.+$/i);
  if (prefixMatch) {
    return prefixMatch[1].trim();
  }

  // Se o texto inteiro for apenas um código sem espaços (ex: "PMPN4468A")
  if (/^[A-Z0-9._/-]+$/i.test(name)) {
    return name;
  }

  return '';
}

/**
 * Remove o prefixo "<CODIGO> - " do nome do produto para exibição limpa nas linhas do orçamento e no PDF,
 * mantendo apenas a descrição do produto (já que o orçamento possui a coluna "Cod" separada ao lado).
 */
export function formatCleanQuoteProductName(
  rawProductName: string | undefined,
  productCode: string,
  sb1Description?: string
): string {
  const code = String(productCode || '').trim();
  const raw = String(rawProductName || '').trim();
  const desc = String(sb1Description || '').trim();

  if (raw && code) {
    const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = raw.replace(new RegExp(`^${escapedCode}\\s*[-–—:]\\s*`, 'i'), '').trim();
    if (stripped && stripped.toUpperCase() !== code.toUpperCase()) {
      return stripped;
    }
  }

  return desc || raw || code;
}

/**
 * Monta o contexto completo do orçamento a partir apenas do ID do orçamento (quoteId):
 *  1. Busca o orçamento (crm.quote.get) + linhas de produto (crm.item.productrow.list)
 *  2. Busca a empresa do orçamento (crm.company.get) e requisitos (RQ_INN) para identificar o CNPJ do orçamento
 *  3. Localiza automaticamente o Card de Negócio (dealId) no Bitrix24 (via DEAL_ID, QUOTE_ID ou buscando
 *     nos negócios pelo CNPJ com e sem pontuação / empresa / contato) e cruza o CNPJ do Orçamento com o
 *     CNPJ do Card de Negócio para confirmar que pertencem ao mesmo cliente
 *  4. Consolida todos os dados cadastrais, produtos e vínculo TOTVS
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
      throw new Error('Informe o ID do orçamento (quoteId / id).');
    }

    // 2. Orçamento + produtos do orçamento em paralelo
    const [quote, initialRows] = await Promise.all([
      bitrixQuoteService.getQuote(quoteId),
      bitrixQuoteService.listProductRows(quoteId, 'Q'),
    ]);

    // 3. Obtém o CNPJ do orçamento (direto do campo do orçamento ou, se vazio, da empresa vinculada)
    const quoteCompanyId = Number(quote.COMPANY_ID) > 0 ? Number(quote.COMPANY_ID) : null;
    let quoteCompany: Record<string, any> | null = null;
    let quoteRequisites: any[] = [];

    let quoteKnownCnpj =
      (isCnpj(trigger.cnpj) ? onlyDigits(trigger.cnpj) : '') ||
      (env.BITRIX_QUOTE_CNPJ_FIELD && isCnpj(quote[env.BITRIX_QUOTE_CNPJ_FIELD])
        ? onlyDigits(quote[env.BITRIX_QUOTE_CNPJ_FIELD])
        : '');

    if (!quoteKnownCnpj && quoteCompanyId) {
      [quoteCompany, quoteRequisites] = await Promise.all([
        bitrixQuoteService.getCompany(quoteCompanyId),
        bitrixQuoteService.listCompanyRequisites(quoteCompanyId),
      ]);
      quoteKnownCnpj =
        (quoteCompany && env.BITRIX_COMPANY_CNPJ_FIELD && isCnpj(quoteCompany[env.BITRIX_COMPANY_CNPJ_FIELD])
          ? onlyDigits(quoteCompany[env.BITRIX_COMPANY_CNPJ_FIELD])
          : '') ||
        onlyDigits(quoteRequisites.find((r) => isCnpj(r.RQ_INN))?.RQ_INN);
    }

    // 4. Descobre automaticamente o Card de Negócio vinculado e confirma o CNPJ entre Orçamento e Negócio
    const { deal, matchMethod } = await this.resolveLinkedDeal(
      quoteId,
      quote,
      quoteKnownCnpj,
      prefetchedDeal
    );
    const dealId = deal?.ID ? Number(deal.ID) : Number(quote.DEAL_ID) > 0 ? Number(quote.DEAL_ID) : null;

    // Fallback de linhas de produto no card de negócio caso o orçamento esteja sem linhas
    let rows = initialRows;
    if (rows.length === 0 && dealId) {
      rows = await bitrixQuoteService.listProductRows(dealId, 'D');
      if (rows.length > 0) {
        console.log(`[QuoteContext] Orçamento ${quoteId} sem linhas; usando ${rows.length} produto(s) do card ${dealId}.`);
      }
    }

    // 5. Empresa (do orçamento ou do negócio), contato e responsável
    const companyIdRaw = Number(quote.COMPANY_ID) || Number(deal?.COMPANY_ID) || 0;
    const companyId = companyIdRaw > 0 ? companyIdRaw : null;
    const contactIdRaw = Number(quote.CONTACT_ID) || Number(deal?.CONTACT_ID) || 0;
    const assignedById = Number(quote.ASSIGNED_BY_ID) || Number(deal?.ASSIGNED_BY_ID) || 0;

    const [company, requisites, contact, assignedUser] = await Promise.all([
      companyId
        ? companyId === quoteCompanyId && quoteCompany
          ? Promise.resolve(quoteCompany)
          : bitrixQuoteService.getCompany(companyId)
        : Promise.resolve(null),
      companyId
        ? companyId === quoteCompanyId && quoteRequisites.length > 0
          ? Promise.resolve(quoteRequisites)
          : bitrixQuoteService.listCompanyRequisites(companyId)
        : Promise.resolve([]),
      contactIdRaw > 0 ? bitrixQuoteService.getContact(contactIdRaw) : Promise.resolve(null),
      assignedById > 0 ? bitrixQuoteService.getUser(assignedById) : Promise.resolve(null),
    ]);

    // 6. Cruzamento e confirmação do CNPJ entre Orçamento, Card de Negócio, Empresa e Payload
    const cnpjCrossCheck = this.crossCheckCnpj(trigger.cnpj, quote, deal, company, requisites);
    if (!cnpjCrossCheck.consistent) {
      throw new Error(
        `Divergência de CNPJ detectada entre o Orçamento (${quoteId}) e o Card de Negócio (${dealId ?? 'N/A'}): ` +
          `${JSON.stringify(cnpjCrossCheck.foundBySource)}. Confirme se o CNPJ do orçamento é o mesmo do card de negócio.`
      );
    }

    console.log(
      `[QuoteContext] ✅ Orçamento ${quoteId} vinculado ao Card de Negócio ${dealId ?? 'N/A'} (via ${matchMethod ?? 'N/A'}) | CNPJ confirmado: ${cnpjCrossCheck.resolvedCnpj}`
    );

    // 7. Consolida dados do cliente a partir de Empresa + Negócio + Orçamento + Contato
    const street = pickText(
      deal?.UF_CRM_1726577404,
      company?.UF_CRM_1725454111,
      company?.UF_CRM_1565803283501,
      quote.UF_CRM_67448D9F76CE1
    );
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
      zipCode: pickText(deal?.UF_CRM_1726577670, company?.UF_CRM_1565806629738, quote.UF_CRM_67448D9FB3992)?.replace(
        /\D/g,
        ''
      ),
      stateRegistration: pickText(company?.UF_CRM_1573759004),
    };

    const linkedTotvsId = pickText(
      env.BITRIX_QUOTE_PROPOSAL_FIELD ? quote[env.BITRIX_QUOTE_PROPOSAL_FIELD] : undefined,
      env.BITRIX_QUOTE_TOTVS_ID_FIELD ? quote[env.BITRIX_QUOTE_TOTVS_ID_FIELD] : undefined,
      env.BITRIX_DEAL_TOTVS_ID_FIELD && deal ? deal[env.BITRIX_DEAL_TOTVS_ID_FIELD] : undefined
    );

    const paymentConditionFromBitrix = pickText(
      env.BITRIX_QUOTE_INPUT_PAYMENT_FIELD ? quote[env.BITRIX_QUOTE_INPUT_PAYMENT_FIELD] : undefined,
      quote.TERMS
    );
    const branchFromBitrix = pickText(
      env.BITRIX_QUOTE_INPUT_BRANCH_FIELD ? quote[env.BITRIX_QUOTE_INPUT_BRANCH_FIELD] : undefined
    );
    const operationTypeFromBitrix = pickText(
      env.BITRIX_QUOTE_INPUT_OPERATION_FIELD ? quote[env.BITRIX_QUOTE_INPUT_OPERATION_FIELD] : undefined
    );
    const deliveryDaysFromBitrix = pickText(
      env.BITRIX_QUOTE_INPUT_DELIVERY_FIELD ? quote[env.BITRIX_QUOTE_INPUT_DELIVERY_FIELD] : undefined
    );
    const freightTypeFromBitrix = pickText(
      env.BITRIX_QUOTE_INPUT_FREIGHT_FIELD ? quote[env.BITRIX_QUOTE_INPUT_FREIGHT_FIELD] : undefined
    );
    const salesmanFromBitrix = pickText(
      env.BITRIX_QUOTE_SALESMAN_TOTVS_FIELD ? quote[env.BITRIX_QUOTE_SALESMAN_TOTVS_FIELD] : undefined
    );
    const assignedUserName = assignedUser
      ? [assignedUser.NAME, assignedUser.LAST_NAME]
          .map((p) => String(p || '').trim())
          .filter(Boolean)
          .join(' ') || undefined
      : undefined;

    return {
      quoteId,
      quoteTitle: String(quote.TITLE ?? ''),
      companyId,
      dealId,
      dealTitle: deal?.TITLE ? String(deal.TITLE) : null,
      dealMatchMethod: matchMethod,
      assignedUserName,
      assignedUserEmail: assignedUser?.EMAIL ? String(assignedUser.EMAIL).trim() : undefined,
      salesmanFromBitrix,
      linkedTotvsId,
      paymentConditionFromBitrix,
      branchFromBitrix,
      operationTypeFromBitrix,
      deliveryDaysFromBitrix,
      freightTypeFromBitrix,
      cnpj: cnpjCrossCheck.resolvedCnpj,
      cnpjSource: cnpjCrossCheck.source,
      cnpjCrossCheck,
      customer,
      rows,
    };
  }

  /**
   * Descobre automaticamente o Card de Negócio (Deal) correspondente ao Orçamento (Quote)
   * e confirma o CNPJ entre os dois:
   *  1) Já pré-carregado (quando gatilho veio por dealId)
   *  2) Pelo campo nativo QUOTE.DEAL_ID
   *  3) Consultando cards via crm.deal.list filtrando QUOTE_ID = quoteId
   *  4) Consultando cards via crm.deal.list pelo CNPJ (tanto sem pontuação "01009681000383"
   *     quanto com pontuação "01.009.681/0003-83"), COMPANY_ID e CONTACT_ID,
   *     filtrando apenas negócios cujo CNPJ (14 dígitos) bata exatamente com o CNPJ do orçamento.
   */
  private async resolveLinkedDeal(
    quoteId: number,
    quote: Record<string, any>,
    quoteCnpj: string,
    prefetchedDeal?: Record<string, any> | null
  ): Promise<{ deal: Record<string, any> | null; matchMethod: string | null }> {
    if (prefetchedDeal) {
      return { deal: prefetchedDeal, matchMethod: 'trigger.dealId' };
    }

    // 1. Vínculo direto no orçamento (QUOTE.DEAL_ID)
    const directDealId = Number(quote.DEAL_ID) || 0;
    if (directDealId > 0) {
      const deal = await bitrixQuoteService.getDeal(directDealId);
      if (deal) {
        return { deal, matchMethod: 'quote.DEAL_ID' };
      }
    }

    const safeFindDeals = async (filter: Record<string, any>): Promise<Record<string, any>[]> => {
      try {
        return await bitrixQuoteService.findDeals(filter);
      } catch (err: any) {
        console.warn(`[QuoteContext] Aviso ao buscar negócios (${JSON.stringify(filter)}): ${err.message}`);
        return [];
      }
    };

    // 2. Card de negócio que referencia QUOTE_ID = quoteId
    const byQuoteField = await safeFindDeals({ QUOTE_ID: quoteId });
    if (byQuoteField.length > 0) {
      return { deal: byQuoteField[0], matchMethod: 'deal.QUOTE_ID' };
    }

    // 3. Busca automática pelo CNPJ (com e sem máscara) e Empresa, confirmando o CNPJ entre Orçamento e Card
    const cleanCnpj = onlyDigits(quoteCnpj);
    const dealCnpjField = env.BITRIX_DEAL_CNPJ_FIELD;
    const companyId = Number(quote.COMPANY_ID) || 0;
    const contactId = Number(quote.CONTACT_ID) || 0;

    const candidateMap = new Map<number, Record<string, any>>();
    const addCandidates = (list: Record<string, any>[]) => {
      for (const d of list) {
        const id = Number(d?.ID);
        if (id > 0 && !candidateMap.has(id)) {
          candidateMap.set(id, d);
        }
      }
    };

    if (cleanCnpj.length === 14 && dealCnpjField) {
      const maskedCnpj = formatCnpjMask(cleanCnpj);
      // 3A. Tenta primeiro pelo CNPJ formatado (padrão mais recente nos cards do Bitrix) e sem máscara
      addCandidates(await safeFindDeals({ [`%${dealCnpjField}`]: maskedCnpj }));
      addCandidates(await safeFindDeals({ [`%${dealCnpjField}`]: cleanCnpj }));
    }

    if (candidateMap.size === 0 && companyId > 0) {
      addCandidates(await safeFindDeals({ COMPANY_ID: companyId }));
    }

    if (candidateMap.size === 0 && contactId > 0) {
      addCandidates(await safeFindDeals({ CONTACT_ID: contactId }));
    }

    if (candidateMap.size === 0) {
      return { deal: null, matchMethod: null };
    }

    // Ordena candidatos do mais recente (maior ID) para o mais antigo
    const candidates = [...candidateMap.values()].sort((a, b) => Number(b.ID) - Number(a.ID));

    if (cleanCnpj.length === 14 && dealCnpjField) {
      // Filtra negócios cujo CNPJ no card bate exatamente com o CNPJ do orçamento (confirmando os dois!)
      const cnpjConfirmedDeals = candidates.filter((d) => {
        const dCnpj = onlyDigits(d[dealCnpjField]);
        return dCnpj === cleanCnpj;
      });

      if (cnpjConfirmedDeals.length > 0) {
        const quoteTitle = String(quote.TITLE || '').trim().toLowerCase();
        const exactTitle = cnpjConfirmedDeals.find(
          (d) => String(d.TITLE || '').trim().toLowerCase() === quoteTitle
        );
        if (exactTitle) {
          return { deal: exactTitle, matchMethod: 'deal.CNPJ_CONFIRMED+TITLE' };
        }

        const sameContactOrCompany = cnpjConfirmedDeals.find(
          (d) =>
            (contactId > 0 && Number(d.CONTACT_ID) === contactId) ||
            (companyId > 0 && Number(d.COMPANY_ID) === companyId)
        );
        if (sameContactOrCompany) {
          return { deal: sameContactOrCompany, matchMethod: 'deal.CNPJ_CONFIRMED+CONTACT_COMPANY' };
        }

        // Retorna o card de negócio mais recente daquele CNPJ confirmado
        return { deal: cnpjConfirmedDeals[0], matchMethod: 'deal.CNPJ_CONFIRMED_LATEST' };
      }
    }

    // Caso o card de negócio não tenha o campo CNPJ preenchido mas seja da mesma Empresa do orçamento
    if (companyId > 0) {
      const sameCompanyDeals = candidates.filter((d) => {
        const dCnpj = dealCnpjField ? onlyDigits(d[dealCnpjField]) : '';
        return Number(d.COMPANY_ID) === companyId && (!dCnpj || !cleanCnpj || dCnpj === cleanCnpj);
      });
      if (sameCompanyDeals.length > 0) {
        return { deal: sameCompanyDeals[0], matchMethod: 'deal.COMPANY_ID' };
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
    if (env.BITRIX_QUOTE_CNPJ_FIELD && isCnpj(quote[env.BITRIX_QUOTE_CNPJ_FIELD])) {
      foundBySource.quote = onlyDigits(quote[env.BITRIX_QUOTE_CNPJ_FIELD]);
    }
    if (deal && env.BITRIX_DEAL_CNPJ_FIELD && isCnpj(deal[env.BITRIX_DEAL_CNPJ_FIELD])) {
      foundBySource.deal = onlyDigits(deal[env.BITRIX_DEAL_CNPJ_FIELD]);
    }
    if (company && env.BITRIX_COMPANY_CNPJ_FIELD && isCnpj(company[env.BITRIX_COMPANY_CNPJ_FIELD])) {
      foundBySource.company = onlyDigits(company[env.BITRIX_COMPANY_CNPJ_FIELD]);
    }
    const reqMatch = requisites.find((r) => isCnpj(r.RQ_INN));
    if (reqMatch) foundBySource.requisite = onlyDigits(reqMatch.RQ_INN);

    const priority: Array<[keyof CnpjCrossCheck['foundBySource'], string]> = [
      ['quote', `orçamento (${env.BITRIX_QUOTE_CNPJ_FIELD})`],
      ['deal', `card de negócio (${env.BITRIX_DEAL_CNPJ_FIELD})`],
      ['company', `empresa (${env.BITRIX_COMPANY_CNPJ_FIELD})`],
      ['requisite', 'requisito da empresa (RQ_INN)'],
      ['payload', 'payload'],
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
        `CNPJ não encontrado para o orçamento ${quote.ID}: não veio no orçamento (${env.BITRIX_QUOTE_CNPJ_FIELD}), ` +
          `nem no card de negócio (${env.BITRIX_DEAL_CNPJ_FIELD}), nem na empresa (${env.BITRIX_COMPANY_CNPJ_FIELD}) ou requisitos.`
      );
    }

    const distinctValues = new Set(Object.values(foundBySource).filter(Boolean));
    const quoteOrCompanyCnpj =
      foundBySource.quote || foundBySource.company || foundBySource.requisite;
    const quoteAndDealConfirmed = Boolean(
      quoteOrCompanyCnpj && foundBySource.deal && quoteOrCompanyCnpj === foundBySource.deal
    );

    return {
      resolvedCnpj,
      source,
      consistent: distinctValues.size <= 1,
      quoteAndDealConfirmed,
      foundBySource,
    };
  }
}

export const quoteContextService = new QuoteContextService();
