import { Request, Response } from 'express';
import { quotePricingService, ProcessQuoteInput } from '../services/quote-pricing.service';

const lastNumber = (v: any): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const m = String(v).match(/(\d+)\s*$/); // "94", "Q_94", "QUOTE_94", "DEAL_66814"
  return m ? Number(m[1]) : undefined;
};

/**
 * Extrai do webhook o gatilho mínimo (ID do orçamento ou card de negócio) e overrides opcionais.
 * O restante (card vinculado, empresa, CNPJ, endereço, produtos) é buscado e cruzado no Bitrix24.
 */
export function parseQuoteWebhook(body: any): ProcessQuoteInput {
  const src = body?.['Bundle 1'] ?? body?.bundle ?? body ?? {};
  const docRef = String(Array.isArray(src.document_id) ? src.document_id[2] : src.document_id?.[2] ?? '');
  const itemRef = String(src.id_item_crm ?? '');

  const isDealDoc = /^DEAL_/i.test(docRef) || /^D_/i.test(itemRef);

  let quoteId: number | undefined;
  let dealId: number | undefined = lastNumber(src.dealId ?? src.deal_id ?? body?.dealId);

  if (isDealDoc) {
    dealId = dealId ?? lastNumber(docRef) ?? lastNumber(itemRef) ?? lastNumber(src.id);
  } else {
    quoteId = lastNumber(src.quoteId ?? body?.quoteId) ?? lastNumber(src.id ?? body?.id) ?? lastNumber(itemRef) ?? lastNumber(docRef);
  }

  if (!quoteId && !dealId) {
    throw new Error('Gatilho inválido: informe o ID do orçamento (id, "Q_94", "QUOTE_94") ou do negócio (dealId, "DEAL_123").');
  }

  const cnpj = String(src.cnpj ?? body?.cnpj ?? '').replace(/\D/g, '') || undefined;
  const rawFreight = String(src.freightType ?? body?.freightType ?? '').trim().toUpperCase();

  return {
    quoteId,
    dealId,
    cnpj,
    branchId: src.branchId ?? body?.branchId,
    salesmanCode: src.salesmanCode ?? body?.salesmanCode,
    conditionPayment: src.conditionPayment ?? body?.conditionPayment,
    priceTable: src.priceTable ?? body?.priceTable,
    deliveryDays: src.deliveryDays ?? body?.deliveryDays,
    freightType: rawFreight === 'F' ? 'F' : rawFreight === 'C' ? 'C' : undefined,
  };
}

export class QuotePricingController {
  public async processQuote(req: Request, res: Response): Promise<void> {
    console.log('================================================================');
    console.log('[QuotePricingController] Webhook unificado recebido:', JSON.stringify(req.body));

    let input: ProcessQuoteInput;
    try {
      input = parseQuoteWebhook(req.body);
      input.dryRun = String(req.query.dryRun ?? '').toLowerCase() === 'true';
      input.skipProtheus = String(req.query.skipProtheus ?? '').toLowerCase() === 'true';
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }

    try {
      const result = await quotePricingService.processQuote(input);
      res.status(result.dryRun ? 200 : 201).json({
        success: true,
        message: result.dryRun
          ? 'Simulação concluída (dryRun): nenhum dado foi gravado no Bitrix24 ou no Protheus.'
          : result.protheus?.created
            ? 'Orçamento atualizado no Bitrix24 e Oportunidade/Proposta gravadas no TOTVS Protheus com sucesso.'
            : 'Preços do orçamento atualizados no Bitrix24 com sucesso.',
        data: result,
      });
    } catch (error: any) {
      console.error('[QuotePricingController] ❌', error.message);
      res.status(error?.response?.status || 500).json({
        success: false,
        message: 'Falha no fluxo unificado Bitrix24 ➔ TOTVS Protheus.',
        error: error.message,
        trigger: { quoteId: input.quoteId, dealId: input.dealId },
        partialResult: error?.partialResult ?? null,
        protheusResponseData: error?.response?.data ?? null,
      });
    }
  }
}

export const quotePricingController = new QuotePricingController();
