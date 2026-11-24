import { env } from '../config/env';
import { cnpjService, CnpjFiscalInfo } from './cnpj.service';
import {
  fiscalService,
  PaymentConditionResolution,
  TesResolutionResult,
} from './fiscal.service';
import {
  bitrixQuoteService,
  BitrixProductRowInput,
} from './bitrix-quote.service';
import {
  quoteContextService,
  QuoteContext,
  extractProductCode,
  formatCleanQuoteProductName,
} from './quote-context.service';
import {
  protheusService,
  ProtheusCustomer,
  ProtheusOpportunityRecord,
  AdzSavedProposalItem,
} from './protheus.service';
import { salesmanService } from './salesman.service';

export interface Stage1OpportunityInput {
  quoteId?: number;
  dealId?: number;
  cnpj?: string;
  branchId?: string;
  description?: string;
  salesmanCode?: string;
  process?: string;
  stage?: string;
  customer?: {
    name?: string;
    shortName?: string;
    cnpj?: string;
    email?: string;
    phone?: string;
    address?: string;
    neighborhood?: string;
    city?: string;
    cityCode?: string;
    state?: string;
    zipCode?: string;
    stateRegistration?: string;
  };
  dryRun?: boolean;
}

export interface ProposalItemInput {
  item?: string;
  productId?: number;
  productName?: string;
  productCode: string;
  quantity: number;
  operationType?: string;
  outflowType?: string;
  conditionPayment?: string;
}

export interface Stage2ProposalInput {
  quoteId?: number;
  dealId?: number;
  opportunityId?: string;
  cnpj?: string;
  branchId?: string;
  salesmanCode?: string;
  conditionPayment?: string;
  priceTable?: string;
  operationType?: string;
  deliveryDays?: string;
  freightType?: 'C' | 'F';
  items?: ProposalItemInput[];
  dryRun?: boolean;
  skipBitrixUpdate?: boolean;
}

