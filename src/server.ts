import express, { Request, Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { orderRoutes } from './routes/order.routes';
import { quotePricingRoutes } from './routes/quote-pricing.routes';
import { testRoutes } from './routes/test.routes';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
// Suporte a application/x-www-form-urlencoded (formato padrão dos webhooks de saída do Bitrix24)
app.use(express.urlencoded({ extended: true }));

// Rota de Healthcheck
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'bitrix-protheus-integration',
    timestamp: new Date().toISOString(),
  });
});

// Rotas da aplicação
app.use(testRoutes);
app.use(orderRoutes);
app.use(quotePricingRoutes);

// Inicialização do Servidor
app.listen(env.PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${env.PORT}`);
  console.log(`🧪 Rota de teste: http://localhost:${env.PORT}/teste`);
  console.log(`🔗 Webhook Protheus direto: http://localhost:${env.PORT}/webhook/bitrix/create-order`);
  console.log(`🔗 Webhook unificado (Bitrix + TOTVS): http://localhost:${env.PORT}/webhook/bitrix/quote/process`);
});

export { app };

