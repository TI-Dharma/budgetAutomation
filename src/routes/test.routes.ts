import { Router, Request, Response } from 'express';
import axios from 'axios';
import { env } from '../config/env';
import { quotePricingEnv } from '../config/quote-pricing.env';
import { pricingRepository } from '../services/pricing.repository';
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
 * Opcional: GET /teste?check=true para testar também PostgreSQL, Bitrix24 e TOTVS Protheus.
 */
testRoutes.get('/teste', async (req: Request, res: Response) => {
  const runDeepCheck = ['true', '1'].includes(String(req.query.check ?? '').toLowerCase());

  const basePayload = {
    success: true,
    message: 'API funcionando corretamente!',
    service: 'bitrix-protheus-integration',
    port: env.PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    endpoints: {
      teste: 'GET /teste (adicione ?check=true para testar Banco, Bitrix24 e Protheus)',
      testeWebhook: 'POST /teste (ecoa o JSON recebido para testar chamadas de webhook)',
      health: 'GET /health',
      unifiedQuote: 'POST /webhook/bitrix/quote/process (adicione ?dryRun=true para simular)',
      createOrder: 'POST /webhook/bitrix/create-order',
    },
  };

  if (!runDeepCheck) {
    res.status(200).json(basePayload);
    return;
  }

  const [postgres, bitrix24, protheus] = await Promise.all([
    measureCheck(async () => {
      const dollarRate = await pricingRepository.getDollarRate();
      return { dollarRate };
    }),
    measureCheck(async () => {
      const { data } = await axios.post(
        `${quotePricingEnv.bitrixWebhookUrl}crm.quote.list.json`,
        { start: -1, select: ['ID'] },
        { timeout: 6000 }
      );
      if (data?.error) throw new Error(`${data.error}: ${data.error_description || ''}`);
      return { quotesSampleCount: Array.isArray(data?.result) ? data.result.length : 0 };
    }),
    measureCheck(async () => {
      const found = await protheusService.findProductsByCodes(['HKLN4606']);
      return { sb1QueryOk: true, sampleFound: found.has('HKLN4606') };
    }),
  ]);

  const allOk = postgres.ok && bitrix24.ok && protheus.ok;

  res.status(allOk ? 200 : 207).json({
    ...basePayload,
    success: allOk,
    message: allOk
      ? 'API e todas as integrações (PostgreSQL, Bitrix24 e Protheus) estão funcionando!'
      : 'API online, mas uma ou mais integrações falharam na verificação.',
    integrations: {
      postgres,
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