export class BitrixProtheusFlowService {
  /**
   * ===========================================================================
   * ETAPA 1 — Rota de Entrada / Oportunidade (POST /webhook/bitrix/opportunity)
   * ===========================================================================
   * 1. Recebe o identificador do orçamento/negócio do Bitrix (ou payload direto via Postman com CNPJ).
   * 2. Consulta o CNPJ na cnpj.ws (UF e Inscrição Estadual/Isenção) e verifica na SA1 do Protheus
   *    se o cliente existe; se não existir, cadastra automaticamente via MATA030.
   * 3. Cria a Oportunidade de Venda (AD1) no Protheus (WSCROPP.prw / FATA300) e captura o opportunityId.
   * 4. Amarração: se vier de um orçamento do Bitrix, salva o opportunityId no orçamento no Bitrix.
   */
  public async processStage1Opportunity(input: Stage1OpportunityInput) {
    let ctx: QuoteContext | null = null;

    if (input.quoteId || input.dealId) {
      ctx = await quoteContextService.resolve({
        quoteId: input.quoteId,
        dealId: input.dealId,
        cnpj: input.cnpj || input.customer?.cnpj,
      });
    }

    const rawCnpj = String(
      ctx?.cnpj || input.cnpj || input.customer?.cnpj || ''
    ).replace(/\D/g, '');

    if (rawCnpj.length !== 14) {
      throw new Error(
        'CNPJ do cliente não encontrado ou inválido. Informe um CNPJ de 14 dígitos no payload ou vincule uma Empresa com CNPJ ao orçamento no Bitrix24.'
      );
    }

    // 1. Consulta fiscal e cadastral na cnpj.ws
    const fiscal: CnpjFiscalInfo = await cnpjService.getFiscalInfo(rawCnpj);
    const cnpjDetails = fiscal.companyDetails;

    const branchId = String(input.branchId || env.PROTHEUS_DEFAULT_BRANCH || '0101').trim();
    if (branchId !== '0101' && branchId !== '0202') {
      throw new Error(`Filial inválida: "${branchId}". Permitidas: 0101 (DHARMACOM) e 0202 (DHARMASERV).`);
    }

    // 2. Consolida dados do cliente (Payload > Bitrix > CNPJ.ws)
    const customerPayload = {
      name:
        input.customer?.name ||
        ctx?.customer.name ||
        cnpjDetails.legalName ||
        'CLIENTE BITRIX',
      shortName:
        input.customer?.shortName ||
        ctx?.customer.shortName ||
        cnpjDetails.tradeName ||
        cnpjDetails.legalName,
      cnpj: fiscal.cnpj,
      email: input.customer?.email || ctx?.customer.email || cnpjDetails.email,
      phone: input.customer?.phone || ctx?.customer.phone || cnpjDetails.phone,
      address: input.customer?.address || ctx?.customer.address || cnpjDetails.address,
      neighborhood:
        input.customer?.neighborhood || ctx?.customer.neighborhood || cnpjDetails.neighborhood,
      city: input.customer?.city || ctx?.customer.city || cnpjDetails.city,
      cityCode: input.customer?.cityCode || cnpjDetails.cityIbgeCode,
      state: input.customer?.state || ctx?.customer.state || cnpjDetails.state || fiscal.uf,
      zipCode: input.customer?.zipCode || ctx?.customer.zipCode || cnpjDetails.zipCode,
      stateRegistration:
        input.customer?.stateRegistration ||
        ctx?.customer.stateRegistration ||
        cnpjDetails.stateRegistration ||
        (fiscal.isExempt ? 'ISENTO' : undefined),
    };

    // 3. Resolve vendedor via src/config/vendedores.json (nome no payload > campo Responsável TOTVS > usuário Bitrix > padrão)
    const salesmanResolution = salesmanService.resolve({
      payloadInput: input.salesmanCode,
      quoteFieldInput: ctx?.salesmanFromBitrix,
      assignedUserName: ctx?.assignedUserName,
      assignedUserEmail: ctx?.assignedUserEmail,
    });
    const matchedSalesman = salesmanResolution.code;

    const description = String(
      input.description ||
        ctx?.dealTitle ||
        ctx?.quoteTitle ||
        `OPORTUNIDADE BITRIX - ${customerPayload.name}`
    ).trim();

    // Modo simulação (dryRun): consulta SA1 sem gravar nada
    if (input.dryRun) {
      const existingCustomer = await protheusService.findCustomerByCnpj(fiscal.cnpj);
      return {
        dryRun: true as const,
        stage: 'ETAPA_1_OPORTUNIDADE',
        branchId,
        fiscal: {
          cnpj: fiscal.cnpj,
          uf: fiscal.uf,
          isExempt: fiscal.isExempt,
          stateRegistration: customerPayload.stateRegistration,
        },
        customer: existingCustomer
          ? { ...existingCustomer, existsInSa1: true, wouldCreateInSa1: false }
          : { ...customerPayload, existsInSa1: false, wouldCreateInSa1: true },
        opportunityPreview: {
          branchId,
          description,
          salesmanCode: matchedSalesman,
          salesmanName: salesmanResolution.name,
          salesmanMatchedBy: salesmanResolution.matchedBy,
          process: input.process || env.PROTHEUS_DEFAULT_PROCESS,
          stage: input.stage || env.PROTHEUS_DEFAULT_STAGE,
        },
        bitrix: ctx
          ? {
              quoteId: ctx.quoteId,
              quoteTitle: ctx.quoteTitle,
              dealId: ctx.dealId,
              cnpjSource: ctx.cnpjSource,
              cnpjCrossCheck: ctx.cnpjCrossCheck,
            }
          : null,
      };
    }

    // 4. Garante o cliente na SA1 (consulta por CNPJ e cadastra via MATA030 se não existir)
    const { customer: sa1Customer, createdNow } = await protheusService.ensureCustomer(customerPayload);

    // 5. Cria a Oportunidade de Venda (AD1 / FATA300)
    const opportunity = await protheusService.createOpportunity({
      branchId,
      customerCode: sa1Customer.code,
      storeId: sa1Customer.storeId,
      description,
      salesmanCode: matchedSalesman,
      process: input.process || env.PROTHEUS_DEFAULT_PROCESS,
      stage: input.stage || env.PROTHEUS_DEFAULT_STAGE,
    });

    // 6. Amarração no Bitrix24 (salva opportunityId e código do vendedor em Responsável TOTVS no orçamento e na timeline)
    let bitrixBinding: { quoteUpdated: boolean; dealUpdated: boolean; fieldUsed: string | null } | null = null;
    if (ctx?.quoteId) {
      bitrixBinding = await bitrixQuoteService.saveOpportunityBinding({
        quoteId: ctx.quoteId,
        dealId: ctx.dealId,
        opportunityId: opportunity.opportunityId,
        branchId,
        customerCode: sa1Customer.code,
        storeId: sa1Customer.storeId,
        customerName: sa1Customer.name,
        salesmanCode: salesmanResolution.code,
        salesmanName: salesmanResolution.name,
      });
    }

    return {
      dryRun: false as const,
      stage: 'ETAPA_1_OPORTUNIDADE',
      opportunityId: opportunity.opportunityId,
      revision: opportunity.revision,
      branchId,
      description,
      salesmanCode: matchedSalesman,
      salesmanName: salesmanResolution.name,
      salesmanMatchedBy: salesmanResolution.matchedBy,
      fiscal: {
        cnpj: fiscal.cnpj,
        uf: fiscal.uf,
        isExempt: fiscal.isExempt,
        stateRegistration: customerPayload.stateRegistration,
      },
      customer: {
        ...sa1Customer,
        createdNow,
      },
      bitrix: ctx
        ? {
            quoteId: ctx.quoteId,
            quoteTitle: ctx.quoteTitle,
            dealId: ctx.dealId,
            dealTitle: ctx.dealTitle,
            cnpjSource: ctx.cnpjSource,
            cnpjCrossCheck: ctx.cnpjCrossCheck,
            binding: bitrixBinding,
          }
        : null,
    };
  }

