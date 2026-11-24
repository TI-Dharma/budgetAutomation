import { Router } from 'express';
import { bitrixWebhookController } from '../controllers/bitrix-webhook.controller';

const bitrixWebhookRoutes = Router();

/**
 * ETAPA 1 — Rota de Entrada / Oportunidade (quando o orçamento entra em Rascunho no Bitrix24)
 * 1. Consulta o CNPJ na cnpj.ws (UF e Inscrição Estadual/Isenção)
 * 2. Verifica o cliente na tabela SA1 do Protheus (se não existir, cadastra via MATA030)
 * 3. Cria a Oportunidade de Venda (AD1) no Protheus (WSCROPP.prw / FATA300)
 * 4. Salva o opportunityId gerado no orçamento do Bitrix24
 *
 * POST /webhook/bitrix/opportunity
 * POST /webhook/bitrix/opportunity?dryRun=true (simula sem gravar)
 */
bitrixWebhookRoutes.post(
  '/webhook/bitrix/opportunity',
  bitrixWebhookController.handleOpportunityStage1
);

/**
 * ETAPA 2 — Rota de Proposta Comercial e Precificação Nativa no ERP
 * 1. Identifica a Oportunidade (explícita, salva no Bitrix ou última AD1 ativa do CNPJ no Protheus)
 * 2. Aplica a Matriz Fiscal (TES por Filial 0101/0202, UF, Isenção, Material sem ST e Condição SE4)
 * 3. Cria a Proposta Comercial (ADY/ADZ via FATA600 / WSCROPP.prw) SEM enviar preço unitário
 * 4. Lê os preços unitários calculados pelo Protheus na tabela ADZ (ADZ_PRCVEN),
 *    atualiza os itens do orçamento no Bitrix24 e move para "Preço Atualizado" (UC_1KJDXH)
 *
 * POST /webhook/bitrix/proposal
 * POST /webhook/bitrix/proposal?dryRun=true (simula Matriz Fiscal e Tabela sem gravar)
 */
bitrixWebhookRoutes.post(
  '/webhook/bitrix/proposal',
  bitrixWebhookController.handleProposalStage2
);

export { bitrixWebhookRoutes };
