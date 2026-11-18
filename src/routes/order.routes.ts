import { Router } from 'express';
import { orderController } from '../controllers/order.controller';

const orderRoutes = Router();

/**
 * Rota acionada pelo Webhook do Bitrix24 quando o orçamento é aprovado/gerado
 * POST /webhook/bitrix/create-order
 */
orderRoutes.post('/webhook/bitrix/create-order', orderController.createOrderFromBitrixWebhook);

export { orderRoutes };