  /**
   * ===========================================================================
   * ETAPA 2 — Proposta Comercial e Precificação Nativa (POST /webhook/bitrix/proposal)
   * ===========================================================================
   * 1. Identifica a Oportunidade (AD1): explícita no payload, salva no Bitrix na Etapa 1,
   *    ou busca no Protheus a última Oportunidade ativa (AD1) vinculada ao CNPJ do cliente.
   * 2. Aplica a Matriz Fiscal (fiscal.service.ts):
   *    - Calcula a TES (ADZ_TES) por item conforme Filial (0101 vs 0202), UF, Isenção,
   *      exceção de Material sem ST (CAPA/CLIP/BATERIA/RÁDIO MÓVEL) e Operação Especial.
   *    - Traduz a Condição de Pagamento (SE4) enviada no webhook (texto ou código).
   * 3. Cria a Proposta Comercial (ADY/ADZ via FATA600 / WSCROPP.prw) SEM enviar preço unitário,
   *    deixando o Protheus aplicar o preço da tabela (DA1) e regras fiscais nativamente.
   * 4. Lê os itens gravados na ADZ no Protheus (ADZ_PRCVEN), atualiza os produtos do orçamento
   *    no Bitrix24 (crm.item.productrow.set) e move o orçamento para "Preço Atualizado" (UC_1KJDXH).
   */
  public async processStage2Proposal(input: Stage2ProposalInput) {
    let ctx: QuoteContext | null = null;

    if (input.quoteId || input.dealId) {
      ctx = await quoteContextService.resolve({
        quoteId: input.quoteId,
        dealId: input.dealId,
        cnpj: input.cnpj,
      });
    }

    const rawBranchFromCtx = ctx?.branchFromBitrix
      ? ctx.branchFromBitrix === '3450' || /0202|serv/i.test(ctx.branchFromBitrix)
        ? '0202'
        : '0101'
      : undefined;

    const requestedBranch = input.branchId
      ? String(input.branchId).trim()
      : rawBranchFromCtx;

    const effectiveOperationType = input.operationType || ctx?.operationTypeFromBitrix || undefined;

    if (requestedBranch && requestedBranch !== '0101' && requestedBranch !== '0202') {
      throw new Error(`Filial inválida: "${requestedBranch}". Permitidas: 0101 (DHARMACOM) e 0202 (DHARMASERV).`);
    }

    const rawCnpj = String(ctx?.cnpj || input.cnpj || '').replace(/\D/g, '');

    // 1. Identificação da Oportunidade (AD1) e Cliente (SA1)
    let opportunityRecord: ProtheusOpportunityRecord | null = null;
    let opportunityResolutionMethod = '';
    let sa1Customer: ProtheusCustomer | null = null;

    // 1A. opportunityId explícito no payload
    if (input.opportunityId) {
      opportunityRecord = await protheusService.findOpportunityById(
        input.opportunityId,
        requestedBranch
      );
      if (!opportunityRecord) {
        throw new Error(
          `Oportunidade "${input.opportunityId}" não encontrada na tabela AD1 do Protheus${
            requestedBranch ? ` (filial ${requestedBranch})` : ''
          }.`
        );
      }
      opportunityResolutionMethod = 'payload.opportunityId';
    }

    // 1B. opportunityId salvo no campo do orçamento/negócio no Bitrix24 durante a Etapa 1
    if (rawCnpj.length === 14) {
      sa1Customer = await protheusService.findCustomerByCnpj(rawCnpj);
    }

    if (!opportunityRecord && ctx?.linkedTotvsId) {
      const candidateId = String(ctx.linkedTotvsId).trim();
      if (/^\d{5,6}$/.test(candidateId)) {
        const foundFromBitrix = await protheusService.findOpportunityById(
          candidateId,
          requestedBranch
        );
        // Garante que o ID salvo pertence ao mesmo cliente do CNPJ do orçamento (evita colisão caso o campo já tenha recebido o número da proposta ADY_PROPOS)
        if (
          foundFromBitrix &&
          (!sa1Customer || foundFromBitrix.customerCode === sa1Customer.code)
        ) {
          opportunityRecord = foundFromBitrix;
          opportunityResolutionMethod = `bitrix.${env.BITRIX_QUOTE_TOTVS_ID_FIELD}`;
        }
      }
    }

    // 1C. Busca no Protheus a última Oportunidade ativa (AD1) vinculada ao CNPJ do cliente
    if (!opportunityRecord) {
      if (rawCnpj.length !== 14) {
        throw new Error(
          'Para localizar a Oportunidade automaticamente na Etapa 2, informe o `opportunityId`, o `quoteId` do Bitrix24 ou o `cnpj` (14 dígitos) do cliente.'
        );
      }
      const latestByCnpj = await protheusService.findLatestActiveOpportunityByCnpj(
        rawCnpj,
        requestedBranch
      );
      if (!latestByCnpj) {
        throw new Error(
          `Nenhuma Oportunidade ativa (AD1) encontrada no Protheus para o CNPJ ${rawCnpj}${
            requestedBranch ? ` na filial ${requestedBranch}` : ''
          }. Execute primeiro a Etapa 1 (POST /webhook/bitrix/opportunity).`
        );
      }
      opportunityRecord = latestByCnpj.opportunity;
      sa1Customer = latestByCnpj.customer;
      opportunityResolutionMethod = 'protheus.latestActiveByCnpj';
    }

    const branchId = requestedBranch || opportunityRecord.branchId || env.PROTHEUS_DEFAULT_BRANCH || '0101';

    if (!sa1Customer && rawCnpj.length === 14) {
      sa1Customer = await protheusService.findCustomerByCnpj(rawCnpj);
    }

    // 2. Dados Fiscais (UF e Isenção via cnpj.ws, com fallback para SA1 se CNPJ não informado no teste direto por opportunityId)
    let uf = sa1Customer?.state || '';
    let isExempt = false;
    let resolvedCnpj = rawCnpj || sa1Customer?.cnpj || '';

    if (resolvedCnpj.length === 14) {
      try {
        const fiscalInfo = await cnpjService.getFiscalInfo(resolvedCnpj);
        uf = fiscalInfo.uf;
        isExempt = fiscalInfo.isExempt;
      } catch (err: any) {
        console.warn(`[Stage2Proposal] Aviso ao consultar cnpj.ws (${err.message}). Usando dados da SA1.`);
        if (!uf) throw err;
        const ie = String(sa1Customer?.stateRegistration || '').trim().toUpperCase();
        isExempt = !ie || ie === 'ISENTO' || ie === 'ISENTA';
      }
    } else if (uf) {
      const ie = String(sa1Customer?.stateRegistration || '').trim().toUpperCase();
      isExempt = !ie || ie === 'ISENTO' || ie === 'ISENTA';
    } else {
      throw new Error(
        `Não foi possível determinar a UF/regime fiscal do cliente da Oportunidade ${opportunityRecord.opportunityId}. Informe o CNPJ no payload.`
      );
    }

    // 3. Mapeamento da Condição de Pagamento (SE4) — sem cálculo por faixa de valor
    const rawPaymentCondition =
      input.conditionPayment ?? ctx?.paymentConditionFromBitrix ?? undefined;
    const paymentResolution: PaymentConditionResolution =
      fiscalService.resolvePaymentCondition(rawPaymentCondition);

    // 4. Monta lista de produtos (do payload ou das linhas do orçamento no Bitrix24)
    const rawItems: ProposalItemInput[] =
      Array.isArray(input.items) && input.items.length > 0
        ? input.items.map((it, idx) => ({
            item: it.item || String(idx + 1).padStart(2, '0'),
            productId: it.productId,
            productName: it.productName,
            productCode:
              extractProductCode(it.productCode || it.productName || '') ||
              String(it.productCode || '').trim(),
            quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
            operationType: it.operationType || input.operationType,
            outflowType: it.outflowType,
            conditionPayment: it.conditionPayment,
          }))
        : await Promise.all(
            (ctx?.rows || []).map(async (row, idx) => {
              let code = extractProductCode(row.productName, row.xmlId);
              if (!code && row.productName) {
                code = (await bitrixQuoteService.resolveProductCodeByDescription(row.productName)) || '';
              }
              return {
                item: String(idx + 1).padStart(2, '0'),
                productId: Number(row.productId),
                productName: String(row.productName || ''),
                productCode: code || String(row.productName || '').trim(),
                quantity: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
                operationType: input.operationType,
              };
            })
          );

    if (rawItems.length === 0) {
      throw new Error(
        'Nenhum produto encontrado para gerar a Proposta Comercial. Adicione produtos ao orçamento no Bitrix24 ou envie o array `items` no payload.'
      );
    }

    // 5. Consulta os produtos na SB1 do Protheus (descrição oficial para regra de Material sem ST e validação)
    const productCodes = rawItems.map((i) => i.productCode);
    const sb1Map = await protheusService.findProductsByCodes(productCodes);

    const missingInSb1 = [...new Set(productCodes)].filter((code) => !sb1Map.has(code));
    if (missingInSb1.length > 0) {
      throw new Error(
        `Os seguintes produtos não foram encontrados na tabela SB1 do Protheus: ${missingInSb1.join(', ')}.`
      );
    }

    // 6. Aplica a Matriz Fiscal (TES por item)
    const itemsWithFiscal = rawItems.map((it, idx) => {
      const sb1 = sb1Map.get(it.productCode)!;
      if (sb1.blocked) {
        throw new Error(
          `Produto "${sb1.code}" (${sb1.description}) está bloqueado na tabela SB1 do Protheus (B1_MSBLQL = 1).`
        );
      }

      const itemCondResolution = it.conditionPayment
        ? fiscalService.resolvePaymentCondition(it.conditionPayment)
        : paymentResolution;

      const tesResolution: TesResolutionResult = fiscalService.resolveTes({
        branchId,
        uf,
        isExempt,
        productCode: sb1.code,
        productDescription: sb1.description,
        productType: sb1.type,
        operationType: it.operationType || effectiveOperationType,
        explicitTes: it.outflowType,
      });

      const previewTax = fiscalService.calculateItemTaxesFallback({
        uf,
        isExempt,
        tes: tesResolution.tes,
        productOrigin: sb1.origin,
        productPicm: sb1.picm,
        productMva: sb1.mva,
        unitPrice: 0,
        quantity: it.quantity,
      });

      return {
        item: it.item || String(idx + 1).padStart(2, '0'),
        bitrixProductId: it.productId,
        bitrixProductName: it.productName || `${sb1.code} - ${sb1.description}`,
        productCode: sb1.code,
        description: sb1.description,
        unitOfMeasure: sb1.unitOfMeasure,
        warehouse: sb1.warehouse,
        ncm: sb1.ncm,
        previewCst: previewTax.cst,
        previewIcmsRate: previewTax.icmsRate,
        quantity: it.quantity,
        conditionPayment: itemCondResolution.code,
        outflowType: tesResolution.tes,
        fiscalRule: tesResolution,
      };
    });

    // 7. Seleciona a Tabela de Preço ativa (DA0/DA1)
    const preferredTables = fiscalService.getPreferredPriceTables({
      branchId,
      uf,
      isExempt,
      operationType: effectiveOperationType,
      primaryTes: itemsWithFiscal[0]?.outflowType,
    });

    const tableResolution = input.priceTable
      ? {
          tableId: String(input.priceTable).trim(),
          coveredAll: true,
          matchingTables: [String(input.priceTable).trim()],
          pricesByProduct: await protheusService.getProductPricesInTable(
            productCodes,
            String(input.priceTable).trim()
          ),
        }
      : await protheusService.resolvePriceTableForProducts(productCodes, preferredTables);

    const salesmanResolution = salesmanService.resolve({
      payloadInput: input.salesmanCode,
      quoteFieldInput: ctx?.salesmanFromBitrix,
      assignedUserName: ctx?.assignedUserName,
      assignedUserEmail: ctx?.assignedUserEmail,
      fallbackCode: opportunityRecord.salesmanCode || env.PROTHEUS_DEFAULT_SALESMAN,
    });
    const salesmanCode = salesmanResolution.code;

    const rawDeliveryFromCtx = ctx?.deliveryDaysFromBitrix
      ? (ctx.deliveryDaysFromBitrix.match(/(\d+)/)?.[1] ?? ctx.deliveryDaysFromBitrix)
      : '';
    const deliveryDays = String(
      input.deliveryDays || rawDeliveryFromCtx || env.PROTHEUS_DEFAULT_DELIVERY_DAYS || '10'
    ).trim();

    const rawFreightFromCtx = ctx?.freightTypeFromBitrix
      ? ctx.freightTypeFromBitrix === '3466' || /fob|cliente/i.test(ctx.freightTypeFromBitrix)
        ? 'F'
        : 'C'
      : '';
    const freightType = (input.freightType ||
      rawFreightFromCtx ||
      env.PROTHEUS_DEFAULT_FREIGHT_TYPE ||
      'C') as 'C' | 'F';

    // Modo simulação (dryRun): mostra exatamente a Matriz Fiscal, Tabela DA1 e Payload que seria enviado ao FATA600
    if (input.dryRun) {
      return {
        dryRun: true as const,
        stage: 'ETAPA_2_PROPOSTA_PRECIFICACAO_NATIVA',
        opportunity: {
          ...opportunityRecord,
          resolutionMethod: opportunityResolutionMethod,
        },
        fiscalMatrix: {
          branchId,
          cnpj: resolvedCnpj,
          uf,
          isExempt,
          taxRegime: isExempt ? 'ISENTO / NÃO CONTRIBUINTE' : 'CONTRIBUINTE ICMS',
          paymentCondition: paymentResolution,
          priceTableSelected: tableResolution.tableId,
          priceTableCoveredAll: tableResolution.coveredAll,
          preferredPriceTables: preferredTables,
        },
        itemsPreview: itemsWithFiscal.map((it) => {
          const previewPrice = Number(tableResolution.pricesByProduct[it.productCode] ?? 0);
          const sb1 = sb1Map.get(it.productCode);
          const simTax = fiscalService.calculateItemTaxesFallback({
            uf,
            isExempt,
            tes: it.outflowType,
            productOrigin: sb1?.origin,
            productPicm: sb1?.picm,
            productMva: sb1?.mva,
            unitPrice: previewPrice,
            quantity: it.quantity,
          });
          return {
            item: it.item,
            productCode: it.productCode,
            description: it.description,
            quantity: it.quantity,
            ncm: it.ncm,
            cst: simTax.cst,
            icmsRate: simTax.icmsRate,
            icmsFormatted: `${simTax.icmsRate}%`,
            unitPricePreview: previewPrice,
            stUnitValuePreview: simTax.stUnitValue,
            stUnitFormatted: simTax.stUnitValue.toFixed(2).replace('.', ','),
            totalValuePreview: Number((previewPrice * it.quantity).toFixed(2)),
            tes: it.outflowType,
            cfopReference: it.fiscalRule.cfopReference,
            ruleApplied: it.fiscalRule.ruleApplied,
            isMaterialWithoutSt: it.fiscalRule.isMaterialWithoutSt,
            conditionPayment: it.conditionPayment,
          };
        }),
      };
    }

    // 8. Cria a Proposta Comercial no Protheus (ADY/ADZ via FATA600) SEM enviar unitPrice
    const proposalResult = await protheusService.createCommercialProposal({
      branchId,
      opportunityId: opportunityRecord.opportunityId,
      opportunityRevision: opportunityRecord.revision,
      customerCode: opportunityRecord.customerCode,
      storeId: opportunityRecord.storeId,
      salesmanCode,
      conditionPayment: paymentResolution.code,
      priceTable: tableResolution.tableId,
      deliveryDays,
      freightType,
      uf,
      isExempt,
      items: itemsWithFiscal.map((it) => ({
        item: it.item,
        productCode: it.productCode,
        description: it.description,
        unitOfMeasure: it.unitOfMeasure,
        quantity: it.quantity,
        conditionPayment: it.conditionPayment,
        outflowType: it.outflowType,
      })),
    });

    // 9. Cruza os itens gravados na ADZ (ADZ_PRCVEN + NCM + CST + ICMS + ST) com os produtos do orçamento
    const adzByItem = new Map<string, AdzSavedProposalItem>();
    const adzByCode = new Map<string, AdzSavedProposalItem>();
    for (const adzItem of proposalResult.savedAdzItems) {
      if (adzItem.item) adzByItem.set(adzItem.item.padStart(2, '0'), adzItem);
      if (adzItem.productCode && !adzByCode.has(adzItem.productCode)) {
        adzByCode.set(adzItem.productCode, adzItem);
      }
    }

    const pricedItems = itemsWithFiscal.map((sent) => {
      const adzMatch =
        adzByItem.get(sent.item.padStart(2, '0')) || adzByCode.get(sent.productCode);
      const unitPrice = Number(
        adzMatch?.unitPrice ?? tableResolution.pricesByProduct[sent.productCode] ?? 0
      );
      const priceTableValue = Number(
        adzMatch?.priceTableValue ?? tableResolution.pricesByProduct[sent.productCode] ?? unitPrice
      );
      const totalValue = Number(
        adzMatch?.totalValue ?? Math.round(unitPrice * sent.quantity * 100) / 100
      );
      const ncm = adzMatch?.ncm || sent.ncm || '';
      const cst = adzMatch?.cst || sent.previewCst || '000';
      const icmsRate = Number(adzMatch?.icmsRate ?? sent.previewIcmsRate ?? 0);
      const icmsValue = Number(adzMatch?.icmsValue ?? Number(((totalValue * icmsRate) / 100).toFixed(2)));
      const stUnitValue = Number(adzMatch?.stUnitValue ?? 0);
      const stTotalValue = Number(adzMatch?.stTotalValue ?? Number((stUnitValue * sent.quantity).toFixed(2)));

      return {
        item: sent.item,
        bitrixProductId: sent.bitrixProductId,
        bitrixProductName: sent.bitrixProductName,
        productCode: sent.productCode,
        description: sent.description,
        unitOfMeasure: sent.unitOfMeasure,
        quantity: sent.quantity,
        ncm,
        cst,
        icmsRate,
        icmsFormatted: `${icmsRate}%`,
        icmsValue,
        unitPrice,
        unitPriceFormatted: (Math.round((unitPrice + Number.EPSILON) * 100) / 100)
          .toFixed(2)
          .replace('.', ','),
        stUnitValue,
        stUnitFormatted: stUnitValue.toFixed(2).replace('.', ','),
        stTotalValue,
        priceTableValue,
        totalValue,
        tes: adzMatch?.outflowType || sent.outflowType,
        cfopReference: sent.fiscalRule.cfopReference,
        fiscalRuleApplied: sent.fiscalRule.ruleApplied,
        conditionPayment: adzMatch?.conditionPayment || sent.conditionPayment,
      };
    });

    // 10. Atualiza no Bitrix24:
    //     A) Linhas de produto do orçamento (crm.item.productrow.set)
    //     B) Campos fiscais nos produtos do catálogo (crm.product.update: NCM, CST, ICMS, Valor Uni ST)
    //     C) Campos do orçamento na seção "DADOS COMPLEMENTOS" (Proposta TOTVS, Validade da Proposta, etc.) e etapa "Preço Atualizado"
    let bitrixUpdateResult: {
      updated: boolean;
      quoteId?: number;
      statusId?: string;
      statusName?: string;
      totalValue?: number;
      quoteFieldsUpdated?: Record<string, any>;
      catalogProductsUpdated?: any[];
    } = { updated: false };

    if (ctx?.quoteId && !input.skipBitrixUpdate) {
      const bitrixProductRows: BitrixProductRowInput[] = pricedItems.map((pi, idx) => {
        const originalRow = ctx!.rows[idx];
        const productId = Number(pi.bitrixProductId ?? originalRow?.productId ?? 0);
        // Remove o "<CODIGO> - " do nome na linha do orçamento (mantendo apenas o nome/descrição do produto para o PDF, sem alterar o nome no catálogo crm.product)
        const productName = formatCleanQuoteProductName(
          originalRow?.productName || pi.bitrixProductName,
          pi.productCode,
          pi.description
        );

        const unitPrice = Math.round((pi.unitPrice + Number.EPSILON) * 100) / 100;
        const stUnitValue = Math.round((pi.stUnitValue + Number.EPSILON) * 100) / 100;
        const priceWithSt = Math.round((unitPrice + stUnitValue + Number.EPSILON) * 100) / 100;

        return {
          productId,
          productName,
          price: priceWithSt,
          quantity: pi.quantity,
          discountTypeId: 2,
          discountRate: 0,
          discountSum: 0,
          xmlId: pi.productCode,
        };
      });

      const [, catalogProductsUpdated, { statusId, statusName }] = await Promise.all([
        bitrixQuoteService.setQuoteProductRows(ctx.quoteId, bitrixProductRows),
        bitrixQuoteService.updateCatalogProductsFiscalData(
          pricedItems.map((pi, idx) => ({
            productCode: pi.productCode,
            rowProductId: Number(pi.bitrixProductId ?? ctx!.rows[idx]?.productId ?? 0) || undefined,
            ncm: pi.ncm,
            cst: pi.cst,
            icmsFormatted: pi.icmsFormatted,
            stUnitFormatted: pi.stUnitFormatted,
            unitPriceFormatted: pi.unitPriceFormatted,
          }))
        ),
        bitrixQuoteService.resolvePriceUpdatedStatusId(),
      ]);

      const extraQuoteFields: Record<string, any> = {
        CLOSEDATE: proposalResult.validityDate,
      };
      if (env.BITRIX_QUOTE_PROPOSAL_FIELD) {
        extraQuoteFields[env.BITRIX_QUOTE_PROPOSAL_FIELD] = proposalResult.opportunityId;
      }
      if (env.BITRIX_QUOTE_TOTVS_ID_FIELD) {
        extraQuoteFields[env.BITRIX_QUOTE_TOTVS_ID_FIELD] = proposalResult.opportunityId;
      }
      if (env.BITRIX_QUOTE_VALIDITY_DATE_FIELD) {
        extraQuoteFields[env.BITRIX_QUOTE_VALIDITY_DATE_FIELD] = proposalResult.validityDate;
      }
      if (env.BITRIX_QUOTE_VALIDITY_TEXT_FIELD) {
        extraQuoteFields[env.BITRIX_QUOTE_VALIDITY_TEXT_FIELD] = proposalResult.validityDateBr;
      }
      if (env.BITRIX_QUOTE_PAYMENT_TOTVS_FIELD) {
        extraQuoteFields[env.BITRIX_QUOTE_PAYMENT_TOTVS_FIELD] = `${paymentResolution.code} - ${paymentResolution.label}`;
      }
      if (env.BITRIX_QUOTE_FREIGHT_TOTVS_FIELD) {
        extraQuoteFields[env.BITRIX_QUOTE_FREIGHT_TOTVS_FIELD] =
          freightType === 'F' ? 'FOB (Por conta do Cliente)' : 'CIF (Por conta da Dharma)';
      }
      if (env.BITRIX_QUOTE_SALESMAN_TOTVS_FIELD && salesmanResolution.code) {
        extraQuoteFields[env.BITRIX_QUOTE_SALESMAN_TOTVS_FIELD] = salesmanResolution.code;
      }

      await bitrixQuoteService.updateQuoteStatus(ctx.quoteId, statusId, extraQuoteFields);

      if (ctx.dealId && env.BITRIX_DEAL_TOTVS_ID_FIELD) {
        await bitrixQuoteService.updateDealFields(ctx.dealId, {
          [env.BITRIX_DEAL_TOTVS_ID_FIELD]: proposalResult.opportunityId,
        });
      }

      const totalProducts =
        Math.round(pricedItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0) * 100) / 100;
      const totalSt =
        Math.round(pricedItems.reduce((acc, it) => acc + it.stUnitValue * it.quantity, 0) * 100) / 100;
      const totalCalculated = Math.round((totalProducts + totalSt) * 100) / 100;

      const summaryComment = [
        `✅ [TOTVS Protheus - Etapa 2: Proposta Comercial e Precificação Concluídas]`,
        `• Proposta Comercial (ADY): ${proposalResult.proposalId} (Revisão ${proposalResult.proposalRevision})`,
        `• Validade da Proposta (SCJ): ${proposalResult.validityDateBr} (${proposalResult.validityDate})`,
        `• Oportunidade (AD1): ${proposalResult.opportunityId} | Orçamento (SCJ): ${proposalResult.budgetId || 'N/A'}`,
        `• Filial: ${branchId} | UF: ${uf} (${isExempt ? 'Isento' : 'Contribuinte'})`,
        `• Tabela de Preço (DA0): ${tableResolution.tableId} | Condição Pagto (SE4): ${paymentResolution.code} (${paymentResolution.label})`,
        `• Itens precificados pelo Protheus (ADZ/SCK/SB1):`,
        ...pricedItems.map(
          (i) =>
            `  - ${i.productCode} | NCM: ${i.ncm} | CST: ${i.cst} | ICMS: ${i.icmsFormatted} | Qtd: ${i.quantity} | Vlr Unit: R$ ${i.unitPrice.toFixed(2)} | Vlr Uni ST: R$ ${i.stUnitFormatted} | Total c/ ST: R$ ${(
              (i.unitPrice + i.stUnitValue) * i.quantity
            ).toFixed(2)} (TES ${i.tes})`
        ),
        `• Subtotal Produtos (sem ST): R$ ${totalProducts.toFixed(2)}`,
        `• Total ST: R$ ${totalSt.toFixed(2)}`,
        `• Valor Total Final (Produtos + ST): R$ ${totalCalculated.toFixed(2)}`,
      ].join('\n');

      await bitrixQuoteService.addTimelineComment('quote', ctx.quoteId, summaryComment);

      bitrixUpdateResult = {
        updated: true,
        quoteId: ctx.quoteId,
        statusId,
        statusName,
        totalValue: totalCalculated,
        quoteFieldsUpdated: extraQuoteFields,
        catalogProductsUpdated,
      };
    }

