import { Request, Response } from 'express';
import {
  bitrixProtheusFlowService,
  Stage1OpportunityInput,
  Stage2ProposalInput,
  ProposalItemInput,
} from '../services/bitrix-protheus-flow.service';
import { bitrixQuoteService } from '../services/bitrix-quote.service';
import { translateIntegrationError } from '../services/error-translator.service';

function normalizeBranchInput(raw: any): string | undefined {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return undefined;
  if (s === '3450' || s.includes('0202') || s.includes('DHARMASERV') || s.includes('SERV')) return '0202';
  if (s === '3448' || s.includes('0101') || s.includes('DHARMACOM') || s.includes('COM')) return '0101';
  return s;
}

function normalizeFreightInput(raw: any): 'C' | 'F' | undefined {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return undefined;
  if (s === 'F' || s === '3466' || s.includes('FOB') || s.includes('DESTINAT') || s.includes('CLIENTE')) return 'F';
  if (s === 'C' || s === '3464' || s.includes('CIF') || s.includes('EMITENT') || s.includes('REMETENT') || s.includes('DHARMA')) return 'C';
  return undefined;
}

function normalizeDeliveryDaysInput(raw: any): string | undefined {
  const s = String(raw ?? '').trim();
  if (!s) return undefined;
  if (/imediato/i.test(s)) return '1';
  const m = s.match(/(\d+)/);
  return m ? m[1] : s;
}

const lastNumber = (v: any): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const m = String(v).match(/(\d+)\s*$/); // "94", "Q_94", "QUOTE_94", "DEAL_66814"
  return m ? Number(m[1]) : undefined;
};

function extractTriggerIds(body: any): { quoteId?: number; dealId?: number; src: any } {
  const src = body?.['Bundle 1'] ?? body?.bundle ?? body ?? {};
  const docRef = String(
    Array.isArray(src.document_id) ? src.document_id[2] : src.document_id?.[2] ?? ''
  );
  const itemRef = String(src.id_item_crm ?? '');
  const isDealDoc = /^DEAL_/i.test(docRef) || /^D_/i.test(itemRef);

  let quoteId: number | undefined = lastNumber(src.quoteId ?? src.quote_id ?? body?.quoteId);
  let dealId: number | undefined = lastNumber(src.dealId ?? src.deal_id ?? body?.dealId);

  if (isDealDoc) {
    dealId = dealId ?? lastNumber(docRef) ?? lastNumber(itemRef) ?? lastNumber(src.id);
  } else {
    quoteId =
      quoteId ??
      lastNumber(src.id ?? body?.id) ??
      lastNumber(itemRef) ??
      lastNumber(docRef);
  }

  return { quoteId, dealId, src };
}

export function parseStage1Body(body: any): Stage1OpportunityInput {
  const { quoteId, dealId, src } = extractTriggerIds(body);
  const rawCustomer = src.customer ?? body?.customer ?? {};
  const cnpj =
    String(
      src.cnpj ??
        body?.cnpj ??
        rawCustomer.cnpj ??
        src.CNPJ ??
        body?.CNPJ ??
        ''
    ).replace(/\D/g, '') || undefined;

  if (!quoteId && !dealId && !cnpj) {
    throw new Error(
      'Payload inválido para Etapa 1 (Oportunidade): informe o ID do orçamento no Bitrix (`quoteId` / `id` / `Q_94`), o `dealId` ou o `cnpj` (14 dígitos) do cliente.'
    );
  }

  return {
    quoteId,
    dealId,
    cnpj,
    branchId: normalizeBranchInput(src.branchId ?? src.filial ?? body?.branchId ?? body?.filial),
    description: src.description ?? src.descricao ?? body?.description ?? body?.descricao,
    salesmanCode:
      src.vendedor ??
      src.salesman ??
      src.salesmanName ??
      src.responsavelTotvs ??
      src.responsavel ??
      src.salesmanCode ??
      body?.vendedor ??
      body?.salesman ??
      body?.responsavelTotvs ??
      body?.salesmanCode,
    process: src.process ?? body?.process,
    stage: src.stage ?? body?.stage,
    customer: {
      name: rawCustomer.name ?? rawCustomer.nome ?? src.customerName ?? body?.customerName,
      shortName: rawCustomer.shortName ?? rawCustomer.nomeFantasia,
      cnpj,
      email: rawCustomer.email ?? src.email,
      phone: rawCustomer.phone ?? rawCustomer.telefone ?? src.phone,
      address: rawCustomer.address ?? rawCustomer.endereco,
      neighborhood: rawCustomer.neighborhood ?? rawCustomer.bairro,
      city: rawCustomer.city ?? rawCustomer.cidade,
      cityCode: rawCustomer.cityCode ?? rawCustomer.codigoMunicipio,
      state: rawCustomer.state ?? rawCustomer.uf,
      zipCode: rawCustomer.zipCode ?? rawCustomer.cep,
      stateRegistration: rawCustomer.stateRegistration ?? rawCustomer.inscricaoEstadual,
    },
  };
}

