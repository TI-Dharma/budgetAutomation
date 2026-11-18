import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { env } from '../config/env';

export interface ProtheusCustomer {
  code: string;
  storeId: string;
  name: string;
  cnpj: string;
}

export interface CreateProtheusCustomerDTO {
  name: string;
  shortName?: string;
  cnpj: string;
  personType?: 'J' | 'F';
  email?: string;
  phone?: string;
  address?: string;
  neighborhood?: string;
  city?: string;
  cityCode?: string;
  state?: string;
  zipCode?: string;
  stateRegistration?: string;
}

export interface ProtheusSalesItemDTO {
  item?: string;
  productCode: string;
  description?: string;
  unitOfMeasure?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  conditionPayment?: string; // Condição de pagamento do item (ex: "043")
  outflowType?: string;      // TES (ex: "501")
  operation?: string;        // Tipo de Operação (ex: "01")
  customerOrder?: string;
}

export interface ProtheusProductInfo {
  code: string;
  description: string;
  unitOfMeasure: string;
  type: string;
  warehouse: string;
  defaultTes: string;
  basePrice: number;
}

export interface EnrichedProposalItem {
  item: string;
  productCode: string;
  description: string;
  unitOfMeasure: string;
  warehouse: string;
  quantity: number;
  unitPrice: number;
  priceList: number;
  totalValue: number;
  discount: number;
  conditionPayment: string;
  outflowType: string;
}

export type ProtheusSalesBudgetItemDTO = ProtheusSalesItemDTO;

/** Filiais habilitadas no Grupo Dharma */
export const ALLOWED_BRANCHES = ['0101', '0202'] as const;

export interface CreateProtheusSalesOrderDTO {
  branchId?: string;
  externalId?: string;
  customerCode: string;
  storeId: string;
  orderType?: 'N' | 'B' | 'D';
  conditionPayment?: string;
  priceTable?: string;
  salesmanCode?: string;
  typeOfOperation?: string;
  freightType?: 'C' | 'F' | 'T' | 'R' | 'D' | 'S';
  freight?: number;
  insurance?: number;
  expenses?: number;
  discount?: number;
  currencyId?: number;
  items: ProtheusSalesItemDTO[];
}

export interface ProtheusSalesOrderResponse {
  endpointUsed: '/api/tgv/salesorders' | '/api/tgv/salesbudgets';
  orderId?: string;
  budgetId?: string;
  externalId: string;
  rawResponse: unknown;
  salesOrdersAttemptError?: unknown;
}

export interface CreateProtheusOpportunityDTO {
  branchId: string;
  customerCode: string;
  storeId: string;
  description: string;
  salesmanCode?: string;
  process?: string;
  stage?: string;
  startDate?: string;
  priority?: string;
  status?: string;
}

export interface ProtheusOpportunityResponse {
  opportunityId: string;
  revision?: string;
  rawResponse?: unknown;
}

export interface CreateProtheusProposalDTO {
  branchId: string;
  opportunityId: string;
  opportunityRevision?: string;
  customerCode: string;
  storeId: string;
  salesmanCode?: string;
  conditionPayment?: string;
  priceTable?: string;
  deliveryDays?: string;
  freightType?: 'C' | 'F';
  items: ProtheusSalesItemDTO[];
}

export interface ProtheusProposalResponse {
  proposalId: string;
  proposalRevision: string;
  opportunityId: string;
  budgetId?: string;
  enrichedItems: EnrichedProposalItem[];
  rawResponse?: unknown;
}

