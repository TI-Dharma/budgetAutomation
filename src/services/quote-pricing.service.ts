import { env } from '../config/env';
import { quotePricingEnv } from '../config/quote-pricing.env';
import { cnpjService, CnpjFiscalInfo } from './cnpj.service';
import { pricingRepository, PriceRadioRow } from './pricing.repository';
import { bitrixQuoteService, BitrixProductRowInput } from './bitrix-quote.service';
import { quoteContextService, QuoteTrigger, QuoteContext } from './quote-context.service';
import {
  protheusService,
  ProtheusOpportunityProposalFlowInput,
  ProtheusOpportunityProposalFlowResult,
} from './protheus.service';

/** Alíquotas de ICMS por UF (mesma tabela do nó "Soma ICMS" do n8n) */
export const ICMS_RATES: Record<string, number> = {
  SP: 18,
  MG: 12, PR: 12, RJ: 12, RS: 12, SC: 12,
  AC: 7, AL: 7, AM: 7, AP: 7, BA: 7, CE: 7, DF: 7, ES: 7, GO: 7,
  MA: 7, MS: 7, MT: 7, PA: 7, PB: 7, PE: 7, PI: 7, RN: 7, RO: 7,
  RR: 7, SE: 7, TO: 7,
};

const NAME_SEPARATOR = ' - ';

/** "PMPN4468A - RADIO XYZ" => "PMPN4468A" (mesma regra do nó "Filtrar Cod") */
export function extractProductCode(productName: string): string {
  const name = String(productName || '');
  return (name.includes(NAME_SEPARATOR) ? name.split(NAME_SEPARATOR)[0] : name).trim();
}

/**
 * Cálculo do preço final (mesma regra do nó "Soma ICMS"):
 * 1) custoReais = precoDolar * valorDolar
 * 2) lucro: 30% isento / 25% contribuinte
 * 3) ICMS apenas para contribuinte
 * 4) arredonda em 2 casas
 */
export function calculateFinalPrice(
  priceUsd: number,
  dollarRate: number,
  isExempt: boolean,
  icmsRate: number
): number {
  const costBrl = priceUsd * dollarRate;
  const withMargin = costBrl * (1 + (isExempt ? quotePricingEnv.marginExempt : quotePricingEnv.marginTaxpayer));
  const finalValue = isExempt ? withMargin : withMargin * (1 + icmsRate / 100);
  return Math.round((finalValue + Number.EPSILON) * 100) / 100;
}

function getPreferredPriceTables(isExempt: boolean, uf: string, icmsRate: number): string[] {
  if (isExempt) return ['024', '023', '025', '003'];
  if (uf === 'SP') return ['003', '001', '002'];
  if (icmsRate === 12) return ['005', '003', '004'];
  return ['004', '003', '005'];
}

export interface ProcessQuoteInput extends QuoteTrigger {
  branchId?: string;
  salesmanCode?: string;
  conditionPayment?: string;
  priceTable?: string;
  deliveryDays?: string;
  freightType?: 'C' | 'F';
  /** Quando true, apenas simula/valida (não grava no Bitrix nem no Protheus) */
  dryRun?: boolean;
  /** Quando true, atualiza só o Bitrix e pula a gravação no TOTVS Protheus */
  skipProtheus?: boolean;
}

