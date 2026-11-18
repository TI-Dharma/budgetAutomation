import { Request, Response } from 'express';
import { bitrixPayloadNormalizer } from '../services/bitrix.service';
import { protheusService } from '../services/protheus.service';

export class OrderController {
  /**
   * FLUXO PRINCIPAL:
   * Webhook Bitrix ➔ Cliente (SA1) ➔ Oportunidade (AD1) ➔ Proposta Comercial (ADY/ADZ)
   *
   * 1. Receber os dados do webhook (req.body).
   * 2. Garantir o cliente na tabela SA1 pelo CNPJ:
   *    - Consulta via GET /api/crm/v1/customerVendor/1?filter=A1_CGC eq '...'
   *    - Se não existir, cadastra automaticamente via POST /api/crm/v1/customerVendor (MATA030)
   * 3. Criar a Oportunidade de Venda vinculada a esse cliente no Protheus (FATA300 / AD1)
   *    e capturar o seu número oficial (opportunityId / AD1_NROPOR).
   * 4. Buscar as informações complementares de cada produto na tabela SB1 do Protheus
   *    (descrição B1_DESC, unidade B1_UM, armazém B1_LOCPAD, TES B1_TS) a partir apenas do código
   *    enviado pelo Bitrix e criar a Proposta Comercial (FATA600 / ADY + ADZ) vinculada à Oportunidade (ADY_OPORTU).
   */
  public createOrderFromBitrixWebhook = async (req: Request, res: Response): Promise<void> => {
    let parsedPayload;

    try {
      parsedPayload = bitrixPayloadNormalizer.parseWebhookBody(req.body);
    } catch (validationError: unknown) {
      const message =
        validationError instanceof Error ? validationError.message : String(validationError);
      res.status(400).json({
        success: false,
        message: 'Payload inválido.',
        error: message,
      });
      return;
    }

    const {
      customer,
      branchId,
      description,
      salesmanCode,
      process,
      stage,
      conditionPayment,
      priceTable,
      deliveryDays,
      freightType,
      items,
      dealId,
    } = parsedPayload;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Payload inválido para geração da Proposta Comercial.',
        error:
          'É obrigatório informar ao menos 1 produto no array `items` (contendo `productCode`, `quantity` e `unitPrice`).',
      });
      return;
    }

    try {
      console.log('================================================================');
      console.log('[OrderController] Iniciando fluxo Webhook ➔ Cliente (SA1) ➔ Oportunidade (AD1) ➔ Proposta Comercial (ADY/ADZ)...');

      const result = await protheusService.executeUnifiedOrderFlow({
        branchId,
        dealId,
        description,
        salesmanCode,
        process,
        stage,
        conditionPayment,
        priceTable,
        deliveryDays,
        freightType,
        customer,
        items,
      });

      console.log('================================================================');

      res.status(201).json({
        success: true,
        message:
          'Cliente, Oportunidade de Venda (AD1) e Proposta Comercial (ADY/ADZ) processados com sucesso no TOTVS Protheus.',
        data: result,
      });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        '[OrderController] ❌ Falha durante o processamento (Cliente ➔ Oportunidade ➔ Proposta Comercial) no Protheus:',
        errorMessage
      );
      console.log('================================================================');

      res.status(error?.response?.status || 500).json({
        success: false,
        message: 'Falha ao processar Oportunidade e Proposta Comercial no TOTVS Protheus.',
        error: errorMessage,
        protheusStatus: error?.response?.status ?? null,
        protheusResponseData: error?.response?.data ?? null,
      });
    }
  };

  /**
   * FLUXO STANDBY (CONGELADO PARA USO FUTURO):
   * Permite criar Pedido de Venda direto (SC5/SC6 via /api/tgv/salesorders)
   * ou Orçamento de Venda (SCJ/SCK via /api/tgv/salesbudgets).
   */
  public createSalesOrderStandby = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = bitrixPayloadNormalizer.parseWebhookBody(req.body);
      let customer = await protheusService.findCustomerByCnpj(parsed.customer.cnpj);
      if (!customer) {
        customer = await protheusService.createCustomer(parsed.customer);
      }

      const result = await protheusService.createSalesOrder({
        branchId: parsed.branchId,
        externalId: parsed.dealId,
        customerCode: customer.code,
        storeId: customer.storeId,
        conditionPayment: parsed.conditionPayment,
        priceTable: parsed.priceTable,
        salesmanCode: parsed.salesmanCode,
        items: parsed.items,
      });

      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      res.status(err?.response?.status || 500).json({ success: false, error: err.message });
    }
  };

  public createSalesBudgetStandby = async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = bitrixPayloadNormalizer.parseWebhookBody(req.body);
      let customer = await protheusService.findCustomerByCnpj(parsed.customer.cnpj);
      if (!customer) {
        customer = await protheusService.createCustomer(parsed.customer);
      }

      const result = await protheusService.createSalesBudget({
        branchId: parsed.branchId,
        externalId: parsed.dealId,
        customerCode: customer.code,
        storeId: customer.storeId,
        conditionPayment: parsed.conditionPayment,
        priceTable: parsed.priceTable,
        salesmanCode: parsed.salesmanCode,
        items: parsed.items,
      });

      res.status(201).json({ success: true, data: result });
    } catch (err: any) {
      res.status(err?.response?.status || 500).json({ success: false, error: err.message });
    }
  };
}

export const orderController = new OrderController();
