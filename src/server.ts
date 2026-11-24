import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { bitrixWebhookRoutes } from './routes/bitrix-webhook.routes';
import { testRoutes } from './routes/test.routes';
import { logRoutes } from './routes/log.routes';
import {
  initConsoleCapture,
  requestLoggerMiddleware,
} from './services/request-logger.service';

initConsoleCapture();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
// Suporte a application/x-www-form-urlencoded (formato padrão dos webhooks de saída do Bitrix24)
app.use(express.urlencoded({ extended: true }));

// Middleware que grava o log completo de cada requisição em logs/requests-log.json
app.use(requestLoggerMiddleware);

// Rota de Healthcheck
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'bitrix-protheus-integration',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Rotas da aplicação (Logs + Diagnóstico + 2 Etapas Bitrix24 <-> TOTVS Protheus)
app.use(logRoutes);
app.use(testRoutes);
app.use(bitrixWebhookRoutes);

// Inicialização do Servidor
app.listen(env.PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${env.PORT}`);
  console.log(`🩺 Healthcheck: http://localhost:${env.PORT}/health`);
  console.log(`📋 Logs JSON: http://localhost:${env.PORT}/log`);
  console.log(`🧪 Rota de teste: http://localhost:${env.PORT}/teste`);
  console.log(`1️⃣ Etapa 1 (Oportunidade AD1): http://localhost:${env.PORT}/webhook/bitrix/opportunity`);
  console.log(`2️⃣ Etapa 2 (Proposta ADY/ADZ + Precificação): http://localhost:${env.PORT}/webhook/bitrix/proposal`);
});

export { app };