export class QuotePricingService {
  public async processQuote(input: ProcessQuoteInput) {
    // 1. Busca no Bitrix: orçamento, card de negócio vinculado, empresa, contato e cruzamento de CNPJ
    const ctx = await quoteContextService.resolve(input);
    if (ctx.rows.length === 0) {
      throw new Error(`O orçamento ${ctx.quoteId} não possui produtos no Bitrix24.`);
    }
    console.log(
      `[QuotePricing] Orçamento ${ctx.quoteId} "${ctx.quoteTitle}" | Negócio ${ctx.dealId ?? 'N/A'} (${ctx.dealMatchMethod ?? '-'}) | CNPJ ${ctx.cnpj} (${ctx.cnpjSource})`
    );

    // 2. CNPJ -> UF, Inscrição Estadual (isento x contribuinte) e dados cadastrais
    const fiscal = await cnpjService.getFiscalInfo(ctx.cnpj);
    const icmsRate = ICMS_RATES[fiscal.uf];
    if (icmsRate === undefined) {
      throw new Error(`Estado sem alíquota de ICMS cadastrada: ${fiscal.uf}`);
    }
    console.log(`[QuotePricing] UF ${fiscal.uf} | ${fiscal.isExempt ? 'ISENTO' : 'CONTRIBUINTE'} | ICMS ${icmsRate}%`);

    // 3. PostgreSQL: cotação do dólar + preços base dos produtos em paralelo
    const codes = ctx.rows.map((r) => extractProductCode(r.productName));
    const [dollarRate, dbProducts] = await Promise.all([
      pricingRepository.getDollarRate(),
      pricingRepository.getProductsByCodes(codes),
    ]);
    const byCode = new Map<string, PriceRadioRow>(dbProducts.map((p) => [p.cod, p]));
    console.log(`[QuotePricing] Dólar: ${dollarRate} | Produtos: ${codes.join(', ')} | Encontrados no banco: ${dbProducts.length}`);

    // 4. Calcula todos os itens ANTES de gravar (se faltar preço no banco, falha antes de alterar o Bitrix)
    const missingInPg: string[] = [];
    const details: any[] = [];
    const productRows: BitrixProductRowInput[] = [];

    ctx.rows.forEach((row, index) => {
      const productId = Number(row.productId);
      if (!Number.isFinite(productId)) {
        throw new Error(`Linha [${index}] do orçamento sem 'productId' válido.`);
      }

      const code = codes[index];
      const dbProduct = byCode.get(code) ?? dbProducts.find((p) => p.name === row.productName);
      if (!dbProduct) {
        missingInPg.push(`${row.productName} (código: ${code})`);
        return;
      }

      const price = calculateFinalPrice(dbProduct.price, dollarRate, fiscal.isExempt, icmsRate);
      const quantity = row.quantity !== undefined && row.quantity !== null ? Number(row.quantity) : 1;

      details.push({ code, productId, quantity, priceUsd: dbProduct.price, oldPrice: Number(row.price), newPrice: price });
      productRows.push({ productId, productName: String(row.productName), price, quantity });
    });

    if (missingInPg.length > 0) {
      throw new Error(`Preço base não encontrado na tabela "priceRadios" para: ${missingInPg.join('; ')}`);
    }

    // 5. Pré-consulta no TOTVS Protheus (SA1, SB1, DA1, SA3) quando integração TOTVS estiver ativa
    let protheusPreCheck: any = null;
    let protheusFlowInput: ProtheusOpportunityProposalFlowInput | null = null;

    if (!input.skipProtheus) {
      const prepared = await this.prepareProtheusInput(input, ctx, fiscal, icmsRate, codes, details);
      protheusPreCheck = prepared.preCheck;
      protheusFlowInput = prepared.flowInput;
    }

    const statusId = quotePricingEnv.quotePriceUpdatedStatus;
    const bitrixSummary = {
      quoteId: ctx.quoteId,
      quoteTitle: ctx.quoteTitle,
      dealId: ctx.dealId,
      dealTitle: ctx.dealTitle,
      dealMatchMethod: ctx.dealMatchMethod,
      companyId: ctx.companyId,
      cnpj: fiscal.cnpj,
      cnpjSource: ctx.cnpjSource,
      cnpjCrossCheck: ctx.cnpjCrossCheck,
      uf: fiscal.uf,
      isExempt: fiscal.isExempt,
      icmsRate: fiscal.isExempt ? 0 : icmsRate,
      margin: fiscal.isExempt ? quotePricingEnv.marginExempt : quotePricingEnv.marginTaxpayer,
      dollarRate,
      products: details,
      total: Math.round(details.reduce((s, d) => s + d.newPrice * d.quantity, 0) * 100) / 100,
    };

    // Modo simulação (dryRun): não altera Bitrix nem cria registros no Protheus
    if (input.dryRun) {
      console.log(`[QuotePricing] 🧪 dryRun: nenhuma gravação feita no Bitrix ou no Protheus.`);
      return {
        dryRun: true,
        bitrix: { ...bitrixSummary, updated: false, statusId: null },
        protheus: protheusPreCheck ? { created: false, preCheck: protheusPreCheck, payloadPreview: protheusFlowInput } : null,
      };
    }

    // 6. PASSO 1 (Bitrix24): grava os novos valores no orçamento e muda etapa para "Preço Atualizado"
    console.log(`[QuotePricing][Passo 1/2 - Bitrix] Atualizando orçamento ${ctx.quoteId} e movendo para ${statusId}...`);
    await bitrixQuoteService.setQuoteProductRows(ctx.quoteId, productRows);
    await bitrixQuoteService.updateQuoteStatus(ctx.quoteId, statusId);
    console.log(`[QuotePricing][Passo 1/2 - Bitrix] ✅ Orçamento ${ctx.quoteId} atualizado com sucesso.`);

    const bitrixDone = { ...bitrixSummary, updated: true, statusId };

    if (input.skipProtheus || !protheusFlowInput) {
      return { dryRun: false, bitrix: bitrixDone, protheus: null };
    }

    // 7. PASSO 2 (TOTVS Protheus): valida produtos na SB1 e executa Cliente (SA1) -> Oportunidade (AD1) -> Proposta (ADY/ADZ)
    if (protheusPreCheck?.missingProductsInSb1?.length > 0) {
      const err: any = new Error(
        `Bitrix atualizado, mas os seguintes produtos não foram encontrados no Protheus (SB1): ${protheusPreCheck.missingProductsInSb1.join(', ')}`
      );
      err.partialResult = { bitrix: bitrixDone, protheusPreCheck };
      throw err;
    }

    console.log(`[QuotePricing][Passo 2/2 - TOTVS] Gravando Cliente/Oportunidade/Proposta no Protheus...`);
    try {
      const protheusResult: ProtheusOpportunityProposalFlowResult =
        await protheusService.executeUnifiedOrderFlow(protheusFlowInput);

      console.log(
        `[QuotePricing][Passo 2/2 - TOTVS] ✅ Oportunidade ${protheusResult.opportunityId} / Proposta ${protheusResult.proposalId} criadas no Protheus.`
      );

      return {
        dryRun: false,
        bitrix: bitrixDone,
        protheus: {
          created: true,
          priceTableSelected: protheusPreCheck.priceTableSelected,
          priceTableCoveredAll: protheusPreCheck.priceTableCoveredAll,
          ...protheusResult,
        },
      };
    } catch (protheusErr: any) {
      protheusErr.partialResult = { bitrix: bitrixDone, protheusPreCheck };
      throw protheusErr;
    }
  }

