import { Router, Request, Response } from 'express';
import { env } from '../config/env';
import { bitrixQuoteService } from '../services/bitrix-quote.service';
import { protheusService } from '../services/protheus.service';

const testRoutes = Router();

async function measureCheck<T>(fn: () => Promise<T>) {
  const start = Date.now();
  try {
    const details = await fn();
    return { ok: true, durationMs: Date.now() - start, details };
  } catch (error: any) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * GET /teste
 * Verifica rapidamente se a API está no ar.
 * Opcional: GET /teste?check=true para testar conectividade com Bitrix24 e TOTVS Protheus.
 */
testRoutes.get('/teste', async (req: Request, res: Response) => {
  const runDeepCheck = ['true', '1'].includes(String(req.query.check ?? '').toLowerCase());

  const basePayload = {
    success: true,
    message: 'API funcionando corretamente! (Arquitetura 2.0 - Precificação Nativa TOTVS Protheus + Matriz Fiscal)',
    service: 'bitrix-protheus-integration',
    version: '2.0.0',
    port: env.PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    endpoints: {
      health: 'GET /health',
      teste: 'GET /teste (adicione ?check=true para testar Bitrix24 e TOTVS Protheus)',
      testeWebhook: 'POST /teste (ecoa o JSON recebido para testar chamadas de webhook)',
      stage1Opportunity: 'POST /webhook/bitrix/opportunity (Etapa 1: Cliente SA1 + Oportunidade AD1)',
      stage2Proposal: 'POST /webhook/bitrix/proposal (Etapa 2: Matriz Fiscal + Proposta ADY/ADZ + Precificação Nativa)',
    },
  };

  if (!runDeepCheck) {
    res.status(200).json(basePayload);
    return;
  }

  const [bitrix24, protheus] = await Promise.all([
    measureCheck(async () => {
      const statuses = await bitrixQuoteService.listQuoteStatuses(true);
      const priceUpdated = await bitrixQuoteService.resolvePriceUpdatedStatusId();
      const errorStage = await bitrixQuoteService.resolveErrorStatusId();
      return {
        quoteStatusesCount: statuses.length,
        priceUpdatedStage: priceUpdated,
        errorStage,
      };
    }),
    measureCheck(async () => {
      const found = await protheusService.findProductsByCodes(['HKLN4606']);
      return {
        sb1QueryOk: true,
        sampleFound: found.has('HKLN4606'),
      };
    }),
  ]);

  const allOk = bitrix24.ok && protheus.ok;

  res.status(allOk ? 200 : 207).json({
    ...basePayload,
    success: allOk,
    message: allOk
      ? 'API e integrações (Bitrix24 e TOTVS Protheus) estão funcionando!'
      : 'API online, mas uma ou mais integrações falharam na verificação.',
    integrations: {
      bitrix24,
      protheus,
    },
  });
});

/**
 * POST /teste
 * Endpoint de eco para testar se webhooks do Bitrix24 ou requisições do Postman estão chegando na API.
 */
testRoutes.post('/teste', (req: Request, res: Response) => {
  console.log('[Route /teste] POST recebido:', JSON.stringify(req.body));
  res.status(200).json({
    success: true,
    message: 'POST recebido com sucesso na rota /teste!',
    timestamp: new Date().toISOString(),
    query: req.query,
    receivedBody: req.body,
  });
});

export { testRoutes };