export function parseStage2Body(body: any): Stage2ProposalInput {
  const { quoteId, dealId, src } = extractTriggerIds(body);
  const cnpj =
    String(
      src.cnpj ??
        body?.cnpj ??
        src.customer?.cnpj ??
        body?.customer?.cnpj ??
        ''
    ).replace(/\D/g, '') || undefined;

  const opportunityId =
    String(
      src.opportunityId ??
        src.numeroOportunidade ??
        src.AD1_NROPOR ??
        body?.opportunityId ??
        ''
    ).trim() || undefined;

  if (!quoteId && !dealId && !opportunityId && !cnpj) {
    throw new Error(
      'Payload inválido para Etapa 2 (Proposta Comercial): informe `quoteId` (ou `id` do orçamento no Bitrix), `opportunityId` ou `cnpj` do cliente.'
    );
  }

  const rawItemsList =
    Array.isArray(src.items)
      ? src.items
      : Array.isArray(src.itens)
        ? src.itens
        : Array.isArray(src.products)
          ? src.products
          : Array.isArray(body?.items)
            ? body.items
            : undefined;

  const items: ProposalItemInput[] | undefined = rawItemsList
    ? rawItemsList.map((it: any, idx: number) => ({
        item: it.item ?? String(idx + 1).padStart(2, '0'),
        productId: it.productId ? Number(it.productId) : undefined,
        productName: it.productName ?? it.name,
        productCode: String(
          it.productCode ?? it.codigoProduto ?? it.code ?? it.ADZ_PRODUT ?? it.B1_COD ?? ''
        ).trim(),
        quantity: Number(it.quantity ?? it.quantidade ?? it.ADZ_QTDVEN ?? 1),
        operationType: it.operationType ?? it.tipoOperacao,
        outflowType: it.outflowType ?? it.tes ?? it.ADZ_TES,
        conditionPayment: it.conditionPayment ?? it.condicaoPagamento ?? it.ADZ_CONDPG,
      }))
    : undefined;

  const freightType = normalizeFreightInput(
    src.freightType ?? src.tipoFrete ?? body?.freightType
  );

  return {
    quoteId,
    dealId,
    opportunityId,
    cnpj,
    branchId: normalizeBranchInput(src.branchId ?? src.filial ?? body?.branchId ?? body?.filial),
    salesmanCode:
      src.vendedor ??
      src.salesman ??
      src.salesmanName ??
      src.responsavelTotvs ??
      src.responsavel ??
      src.salesmanCode ??
      body?.vendedor ??
      body?.salesman ??
      body?.responsavelTotvs ??
      body?.salesmanCode,
    conditionPayment:
      src.conditionPayment ??
      src.condicaoPagamento ??
      src.paymentCondition ??
      body?.conditionPayment ??
      body?.condicaoPagamento,
    priceTable: src.priceTable ?? src.tabelaPreco ?? body?.priceTable ?? body?.tabelaPreco,
    operationType:
      src.operationType ?? src.tipoOperacao ?? body?.operationType ?? body?.tipoOperacao,
    deliveryDays: normalizeDeliveryDaysInput(
      src.deliveryDays ?? src.prazoEntrega ?? body?.deliveryDays ?? body?.prazoEntrega
    ),
    freightType,
    items,
  };
}

