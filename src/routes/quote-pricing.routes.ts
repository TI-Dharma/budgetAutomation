import { Router } from 'express';
import { quotePricingController } from '../controllers/quote-pricing.controller';

const quotePricingRoutes = Router();
const handler = quotePricingController.processQuote.bind(quotePricingController);

/**
 * Rota unificada Bitrix24 ➔ TOTVS Protheus:
 * 1. Recebe o gatilho mínimo (ID do orçamento ou card de negócio)
 * 2. Busca orçamento, card de negócio vinculado, empresa e produtos no Bitrix + cruza CNPJ
 * 3. Calcula preços (CNPJ.ws + PostgreSQL dólar/priceRadios + margem + ICMS)
 * 4. Atualiza preços no Bitrix24 e move etapa para "Preço Atualizado" (UC_1KJDXH)
 * 5. Valida cliente (SA1) e produtos (SB1/DA1) e cria Oportunidade (AD1) + Proposta Comercial (ADY/ADZ) no TOTVS Protheus
 *
 * POST /webhook/bitrix/quote/process                -> executa tudo (Bitrix + TOTVS)
 * POST /webhook/bitrix/quote/process?dryRun=true    -> só simula/valida (sem gravar em nenhum sistema)
 * POST /webhook/bitrix/quote/process?skipProtheus=true -> atualiza só o Bitrix24
 */
quotePricingRoutes.post('/webhook/bitrix/quote/process', handler);

/** Alias da rota anterior (compatibilidade) */
quotePricingRoutes.post('/webhook/bitrix/update-quote-prices', handler);

export { quotePricingRoutes };
