import {
  CreateProtheusCustomerDTO,
  ProtheusSalesItemDTO,
} from './protheus.service';

export interface IncomingWebhookOpportunityPayload {
  dealId?: string;
  branchId: string;
  description: string;
  salesmanCode?: string;
  process?: string;
  stage?: string;
  conditionPayment?: string;
  priceTable?: string;
  deliveryDays?: string;
  freightType?: 'C' | 'F';
  customer: CreateProtheusCustomerDTO;
  items: ProtheusSalesItemDTO[];
}

/**
 * Serviço utilitário local (ZERO chamadas HTTP externas ao Bitrix24).
 * Responsável apenas por normalizar e validar o payload JSON recebido diretamente no `req.body`
 * via Postman ou Webhook para criação de Oportunidade de Venda no Protheus.
 */
export class BitrixPayloadNormalizerService {
  public parseWebhookBody(body: Record<string, any>): IncomingWebhookOpportunityPayload {
    if (!body || typeof body !== 'object') {
      throw new Error('Corpo da requisição (req.body) vazio ou inválido.');
    }

    const fields = body.data?.FIELDS || body.fields || body.data || {};
    const rawCustomer = body.customer || body.cliente || body.header || fields.customer || fields.COMPANY || fields || body;
    const rawItems: any[] = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.itens)
        ? body.itens
        : Array.isArray(body.products)
          ? body.products
          : Array.isArray(body.produtos)
            ? body.produtos
            : Array.isArray(fields.items)
              ? fields.items
              : [];

    const cnpj = String(
      rawCustomer.cnpj ??
        rawCustomer.CNPJ ??
        rawCustomer.A1_CGC ??
        rawCustomer.COMPANY_UF_CRM_1714413693 ??
        fields.COMPANY_UF_CRM_1714413693 ??
        fields.UF_CRM_1714413693 ??
        fields.cnpj ??
        fields.CNPJ ??
        body.cnpj ??
        body.CNPJ ??
        ''
    ).replace(/\D/g, '');

    if (!cnpj) {
      throw new Error(
        'CNPJ do cliente é obrigatório no payload (ex: `customer.cnpj` ou `cnpj`).'
      );
    }

    const name = String(
      rawCustomer.name ??
        rawCustomer.nome ??
        rawCustomer.razaoSocial ??
        rawCustomer.A1_NOME ??
        rawCustomer.COMPANY_TITLE ??
        fields.COMPANY_TITLE ??
        body.customerName ??
        body.name ??
        body.nome ??
        'CLIENTE PADRAO'
    ).trim();