export class BitrixWebhookController {
  /**
   * POST /webhook/bitrix/opportunity
   * Etapa 1 — Valida/Cadastra Cliente (SA1) e Cria Oportunidade de Venda (AD1) no Protheus
   */
  public handleOpportunityStage1 = async (req: Request, res: Response): Promise<void> => {
    console.log('================================================================');
    console.log('[BitrixWebhookController][Etapa 1 - Oportunidade] Payload recebido:', JSON.stringify(req.body));

    let input: Stage1OpportunityInput | null = null;
    try {
      input = parseStage1Body(req.body);
      input.dryRun = String(req.query.dryRun ?? '').toLowerCase() === 'true';

      const result = await bitrixProtheusFlowService.processStage1Opportunity(input);

      res.status(result.dryRun ? 200 : 201).json({
        success: true,
        message: result.dryRun
          ? 'Simulação da Etapa 1 (dryRun) concluída com sucesso.'
          : `Cliente (${result.customer.code}/${result.customer.storeId}) e Oportunidade de Venda (${result.opportunityId}) processados com sucesso no TOTVS Protheus.`,
        data: result,
      });
    } catch (error: any) {
      await this.handleStageError(res, error, 'Etapa 1 - Oportunidade (SA1/AD1)', input?.quoteId, input?.dealId);
    }
  };

  /**
   * POST /webhook/bitrix/proposal
   * Etapa 2 — Aplica Matriz Fiscal, Cria Proposta Comercial (ADY/ADZ) com Precificação Nativa no Protheus
   *           e devolve os preços calculados (ADZ_PRCVEN) para o Bitrix24.
   */
  public handleProposalStage2 = async (req: Request, res: Response): Promise<void> => {
    console.log('================================================================');
    console.log('[BitrixWebhookController][Etapa 2 - Proposta Comercial] Payload recebido:', JSON.stringify(req.body));

    let input: Stage2ProposalInput | null = null;
    try {
      input = parseStage2Body(req.body);
      input.dryRun = String(req.query.dryRun ?? '').toLowerCase() === 'true';
      input.skipBitrixUpdate = String(req.query.skipBitrixUpdate ?? '').toLowerCase() === 'true';

      const result = await bitrixProtheusFlowService.processStage2Proposal(input);

      res.status(result.dryRun ? 200 : 201).json({
        success: true,
        message: result.dryRun
          ? 'Simulação da Etapa 2 (dryRun - Matriz Fiscal e Precificação) concluída com sucesso.'
          : `Proposta Comercial ${result.proposalId} criada no Protheus (Oportunidade ${result.opportunityId}) e preços atualizados no Bitrix24 com sucesso.`,
        data: result,
      });
    } catch (error: any) {
      await this.handleStageError(res, error, 'Etapa 2 - Proposta Comercial e Precificação (ADY/ADZ)', input?.quoteId, input?.dealId);
    }
  };

  /**
   * Tratamento centralizado de erros (Seção 4):
   * 1. Traduz a mensagem técnica
   * 2. Move o orçamento no Bitrix24 automaticamente para a coluna/aba "Erro" e registra o log
   * 3. Retorna JSON de erro estruturado
   */
  private async handleStageError(
    res: Response,
    error: any,
    stepName: string,
    quoteId?: number,
    dealId?: number
  ): Promise<void> {
    const translated = translateIntegrationError(error);
    console.error(`[BitrixWebhookController][❌ ${stepName}]`, translated.friendlyMessage, '| Técnico:', translated.technicalError);

    let resolvedQuoteId = quoteId;
    if (!resolvedQuoteId && dealId) {
      try {
        resolvedQuoteId = (await bitrixQuoteService.findLatestQuoteIdByDeal(dealId)) ?? undefined;
      } catch {
        // Ignora caso não consiga consultar o Bitrix
      }
    }

    const bitrixErrorHandling = await bitrixQuoteService.moveQuoteToErrorStage({
      quoteId: resolvedQuoteId,
      dealId,
      stepName,
      friendlyMessage: translated.friendlyMessage,
      technicalError: translated.technicalError,
      actionHint: translated.actionHint,
    });

    res.status(translated.httpStatus).json({
      success: false,
      step: stepName,
      message: translated.friendlyMessage,
      error: {
        code: translated.errorCode,
        friendlyMessage: translated.friendlyMessage,
        actionHint: translated.actionHint,
        technicalError: translated.technicalError,
      },
      trigger: {
        quoteId: resolvedQuoteId ?? null,
        dealId: dealId ?? null,
      },
      bitrixErrorStage: bitrixErrorHandling,
      protheusResponseData: error?.response?.data ?? null,
    });
  }
}

export const bitrixWebhookController = new BitrixWebhookController();