  private async prepareProtheusInput(
    input: ProcessQuoteInput,
    ctx: QuoteContext,
    fiscal: CnpjFiscalInfo,
    icmsRate: number,
    codes: string[],
    details: Array<{ code: string; quantity: number; newPrice: number }>
  ) {
    const preferredTables = getPreferredPriceTables(fiscal.isExempt, fiscal.uf, icmsRate);

    const [existingCustomer, sb1Map, tableResolution, matchedSalesman] = await Promise.all([
      protheusService.findCustomerByCnpj(fiscal.cnpj),
      protheusService.findProductsByCodes(codes),
      input.priceTable
        ? Promise.resolve({ tableId: input.priceTable, coveredAll: true, matchingTables: [input.priceTable] })
        : protheusService.resolvePriceTableForProducts(codes, preferredTables),
      input.salesmanCode
        ? Promise.resolve(input.salesmanCode)
        : protheusService.findSalesmanByEmail(ctx.assignedUserEmail),
    ]);

    const missingProductsInSb1 = [...new Set(codes)].filter((c) => !sb1Map.has(c));
    const salesmanCode = input.salesmanCode || matchedSalesman || env.PROTHEUS_DEFAULT_SALESMAN;
    const branchId = input.branchId || '0101';
    const description = (ctx.dealTitle || ctx.quoteTitle || `PROPOSTA BITRIX - ${ctx.customer.name}`).trim();

    const cnpjDetails = fiscal.companyDetails;
    const customer = {
      name: ctx.customer.name || cnpjDetails.legalName || 'CLIENTE BITRIX',
      shortName: ctx.customer.shortName || cnpjDetails.tradeName || cnpjDetails.legalName,
      cnpj: fiscal.cnpj,
      email: ctx.customer.email || cnpjDetails.email,
      phone: ctx.customer.phone || cnpjDetails.phone,
      address: ctx.customer.address || cnpjDetails.address,
      neighborhood: ctx.customer.neighborhood || cnpjDetails.neighborhood,
      city: ctx.customer.city || cnpjDetails.city,
      cityCode: cnpjDetails.cityIbgeCode,
      state: ctx.customer.state || cnpjDetails.state || fiscal.uf,
      zipCode: ctx.customer.zipCode || cnpjDetails.zipCode,
      stateRegistration: ctx.customer.stateRegistration || cnpjDetails.stateRegistration || (fiscal.isExempt ? 'ISENTO' : undefined),
    };

    const flowInput: ProtheusOpportunityProposalFlowInput = {
      branchId,
      dealId: ctx.dealId ? String(ctx.dealId) : String(ctx.quoteId),
      description,
      salesmanCode,
      conditionPayment: input.conditionPayment || env.PROTHEUS_DEFAULT_PAYMENT_TERM,
      priceTable: tableResolution.tableId,
      deliveryDays: input.deliveryDays || env.PROTHEUS_DEFAULT_DELIVERY_DAYS,
      freightType: input.freightType || ((env.PROTHEUS_DEFAULT_FREIGHT_TYPE as 'C' | 'F') || 'C'),
      customer,
      items: details.map((d, idx) => ({
        item: String(idx + 1).padStart(2, '0'),
        productCode: d.code,
        quantity: d.quantity,
        unitPrice: d.newPrice,
      })),
    };

    return {
      flowInput,
      preCheck: {
        customerFoundInSa1: Boolean(existingCustomer),
        sa1Customer: existingCustomer,
        productsFoundInSb1: [...sb1Map.keys()],
        missingProductsInSb1,
        salesmanCode,
        priceTableSelected: tableResolution.tableId,
        priceTableCoveredAll: tableResolution.coveredAll,
        matchingPriceTables: tableResolution.matchingTables,
      },
    };
  }
}

export const quotePricingService = new QuotePricingService();