    return {
      dryRun: false as const,
      stage: 'ETAPA_2_PROPOSTA_PRECIFICACAO_NATIVA',
      proposalId: proposalResult.proposalId,
      proposalRevision: proposalResult.proposalRevision,
      validityDate: proposalResult.validityDate,
      validityDateBr: proposalResult.validityDateBr,
      opportunityId: proposalResult.opportunityId,
      opportunityResolutionMethod,
      budgetId: proposalResult.budgetId ?? null,
      branchId,
      fiscalMatrix: {
        cnpj: resolvedCnpj,
        uf,
        isExempt,
        taxRegime: isExempt ? 'ISENTO / NÃO CONTRIBUINTE' : 'CONTRIBUINTE ICMS',
        paymentCondition: paymentResolution,
        priceTable: tableResolution.tableId,
        priceTableCoveredAll: tableResolution.coveredAll,
      },
      items: pricedItems,
      bitrix: bitrixUpdateResult,
      bitrixFieldMapping: {
        quoteFields: {
          propostaTotvs: env.BITRIX_QUOTE_PROPOSAL_FIELD,
          propostaTotvsLegacy: env.BITRIX_QUOTE_TOTVS_ID_FIELD,
          validadePropostaDate: env.BITRIX_QUOTE_VALIDITY_DATE_FIELD,
          validadePropostaString: env.BITRIX_QUOTE_VALIDITY_TEXT_FIELD,
          condicaoPagamentoTotvs: env.BITRIX_QUOTE_PAYMENT_TOTVS_FIELD,
          freteTotvs: env.BITRIX_QUOTE_FREIGHT_TOTVS_FIELD,
        },
        productProperties: {
          cod: env.BITRIX_PRODUCT_CODE_PROP,
          ncm: env.BITRIX_PRODUCT_NCM_PROP,
          cst: env.BITRIX_PRODUCT_CST_PROP,
          icms: env.BITRIX_PRODUCT_ICMS_PROP,
          valorUniSt: env.BITRIX_PRODUCT_ST_UNIT_PROP,
          uniPrice: env.BITRIX_PRODUCT_UNIT_PRICE_PROP,
        },
      },
    };
  }
}

export const bitrixProtheusFlowService = new BitrixProtheusFlowService();