export interface ProtheusOpportunityProposalFlowInput {
  branchId: string;
  dealId?: string;
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

export interface ProtheusOpportunityProposalFlowResult {
  opportunityId: string;
  opportunityRevision: string;
  proposalId: string;
  proposalRevision: string;
  budgetId: string | null;
  branchId: string;
  externalReference: string | null;
  customer: ProtheusCustomer & { createdNow: boolean };
  items: EnrichedProposalItem[];
  protheusResponse: {
    opportunity: unknown;
    proposal: unknown;
  };
}

export class ProtheusService {
  private readonly api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: env.PROTHEUS_API_URL,
      timeout: 30000,
      // Permite conexão HTTPS com certificados autoassinados (comum em servidores Protheus locais/internos)
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
      auth: {
        username: env.PROTHEUS_USER,
        password: env.PROTHEUS_PASS,
      },
      headers: {
        'TenantId': env.PROTHEUS_TENANT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Remove caracteres não numéricos do CNPJ/CPF
   */
  public sanitizeCnpj(cnpj: string): string {
    return String(cnpj || '').replace(/\D/g, '');
  }

  /**
   * Tratamento centralizado e detalhado de erros do Axios/Protheus
   */
  private handleProtheusError(error: any): never {
    console.error("================ ERRO COMPLETO DO PROTHEUS ================");
    if (error.response) {
      // O Protheus respondeu com um status de erro (ex: 500, 400, etc.)
      console.error("Status:", error.response.status);
      console.error("Headers de Resposta:", error.response.headers);
      console.error("Dados da Resposta (Body):", JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // A requisição foi feita mas não houve resposta
      console.error("Sem resposta do servidor:", error.request);
    } else {
      // Erro ao configurar a requisição
      console.error("Erro na configuração da requisição:", error.message);
    }
    console.error("==========================================================");
    throw error;
  }

  /**
   * Etapa 1A. Consultar Cliente no Protheus pelo CNPJ na tabela SA1
   * Utiliza genericQuery direto na tabela SA1 filtrando exatamente por A1_CGC = '${cleanCnpj}'
   * (pois a rota /api/crm/v1/customerVendor/1 ignora o filtro A1_CGC e retorna o primeiro registro da SA1).
   */
  public async findCustomerByCnpj(cnpj: string): Promise<ProtheusCustomer | null> {
    const cleanCnpj = this.sanitizeCnpj(cnpj);

    if (!cleanCnpj) {
      throw new Error('CNPJ inválido ou vazio para consulta na SA1 do Protheus.');
    }

    const fields = 'A1_FILIAL,A1_COD,A1_LOJA,A1_NOME,A1_NREDUZ,A1_CGC,A1_MSBLQL';
    const where = `A1_CGC = '${cleanCnpj}'`;
    const endpoint = `/api/framework/v1/genericQuery?tables=SA1&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=10`;
    console.log(`[ProtheusService][Passo 1 - Consulta Cliente] GET ${endpoint}`);

    try {
      const response = await this.api.get(endpoint);
      const items: any[] = Array.isArray(response.data?.items) ? response.data.items : [];

      // Garante correspondência exata do CNPJ/CPF (A1_CGC) e prioriza registro ativo (A1_MSBLQL != '1')
      const matchingRecords = items.filter((item) => {
        const recordCnpj = this.sanitizeCnpj(item.a1_cgc ?? item.A1_CGC ?? '');
        return recordCnpj === cleanCnpj;
      });

      const customerRecord =
        matchingRecords.find((item) => String(item.a1_msblql ?? item.A1_MSBLQL ?? '') !== '1') ||
        matchingRecords[0] ||
        null;

      if (!customerRecord) {
        return null;
      }

      return {
        code: String(customerRecord.a1_cod ?? customerRecord.A1_COD ?? customerRecord.code).trim(),
        storeId: String(customerRecord.a1_loja ?? customerRecord.A1_LOJA ?? customerRecord.storeId ?? '0001').trim(),
        name: String(customerRecord.a1_nome ?? customerRecord.A1_NOME ?? customerRecord.name ?? '').trim(),
        cnpj: cleanCnpj,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleProtheusError(error);
    }
  }

  /**
   * Etapa 1B. Cadastrar Cliente automaticamente no Protheus (SA1 / MATA030) caso não exista
   * Endpoint: POST ${PROTHEUS_API_URL}/api/crm/v1/customerVendor
   */
  public async createCustomer(customerData: CreateProtheusCustomerDTO): Promise<ProtheusCustomer> {
    const cleanCnpj = this.sanitizeCnpj(customerData.cnpj);
    const personType = customerData.personType ?? (cleanCnpj.length === 11 ? 'F' : 'J');

    const payload = {
      name: customerData.name,
      shortName: (customerData.shortName || customerData.name).substring(0, 20),
      cnpj: cleanCnpj,
      personType,
      email: customerData.email || '',
      phone: customerData.phone || '',
      address: customerData.address || 'ENDERECO NAO INFORMADO',
      neighborhood: customerData.neighborhood || 'CENTRO',
      city: customerData.city || 'SAO PAULO',
      cityCode: customerData.cityCode || '50308',
      state: customerData.state || 'SP',
      zipCode: String(customerData.zipCode || '01001000').replace(/\D/g, ''),
      stateRegistration: customerData.stateRegistration || 'ISENTO',
    };

    const endpoint = '/api/crm/v1/customerVendor';
    console.log(`[ProtheusService][Passo 1 - Cadastro Cliente] POST ${endpoint}`);
    console.log('Payload do Cliente:', JSON.stringify(payload, null, 2));

    try {
      const response = await this.api.post(endpoint, payload);
      const data = response.data;

      const code = String(data?.code ?? data?.A1_COD ?? '').trim();
      const storeId = String(data?.storeId ?? data?.A1_LOJA ?? '0001').trim();

      if (!code) {
        throw new Error(
          `Protheus não retornou o código do cliente (code/A1_COD). Resposta: ${JSON.stringify(data)}`
        );
      }

      return {
        code,
        storeId,
        name: customerData.name,
        cnpj: cleanCnpj,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * Etapa 2A. Criar Pedido de Venda no TGV (/api/tgv/salesorders -> MATA410 / SC5 + SC6)
   *
   * IMPORTANTE: O motor TLPP do PGV/TGV exige que o payload esteja encapsulado em:
   * `{ "header": { ... }, "items": [ ... ] }` com chaves em lowercase conforme tabela `A1W`.
   * Sem o objeto `"header"`, o Protheus retorna `500 Internal Server Error`.
   */
  public async createSalesOrder(
    data: CreateProtheusSalesOrderDTO
  ): Promise<ProtheusSalesOrderResponse> {
    const [tenantCompany] = env.PROTHEUS_TENANT.split(',').map((s) => s.trim());
    const companyId = tenantCompany || '01';
    const branchId = String(data.branchId || '0101').trim();
    const tenantId = `${companyId},${branchId}`;
    const externalId = data.externalId || `BITRIX-PV-${Date.now()}`;

    const payload = {
      header: {
        externalid: externalId,
        ordertype: data.orderType || 'N',
        customerid: data.customerCode,
        customerstore: data.storeId,
        paymentconditionid: data.conditionPayment || '009',
        pricelistid: data.priceTable || '004',
        sellerid: data.salesmanCode || env.PROTHEUS_DEFAULT_SALESMAN || '000001',
        typeofoperation: data.typeOfOperation ?? '',
        intermediaryid: '',
        purchaserpresence: '0',
        freighttype: data.freightType || 'S',
        freight: data.freight ?? 0,
        insurance: data.insurance ?? 0,
        expenses: data.expenses ?? 0,
        discount: data.discount ?? 0,
        currencyid: data.currencyId ?? 1,
        releasedate: new Date().toISOString().split('.')[0] + 'Z',
      },
      items: data.items.map((it, idx) => ({
        itemid: it.item || String(idx + 1).padStart(2, '0'),
        productid: it.productCode,
        description: it.description || 'PRODUTO VIA WEBHOOK BITRIX',
        quantity: it.quantity,
        unitprice: it.unitPrice,
        pricelist: it.unitPrice,
        discount: it.discount ?? 0,
        customerorder: it.customerOrder || externalId.slice(0, 9),
        outflowtype: it.outflowType || '501',
      })),
    };

    const endpoint = '/api/tgv/salesorders';

    console.log('=== CREDENCIAIS E CONTEXTO ENVIADOS AO PROTHEUS (PEDIDO DE VENDA) ===');
    console.log('URL:', `${env.PROTHEUS_API_URL}${endpoint}`);
    console.log('Usuário (.env):', env.PROTHEUS_USER);
    console.log('Senha configurada:', env.PROTHEUS_PASS ? '****** (Definida)' : '❌ VAZIA/AUSENTE');
    console.log('TenantId:', tenantId);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('=====================================================================');

    try {
      const response = await this.api.post(endpoint, payload, {
        headers: { TenantId: tenantId },
      });
      const body = response.data;
      const orderId = String(body?.items?.[0]?.orderid ?? body?.orderid ?? '').trim();

      return {
        endpointUsed: '/api/tgv/salesorders',
        orderId: orderId || undefined,
        externalId,
        rawResponse: body,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * Etapa 2B. Criar Orçamento de Venda no TGV (/api/tgv/salesbudgets -> MATA415 / SCJ + SCK)
   *
   * Diferente de `/api/tgv/salesorders` (onde `C6_TES` depende de `B1_TS` ou `SFM` no Protheus),
   * a rota `/api/tgv/salesbudgets` mapeia `items[].outflowtype` diretamente para `CK_TES` (ex: `"501"`),
   * gravando o orçamento completo com `201 Created` mesmo quando o produto está com `B1_TS` em branco.
   */
  public async createSalesBudget(
    data: CreateProtheusSalesOrderDTO
  ): Promise<ProtheusSalesOrderResponse> {
    const [tenantCompany] = env.PROTHEUS_TENANT.split(',').map((s) => s.trim());
    const companyId = tenantCompany || '01';
    const branchId = String(data.branchId || '0101').trim();
    const tenantId = `${companyId},${branchId}`;
    const externalId = data.externalId || `BITRIX-ORC-${Date.now()}`;

    const payload = {
      header: {
        externalid: externalId,
        customerid: data.customerCode,
        customerstore: data.storeId,
        paymentconditionid: data.conditionPayment || '009',
        pricelistid: data.priceTable || '004',
        sellerid: data.salesmanCode || env.PROTHEUS_DEFAULT_SALESMAN || '000001',
        typeofoperation: data.typeOfOperation || '01',
        intermediaryid: '',
        purchaserpresence: '0',
        freighttype: data.freightType || 'S',
        freight: data.freight ?? 0,
        insurance: data.insurance ?? 0,
        expenses: data.expenses ?? 0,
        discount: data.discount ?? 0,
        currencyid: data.currencyId ?? 1,
        observation: `Orcamento Bitrix ${externalId}`,
      },
      items: data.items.map((it, idx) => ({
        itemid: it.item || String(idx + 1).padStart(2, '0'),
        productid: it.productCode,
        quantity: it.quantity,
        unitprice: it.unitPrice,
        pricelist: it.unitPrice,
        discount: it.discount ?? 0,
        outflowtype: it.outflowType || '501',
        operation: it.operation || data.typeOfOperation || '01',
      })),
    };

    const endpoint = '/api/tgv/salesbudgets';

    console.log('=== CREDENCIAIS E CONTEXTO ENVIADOS AO PROTHEUS (ORÇAMENTO DE VENDA) ===');
    console.log('URL:', `${env.PROTHEUS_API_URL}${endpoint}`);
    console.log('Usuário (.env):', env.PROTHEUS_USER);
    console.log('Senha configurada:', env.PROTHEUS_PASS ? '****** (Definida)' : '❌ VAZIA/AUSENTE');
    console.log('TenantId:', tenantId);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('========================================================================');

    try {
      const response = await this.api.post(endpoint, payload, {
        headers: { TenantId: tenantId },
      });
      const body = response.data;
      const budgetId = String(body?.items?.[0]?.budgetid ?? body?.budgetid ?? '').trim();

      return {
        endpointUsed: '/api/tgv/salesbudgets',
        budgetId: budgetId || undefined,
        externalId,
        rawResponse: body,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * Etapa 2C. Criar Oportunidade de Venda no CRM (/api/crm/v1/opportunity -> FATA300 / AD1)
   */
  public async createOpportunity(
    data: CreateProtheusOpportunityDTO
  ): Promise<ProtheusOpportunityResponse> {
    const [tenantCompany] = env.PROTHEUS_TENANT.split(',').map((s) => s.trim());
    const companyId = tenantCompany || '01';
    const branchId = String(data.branchId).trim();

    if (!(ALLOWED_BRANCHES as readonly string[]).includes(branchId)) {
      throw new Error(
        `Filial inválida para Oportunidade: "${branchId}". Permitidas: ${ALLOWED_BRANCHES.join(', ')}.`
      );
    }

    const tenantId = `${companyId},${branchId}`;

    const today = new Date().toISOString().slice(0, 10);
    const startDate = data.startDate || today;

    const payload = {
      companyId,
      branchId,
      customerCode: data.customerCode,
      storeId: data.storeId,
      description: data.description,
      salesmanCode: data.salesmanCode || env.PROTHEUS_DEFAULT_SALESMAN,
      process: data.process || env.PROTHEUS_DEFAULT_PROCESS,
      stage: data.stage || env.PROTHEUS_DEFAULT_STAGE,
      startDate,
      currency: 1,
      priority: data.priority || '1',
      status: data.status || '1',
    };

    const endpoint = '/custom_opportunity/opportunity';

    console.log('=== CRIAÇÃO DE OPORTUNIDADE NO PROTHEUS ===');
    console.log('URL:', `${env.PROTHEUS_API_URL}${endpoint}`);
    console.log('Usuário (.env):', env.PROTHEUS_USER);
    console.log('Senha configurada:', env.PROTHEUS_PASS ? '****** (Definida)' : '❌ VAZIA/AUSENTE');
    console.log('TenantId:', tenantId);
    console.log('Payload:', JSON.stringify(payload, null, 2));
    console.log('===========================================');

    try {
      const response = await this.api.post(endpoint, payload, {
        headers: { TenantId: tenantId },
      });
      const body = response.data;

      console.log('[ProtheusService][Etapa 2 - Oportunidade] Resposta do Protheus:', JSON.stringify(body, null, 2));

      if (body && body.success === false) {
        throw new Error(`Falha na criação da Oportunidade: ${body.message || ''} - ${body.details || ''}`);
      }

      const fwFields: any[] = body?.models?.[0]?.fields || [];
      const fromFwModel = fwFields.find((f: any) => f?.id === 'AD1_NROPOR')?.value;

      const opportunityId = String(
        body?.opportunityId ??
          fromFwModel ??
          body?.code ??
          body?.id ??
          body?.AD1_NROPOR ??
          body?.number ??
          ''
      ).trim();

      const revision = String(body?.revision ?? body?.AD1_REVISA ?? '01').trim();

      return {
        opportunityId: opportunityId || 'GERADA_SEM_ID_NO_RETORNO',
        revision: revision || '01',
        rawResponse: body,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * Consulta vários produtos na tabela SB1 do Protheus em lote pelo código (B1_COD).
   */
  public async findProductsByCodes(productCodes: string[]): Promise<Map<string, ProtheusProductInfo>> {
    const cleanCodes = [...new Set(productCodes.map((c) => String(c || '').trim()).filter(Boolean))];
    const map = new Map<string, ProtheusProductInfo>();
    if (cleanCodes.length === 0) return map;

    const fields = 'B1_FILIAL,B1_COD,B1_DESC,B1_TIPO,B1_UM,B1_LOCPAD,B1_TS,B1_PRV1';
    const inList = cleanCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
    const where = `B1_COD IN (${inList})`;
    const endpoint = `/api/framework/v1/genericQuery?tables=SB1&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=${Math.max(cleanCodes.length * 2, 20)}`;

    console.log(`[ProtheusService][Consulta Produtos SB1] GET ${endpoint}`);

    try {
      const response = await this.api.get(endpoint);
      const items: any[] = response.data?.items || [];

      for (const row of items) {
        const code = String(row.b1_cod ?? row.B1_COD ?? '').trim();
        if (!code || map.has(code)) continue;
        map.set(code, {
          code,
          description: String(row.b1_desc ?? row.B1_DESC ?? 'PRODUTO').trim(),
          unitOfMeasure: String(row.b1_um ?? row.B1_UM ?? 'UN').trim(),
          type: String(row.b1_tipo ?? row.B1_TIPO ?? 'ME').trim(),
          warehouse: String(row.b1_locpad ?? row.B1_LOCPAD ?? '01').trim(),
          defaultTes: String(row.b1_ts ?? row.B1_TS ?? '').trim(),
          basePrice: Number(row.b1_prv1 ?? row.B1_PRV1 ?? 0),
        });
      }

      return map;
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * Consulta na DA1/DA0 qual tabela de preço ativa contém todos os produtos informados,
   * respeitando a lista de prioridade fiscal passada pelo chamador.
   */
  public async resolvePriceTableForProducts(
    productCodes: string[],
    preferredTables: string[] = []
  ): Promise<{ tableId: string; coveredAll: boolean; matchingTables: string[] }> {
    const cleanCodes = [...new Set(productCodes.map((c) => String(c || '').trim()).filter(Boolean))];
    const fallback = env.PROTHEUS_DEFAULT_PRICE_TABLE || '003';
    if (cleanCodes.length === 0) {
      return { tableId: fallback, coveredAll: false, matchingTables: [] };
    }

    const inList = cleanCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
    const da1Endpoint = `/api/framework/v1/genericQuery?tables=DA1&fields=DA1_CODTAB,DA1_CODPRO,DA1_ATIVO&where=${encodeURIComponent(
      `DA1_CODPRO IN (${inList}) AND DA1_ATIVO = '1'`
    )}&pageSize=200`;

    try {
      const [da1Res, da0Res] = await Promise.all([
        this.api.get(da1Endpoint),
        this.api.get(
          `/api/framework/v1/genericQuery?tables=DA0&fields=DA0_CODTAB,DA0_DATATE,DA0_ATIVO&where=${encodeURIComponent(
            "DA0_ATIVO = '1'"
          )}&pageSize=100`
        ),
      ]);

      const today = new Date().toISOString().slice(0, 10);
      const activeDa0 = new Set<string>(
        (da0Res.data?.items || [])
          .filter((t: any) => {
            const end = String(t.da0_datate ?? t.DA0_DATATE ?? '').trim();
            return !end || end >= today;
          })
          .map((t: any) => String(t.da0_codtab ?? t.DA0_CODTAB ?? '').trim())
          .filter(Boolean)
      );

      const tableProducts = new Map<string, Set<string>>();
      for (const row of da1Res.data?.items || []) {
        const tab = String(row.da1_codtab ?? row.DA1_CODTAB ?? '').trim();
        const prod = String(row.da1_codpro ?? row.DA1_CODPRO ?? '').trim();
        if (!tab || !prod || !activeDa0.has(tab)) continue;
        if (!tableProducts.has(tab)) tableProducts.set(tab, new Set());
        tableProducts.get(tab)!.add(prod);
      }

      const fullCoverageTables = [...tableProducts.entries()]
        .filter(([, prods]) => cleanCodes.every((c) => prods.has(c)))
        .map(([tab]) => tab);

      for (const pref of preferredTables) {
        if (fullCoverageTables.includes(pref)) {
          return { tableId: pref, coveredAll: true, matchingTables: fullCoverageTables };
        }
      }

      if (fullCoverageTables.length > 0) {
        fullCoverageTables.sort();
        return { tableId: fullCoverageTables[0], coveredAll: true, matchingTables: fullCoverageTables };
      }

      // Nenhuma tabela isolada tem todos os produtos -> escolhe preferida que tenha ao menos 1 ou fallback
      for (const pref of preferredTables) {
        if (tableProducts.has(pref)) {
          return { tableId: pref, coveredAll: false, matchingTables: [] };
        }
      }

      return { tableId: preferredTables[0] || fallback, coveredAll: false, matchingTables: [] };
    } catch (err: any) {
      console.warn(`[ProtheusService] Aviso ao consultar DA1/DA0 (${err.message}). Usando tabela padrão ${fallback}.`);
      return { tableId: preferredTables[0] || fallback, coveredAll: false, matchingTables: [] };
    }
  }

  /**
   * Busca código do vendedor na tabela SA3 pelo e-mail do responsável no Bitrix.
   */
  public async findSalesmanByEmail(email?: string): Promise<string | null> {
    const target = String(email || '').trim().toLowerCase();
    if (!target) return null;

    try {
      const endpoint = `/api/framework/v1/genericQuery?tables=SA3&fields=A3_COD,A3_EMAIL&where=${encodeURIComponent(
        "A3_EMAIL <> ''"
      )}&pageSize=200`;
      const response = await this.api.get(endpoint);
      const items: any[] = response.data?.items || [];
      const match = items.find(
        (r) => String(r.a3_email ?? r.A3_EMAIL ?? '').trim().toLowerCase() === target
      );
      return match ? String(match.a3_cod ?? match.A3_COD ?? '').trim() || null : null;
    } catch {
      return null;
    }
  }

  /**
   * Consulta os dados complementares de um produto na tabela SB1 do Protheus pelo código (B1_COD).
   * Permite que o Bitrix envie apenas { productCode, quantity, unitPrice } e o sistema preencha
   * automaticamente descrição (B1_DESC), unidade de medida (B1_UM), armazém (B1_LOCPAD) e TES (B1_TS).
   */
  public async findProductByCode(productCode: string): Promise<ProtheusProductInfo | null> {
    const cleanCode = String(productCode || '').trim();
    if (!cleanCode) {
      throw new Error('Código do produto (productCode) é obrigatório.');
    }

    const fields = 'B1_FILIAL,B1_COD,B1_DESC,B1_TIPO,B1_UM,B1_LOCPAD,B1_TS,B1_PRV1';
    const where = `B1_COD = '${cleanCode.replace(/'/g, "''")}'`;
    const endpoint = `/api/framework/v1/genericQuery?tables=SB1&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=5`;

    console.log(`[ProtheusService][Consulta Produto SB1] GET ${endpoint}`);

    try {
      const response = await this.api.get(endpoint);
      const items: any[] = response.data?.items || [];

      if (items.length === 0) {
        return null;
      }

      const row = items[0];
      return {
        code: String(row.b1_cod ?? row.B1_COD ?? cleanCode).trim(),
        description: String(row.b1_desc ?? row.B1_DESC ?? 'PRODUTO').trim(),
        unitOfMeasure: String(row.b1_um ?? row.B1_UM ?? 'UN').trim(),
        type: String(row.b1_tipo ?? row.B1_TIPO ?? 'ME').trim(),
        warehouse: String(row.b1_locpad ?? row.B1_LOCPAD ?? '01').trim(),
        defaultTes: String(row.b1_ts ?? row.B1_TS ?? '').trim(),
        basePrice: Number(row.b1_prv1 ?? row.B1_PRV1 ?? 0),
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * Enriquecimento automático dos itens da proposta comercial a partir do cadastro de produtos (SB1).
   */
  public async enrichProposalItems(
    items: ProtheusSalesItemDTO[],
    defaultCondPg?: string,
    defaultTes?: string
  ): Promise<EnrichedProposalItem[]> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(
        'A Proposta Comercial exige ao menos 1 produto na lista `items` (com `productCode`, `quantity` e `unitPrice`).'
      );
    }

    const sb1Map = await this.findProductsByCodes(items.map((it) => it.productCode));
    const enriched: EnrichedProposalItem[] = [];

    for (let idx = 0; idx < items.length; idx++) {
      const raw = items[idx];
      const itemNumber = raw.item || String(idx + 1).padStart(2, '0');
      const productCode = String(raw.productCode || '').trim();

      if (!productCode) {
        throw new Error(`Item ${itemNumber}: O código do produto (productCode) é obrigatório.`);
      }

      const sb1 = sb1Map.get(productCode);
      if (!sb1) {
        throw new Error(
          `Item ${itemNumber}: Produto "${productCode}" não encontrado no cadastro de produtos do Protheus (tabela SB1).`
        );
      }

      const quantity = Number(raw.quantity) > 0 ? Number(raw.quantity) : 1;
      const unitPrice =
        Number(raw.unitPrice) > 0
          ? Number(raw.unitPrice)
          : sb1.basePrice > 0
            ? sb1.basePrice
            : 0;

      const totalValue = Number((quantity * unitPrice).toFixed(2));
      const conditionPayment = String(
        raw.conditionPayment || defaultCondPg || env.PROTHEUS_DEFAULT_PAYMENT_TERM || '043'
      ).trim();

      const validSb1Tes = sb1.defaultTes && Number(sb1.defaultTes) > 500 ? sb1.defaultTes : '';
      const outflowType = String(
        raw.outflowType || validSb1Tes || defaultTes || env.PROTHEUS_DEFAULT_TES || '501'
      ).trim();

      enriched.push({
        item: itemNumber,
        productCode: sb1.code,
        description: raw.description && raw.description !== 'PRODUTO OPORTUNIDADE'
          ? raw.description
          : sb1.description,
        unitOfMeasure: raw.unitOfMeasure || sb1.unitOfMeasure || 'UN',
        warehouse: sb1.warehouse || '01',
        quantity,
        unitPrice,
        priceList: unitPrice,
        totalValue,
        discount: Number(raw.discount || 0),
        conditionPayment,
        outflowType,
      });
    }

    return enriched;
  }

  /**
   * Etapa 3. Criar Proposta Comercial vinculada à Oportunidade (ADY / ADZ -> FATA600)
   *
   * 1. Busca automaticamente os dados complementares de cada produto na SB1 (descrição, UM, armazém, TES).
   * 2. Envia para a rota customizada `/custom_opportunity/proposal` (WSCROPP.prw) que preenche
   *    o cabeçalho ADY (incluindo os campos obrigatórios customizados ADY_ZZPRAZ e ADY_ZZFRT) e
   *    os itens na ADZ (ADZPRODUTO), vinculando-a à Oportunidade (`ADY_OPORTU = AD1_NROPOR`).
   */
  public async createCommercialProposal(
    data: CreateProtheusProposalDTO
  ): Promise<ProtheusProposalResponse> {
    const [tenantCompany] = env.PROTHEUS_TENANT.split(',').map((s) => s.trim());
    const companyId = tenantCompany || '01';
    const branchId = String(data.branchId || '0101').trim();
    const tenantId = `${companyId},${branchId}`;
    const opportunityId = String(data.opportunityId).trim();
    const opportunityRevision = String(data.opportunityRevision || '01').trim();

    if (!opportunityId) {
      throw new Error('O número da Oportunidade (opportunityId / AD1_NROPOR) é obrigatório para gerar a Proposta Comercial.');
    }

    // 1. Enriquecer os produtos consultando a tabela SB1 no Protheus
    console.log(`[ProtheusService][Passo 3 - Proposta Comercial] Consultando ${data.items.length} produto(s) na SB1...`);
    const enrichedItems = await this.enrichProposalItems(
      data.items,
      data.conditionPayment,
      undefined
    );

    const conditionPayment = String(
      data.conditionPayment || env.PROTHEUS_DEFAULT_PAYMENT_TERM || '043'
    ).trim();
    const priceTable = String(
      data.priceTable || env.PROTHEUS_DEFAULT_PRICE_TABLE || '003'
    ).trim();
    const deliveryDays = String(
      data.deliveryDays || env.PROTHEUS_DEFAULT_DELIVERY_DAYS || '10'
    ).trim();
    const freightType = (data.freightType || env.PROTHEUS_DEFAULT_FREIGHT_TYPE || 'C') as 'C' | 'F';
    const salesmanCode = String(
      data.salesmanCode || env.PROTHEUS_DEFAULT_SALESMAN || '000001'
    ).trim();

    const customPayload = {
      companyId,
      branchId,
      opportunityId,
      opportunityRevision,
      customerCode: data.customerCode,
      storeId: data.storeId,
      salesmanCode,
      conditionPayment,
      priceTable,
      deliveryDays,
      freightType,
      items: enrichedItems.map((it) => ({
        item: it.item,
        productCode: it.productCode,
        description: it.description,
        unitOfMeasure: it.unitOfMeasure,
        warehouse: it.warehouse,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        priceList: it.priceList,
        totalValue: it.totalValue,
        discount: it.discount,
        conditionPayment: it.conditionPayment,
        outflowType: it.outflowType,
      })),
    };

    const customEndpoint = '/custom_opportunity/opportunity';

    console.log('=== CRIAÇÃO DE PROPOSTA COMERCIAL NO PROTHEUS (ADY/ADZ) ===');
    console.log('URL:', `${env.PROTHEUS_API_URL}${customEndpoint}`);
    console.log('TenantId:', tenantId);
    console.log('Oportunidade Vinculada (ADY_OPORTU):', opportunityId);
    console.log('Payload Proposta Comercial:', JSON.stringify(customPayload, null, 2));
    console.log('===========================================================');

    try {
      const response = await this.api.post(customEndpoint, customPayload, {
        headers: { TenantId: tenantId },
        timeout: 60000,
      });
      const body = response.data;

      console.log('[ProtheusService][Passo 3 - Proposta Comercial] Resposta do Protheus:', JSON.stringify(body, null, 2));

      if (body && body.success === false) {
        throw new Error(
          `Falha na criação da Proposta Comercial (ADY/ADZ): ${body.message || ''} - ${body.details || ''}`
        );
      }

      const proposalId = String(
        body?.proposalId ??
          body?.ProposalNumber ??
          body?.ADY_PROPOS ??
          body?.id ??
          ''
      ).trim();

      const proposalRevision = String(
        body?.proposalRevision ?? body?.ProposalReview ?? body?.ADY_PREVIS ?? '01'
      ).trim();

      const budgetId = body?.budgetId || body?.ADY_ORCAME || undefined;

      return {
        proposalId: proposalId || 'GERADA_SEM_ID_NO_RETORNO',
        proposalRevision,
        opportunityId,
        budgetId: budgetId ? String(budgetId).trim() : undefined,
        enrichedItems,
        rawResponse: body,
      };
    } catch (error: any) {
      // Se a rota customizada /custom_opportunity/proposal retornar 404 (ainda não compilada no WSCROPP.prw),
      // tenta a rota nativa T-Talk /api/crm/v1/opportunities/:id/commercialproposal
      if (error?.response?.status === 404) {
        const nativeEndpoint = `/api/crm/v1/opportunities/${branchId}${opportunityId}/commercialproposal`;
        console.warn(
          `[ProtheusService] Rota ${customEndpoint} retornou 404 (atualize e recompile o WSCROPP.prw). Tentando rota nativa ${nativeEndpoint}...`
        );

        const nativePayload = {
          CompanyId: companyId,
          BranchID: branchId,
          OpportunityId: opportunityId,
          OpportunityReview: opportunityRevision,
          EntityType: '1',
          EntityCode: data.customerCode,
          EntityUnit: data.storeId,
          SellerId: salesmanCode,
          PriceListId: priceTable,
          SynchronizeProposal: true,
          RegisterSituation: '2',
          ADY_ZZPRAZ: deliveryDays,
          ADY_ZZFRT: freightType,
          ListofProducts: enrichedItems.map((it) => ({
            BranchId: branchId,
            ItemId: it.item,
            ProductId: it.productCode,
            ProductDescription: it.description,
            UnitOfMeasurement: it.unitOfMeasure,
            Currency: '1',
            PaymentModeId: it.conditionPayment,
            TypeOut: it.outflowType,
            Quantity: it.quantity,
            UnitPrice: it.unitPrice,
            UnitPriceList: it.priceList,
            TotalValue: it.totalValue,
            ItemDiscountPercentage: it.discount,
            ItemDiscountValue: 0,
          })),
        };

        try {
          const nativeRes = await this.api.post(nativeEndpoint, nativePayload, {
            headers: { TenantId: tenantId },
          });
          const nativeBody = nativeRes.data;
          const proposalId = String(
            nativeBody?.ProposalNumber ?? nativeBody?.proposalId ?? nativeBody?.ADY_PROPOS ?? ''
          ).trim();

          return {
            proposalId: proposalId || 'GERADA_SEM_ID_NO_RETORNO',
            proposalRevision: String(nativeBody?.ProposalReview ?? '01').trim(),
            opportunityId,
            enrichedItems,
            rawResponse: nativeBody,
          };
        } catch (nativeErr: any) {
          this.handleProtheusError(nativeErr);
        }
      }

      this.handleProtheusError(error);
    }
  }

  /**
   * Fluxo padrão completo no Protheus (usado por /webhook/bitrix/create-order e pela rota unificada):
   * 1. Valida/Cadastra Cliente na SA1 (CNPJ)
   * 2. Cria Oportunidade de Venda (AD1 / FATA300)
   * 3. Cria Proposta Comercial vinculada (ADY/ADZ / FATA600) enriquecendo os produtos via SB1
   */
  public async executeUnifiedOrderFlow(
    input: ProtheusOpportunityProposalFlowInput
  ): Promise<ProtheusOpportunityProposalFlowResult> {
    const {
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
    } = input;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(
        'É obrigatório informar ao menos 1 produto no array `items` para gerar a Proposta Comercial no Protheus.'
      );
    }

    // PASSO 1: Garantir o Cliente na SA1
    console.log(`[ProtheusFlow][Passo 1/3] Consultando cliente CNPJ ${customer.cnpj} na SA1...`);
    let protheusCustomer = await this.findCustomerByCnpj(customer.cnpj);
    let customerCreatedNow = false;

    if (!protheusCustomer) {
      console.log(
        `[ProtheusFlow][Passo 1/3] Cliente CNPJ ${customer.cnpj} não encontrado. Cadastrando "${customer.name}" via MATA030...`
      );
      protheusCustomer = await this.createCustomer(customer);
      customerCreatedNow = true;
      console.log(
        `[ProtheusFlow][Passo 1/3] ✅ Cliente cadastrado na SA1: code=${protheusCustomer.code}, storeId=${protheusCustomer.storeId}`
      );
    } else {
      console.log(
        `[ProtheusFlow][Passo 1/3] ✅ Cliente encontrado na SA1: code=${protheusCustomer.code}, storeId=${protheusCustomer.storeId}`
      );
    }

    // PASSO 2: Criar Oportunidade de Venda (AD1 / FATA300)
    console.log(
      `[ProtheusFlow][Passo 2/3] Criando Oportunidade no Protheus na filial ${branchId} (Cliente: ${protheusCustomer.code}/${protheusCustomer.storeId})...`
    );

    const opportunityResult = await this.createOpportunity({
      branchId,
      customerCode: protheusCustomer.code,
      storeId: protheusCustomer.storeId,
      description,
      salesmanCode,
      process,
      stage,
    });

    console.log(
      `[ProtheusFlow][Passo 2/3] ✅ Oportunidade gerada com sucesso! ID: ${opportunityResult.opportunityId}`
    );

    // PASSO 3: Criar Proposta Comercial (ADY/ADZ / FATA600) vinculada à Oportunidade
    console.log(
      `[ProtheusFlow][Passo 3/3] Criando Proposta Comercial vinculada à Oportunidade ${opportunityResult.opportunityId} com ${items.length} item(ns)...`
    );

    const proposalResult = await this.createCommercialProposal({
      branchId,
      opportunityId: opportunityResult.opportunityId,
      opportunityRevision: opportunityResult.revision || '01',
      customerCode: protheusCustomer.code,
      storeId: protheusCustomer.storeId,
      salesmanCode,
      conditionPayment,
      priceTable,
      deliveryDays,
      freightType,
      items,
    });

    console.log(
      `[ProtheusFlow][Passo 3/3] ✅ Proposta Comercial gerada com sucesso! ID: ${proposalResult.proposalId} (Oportunidade: ${opportunityResult.opportunityId})`
    );

    return {
      opportunityId: opportunityResult.opportunityId,
      opportunityRevision: opportunityResult.revision || '01',
      proposalId: proposalResult.proposalId,
      proposalRevision: proposalResult.proposalRevision,
      budgetId: proposalResult.budgetId ?? null,
      branchId,
      externalReference: dealId ?? null,
      customer: {
        ...protheusCustomer,
        createdNow: customerCreatedNow,
      },
      items: proposalResult.enrichedItems,
      protheusResponse: {
        opportunity: opportunityResult.rawResponse,
        proposal: proposalResult.rawResponse,
      },
    };
  }
}

export const protheusService = new ProtheusService();