    const parsedItems: ProtheusSalesItemDTO[] = rawItems.map((rawItem, index) => {
      const productCode = String(
        rawItem.productCode ??
          rawItem.productid ??
          rawItem.codigoProduto ??
          rawItem.code ??
          rawItem.B1_COD ??
          rawItem.ADZ_PRODUT ??
          rawItem.CK_PRODUTO ??
          rawItem.C6_PRODUTO ??
          rawItem.PRODUCT_ID ??
          ''
      ).trim();

      const quantity = Number(
        rawItem.quantity ??
          rawItem.quantidade ??
          rawItem.ADZ_QTDVEN ??
          rawItem.CK_QTDVEN ??
          rawItem.QUANTITY ??
          1
      );
      const unitPrice = Number(
        rawItem.unitPrice ??
          rawItem.unitprice ??
          rawItem.precoUnitario ??
          rawItem.price ??
          rawItem.ADZ_PRCVEN ??
          rawItem.CK_PRCVEN ??
          rawItem.PRICE ??
          0
      );

      const rawTes =
        rawItem.outflowType ?? rawItem.outflowtype ?? rawItem.tes ?? rawItem.ADZ_TES;
      const rawCondPg =
        rawItem.conditionPayment ?? rawItem.condicaoPagamento ?? rawItem.ADZ_CONDPG;

      return {
        item: rawItem.item ?? rawItem.itemid ?? rawItem.ADZ_ITEM ?? String(index + 1).padStart(2, '0'),
        productCode,
        description: rawItem.description ?? rawItem.descricao ?? rawItem.ADZ_DESCRI,
        unitOfMeasure: rawItem.unitOfMeasure ?? rawItem.um ?? rawItem.ADZ_UM,
        quantity: quantity > 0 ? quantity : 1,
        unitPrice: !Number.isNaN(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
        discount: Number(rawItem.discount ?? rawItem.ADZ_DESCON ?? 0),
        conditionPayment: rawCondPg ? String(rawCondPg).trim() : undefined,
        outflowType: rawTes ? String(rawTes).trim() : undefined,
        operation: String(rawItem.operation ?? rawItem.operacao ?? '01').trim(),
      };
    });

    const dealId =
      body.dealId || body.externalReference || body.externalid || body.id || fields.ID
        ? String(body.dealId ?? body.externalReference ?? body.externalid ?? body.id ?? fields.ID)
        : undefined;

    const branchId = String(
      body.branchId ?? body.filial ?? body.AD1_FILIAL ?? '0101'
    ).trim();

    const companyTitle = rawCustomer.COMPANY_TITLE || fields.COMPANY_TITLE || name;
    const description = String(
      body.description ??
        body.descricao ??
        body.AD1_DESCRI ??
        (companyTitle ? `PROPOSTA - ${companyTitle}` : `PROPOSTA - OPORTUNIDADE BITRIX`)
    ).trim();

    const rawFreight = String(
      body.freightType ?? body.tipoFrete ?? body.frete ?? body.ADY_ZZFRT ?? 'C'
    ).trim().toUpperCase();
    const freightType: 'C' | 'F' = rawFreight === 'F' ? 'F' : 'C';

    const rawDeliveryDays =
      body.deliveryDays ?? body.prazoEntrega ?? body.ADY_ZZPRAZ;

    return {
      dealId,
      branchId,
      description,
      salesmanCode: body.salesmanCode ?? fields.ASSIGNED_BY_ID ?? body.sellerid ?? body.vendedor ?? body.AD1_VEND,
      process: body.process ?? body.processo ?? body.AD1_PROVEN,
      stage: body.stage ?? body.estagio ?? body.AD1_STAGE,
      conditionPayment:
        body.conditionPayment ??
        body.condicaoPagamento ??
        body.paymentconditionid ??
        body.ADY_CONDPG ??
        body.CJ_CONDPAG,
      priceTable:
        body.priceTable ??
        body.tabelaPreco ??
        body.pricelistid ??
        body.ADY_TABELA ??
        body.CJ_TABELA,
      deliveryDays: rawDeliveryDays !== undefined ? String(rawDeliveryDays).trim() : undefined,
      freightType,
      customer: {
        name,
        shortName: rawCustomer.shortName ?? rawCustomer.nomeFantasia ?? rawCustomer.A1_NREDUZ,
        cnpj,
        personType:
          rawCustomer.personType ?? rawCustomer.tipoPessoa ?? (cnpj.length === 11 ? 'F' : 'J'),
        email: rawCustomer.email ?? rawCustomer.A1_EMAIL,
        phone: rawCustomer.phone ?? rawCustomer.telefone ?? rawCustomer.A1_TEL,
        address: rawCustomer.address ?? rawCustomer.endereco ?? rawCustomer.A1_END,
        neighborhood: rawCustomer.neighborhood ?? rawCustomer.bairro ?? rawCustomer.A1_BAIRRO,
        city: rawCustomer.city ?? rawCustomer.cidade ?? rawCustomer.A1_MUN,
        cityCode: rawCustomer.cityCode ?? rawCustomer.codMunicipio ?? rawCustomer.A1_COD_MUN,
        state: rawCustomer.state ?? rawCustomer.uf ?? rawCustomer.A1_EST,
        zipCode: rawCustomer.zipCode ?? rawCustomer.cep ?? rawCustomer.A1_CEP,
        stateRegistration:
          rawCustomer.stateRegistration ?? rawCustomer.inscricaoEstadual ?? rawCustomer.A1_INSCR,
      },
      items: parsedItems,
    };
  }
}

export const bitrixPayloadNormalizer = new BitrixPayloadNormalizerService();
