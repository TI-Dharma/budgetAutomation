import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { env } from '../config/env';
import { fiscalService } from './fiscal.service';

export interface ProtheusCustomer {
  code: string;
  storeId: string;
  name: string;
  shortName?: string;
  cnpj: string;
  state?: string;
  stateRegistration?: string;
  blocked?: boolean;
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
  unitPrice?: number;
  discount?: number;
  conditionPayment?: string; // Condição de pagamento SE4 (ex: "043")
  outflowType?: string;      // TES SF4 (ex: "502", "542", "501")
  operationType?: string;    // Tipo de operação especial opcional
}

export interface ProtheusProductInfo {
  code: string;
  description: string;
  unitOfMeasure: string;
  type: string;
  warehouse: string;
  defaultTes: string;
  basePrice: number;
  blocked: boolean;
  ncm: string;        // B1_POSIPI
  origin: string;     // B1_ORIGEM
  clasfis: string;    // B1_CLASFIS
  taxGroup: string;   // B1_GRTRIB
  picm: number;       // B1_PICM
  mva: number;        // B1_PICMRET
}

export interface EnrichedProposalItem {
  item: string;
  productCode: string;
  description: string;
  unitOfMeasure: string;
  warehouse: string;
  quantity: number;
  conditionPayment: string;
  outflowType: string;
  unitPrice?: number;
}

export interface AdzSavedProposalItem {
  item: string;
  productCode: string;
  description: string;
  unitOfMeasure: string;
  quantity: number;
  unitPrice: number;       // ADZ_PRCVEN calculado e salvo pelo Protheus
  priceTableValue: number; // ADZ_PRCTAB (preço de tabela DA1)
  totalValue: number;      // ADZ_TOTAL
  outflowType: string;     // ADZ_TES
  conditionPayment: string;// ADZ_CONDPG
  budgetId: string;        // ADZ_ORCAME (SCJ gerado pelo FATA600/MATA415)
  ncm: string;             // B1_POSIPI
  cst: string;             // CK_CLASFIS / B1_ORIGEM + F4_SITTRIB
  icmsRate: number;        // % ICMS calculado
  icmsValue: number;       // Valor ICMS
  stUnitValue: number;     // Valor Unitário de ST (Valor Uni ST)
  stTotalValue: number;    // Valor Total de ST da linha
}

/** Filiais habilitadas no Grupo Dharma: 0101 (DHARMACOM) e 0202 (DHARMASERV) */
export const ALLOWED_BRANCHES = ['0101', '0202'] as const;

export interface CreateProtheusOpportunityDTO {
  branchId: string;
  customerCode: string;
  storeId: string;
  description: string;
  salesmanCode?: string;
  process?: string;
  stage?: string;
  startDate?: string;
  priority?: '1' | '2' | '3';
  status?: string;
}

export interface ProtheusOpportunityRecord {
  branchId: string;
  opportunityId: string;
  revision: string;
  description: string;
  customerCode: string;
  storeId: string;
  salesmanCode: string;
  status: string;
}

export interface ProtheusOpportunityResponse {
  opportunityId: string;
  revision: string;
  branchId: string;
  customerCode: string;
  storeId: string;
  salesmanCode: string;
  rawResponse: unknown;
}

export interface CreateProtheusProposalDTO {
  branchId?: string;
  opportunityId: string;
  opportunityRevision?: string;
  customerCode: string;
  storeId: string;
  salesmanCode?: string;
  conditionPayment?: string;
  priceTable?: string;
  deliveryDays?: string;
  freightType?: 'C' | 'F';
  uf?: string;
  isExempt?: boolean;
  items: ProtheusSalesItemDTO[];
}

export interface ProtheusProposalResponse {
  proposalId: string;
  proposalRevision: string;
  opportunityId: string;
  budgetId?: string;
  validityDate: string;    // YYYY-MM-DD (SCJ->CJ_VALIDA)
  validityDateBr: string;  // DD/MM/YYYY
  branchId: string;
  priceTable: string;
  conditionPayment: string;
  sentItems: EnrichedProposalItem[];
  savedAdzItems: AdzSavedProposalItem[];
  rawResponse: unknown;
}

export class ProtheusService {
  private api: AxiosInstance;

  constructor() {
    const basicAuthToken = Buffer.from(
      `${env.PROTHEUS_USER}:${env.PROTHEUS_PASS}`,
      'utf-8'
    ).toString('base64');

    this.api = axios.create({
      baseURL: env.PROTHEUS_API_URL,
      timeout: 60000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuthToken}`,
        TenantId: env.PROTHEUS_TENANT,
      },
    });
  }

  private sanitizeCnpj(cnpj: string): string {
    return String(cnpj || '').replace(/\D/g, '');
  }

  private handleProtheusError(error: any): never {
    console.error('================ ERRO COMPLETO DO PROTHEUS ================');
    if (error.response) {
      console.error('Status HTTP:', error.response.status);
      console.error('Dados do Erro (Body):', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('Sem resposta do servidor Protheus');
    } else {
      console.error('Erro na requisição:', error.message);
    }
    console.error('==========================================================');
    throw error;
  }

  /**
   * 1A. Consultar Cliente no Protheus pelo CNPJ na tabela SA1
   */
  public async findCustomerByCnpj(cnpj: string): Promise<ProtheusCustomer | null> {
    const cleanCnpj = this.sanitizeCnpj(cnpj);
    if (!cleanCnpj) {
      throw new Error('CNPJ inválido ou vazio para consulta na SA1 do Protheus.');
    }

    const fields = 'A1_FILIAL,A1_COD,A1_LOJA,A1_NOME,A1_NREDUZ,A1_CGC,A1_EST,A1_INSCR,A1_MSBLQL';
    const where = `A1_CGC = '${cleanCnpj}'`;
    const endpoint = `/api/framework/v1/genericQuery?tables=SA1&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=10`;
    console.log(`[ProtheusService][Consulta Cliente SA1] GET ${endpoint}`);

    try {
      const response = await this.api.get(endpoint);
      const items: any[] = Array.isArray(response.data?.items) ? response.data.items : [];

      const matchingRecords = items.filter((item) => {
        const recordCnpj = this.sanitizeCnpj(item.a1_cgc ?? item.A1_CGC ?? '');
        return recordCnpj === cleanCnpj;
      });

      if (matchingRecords.length === 0) {
        return null;
      }

      const activeRecord = matchingRecords.find(
        (item) => String(item.a1_msblql ?? item.A1_MSBLQL ?? '') !== '1'
      );

      if (!activeRecord) {
        const blocked = matchingRecords[0];
        const code = String(blocked.a1_cod ?? blocked.A1_COD ?? '').trim();
        const store = String(blocked.a1_loja ?? blocked.A1_LOJA ?? '0001').trim();
        throw new Error(
          `Cliente ${code}/${store} (CNPJ ${cleanCnpj}) está bloqueado na tabela SA1 do Protheus (A1_MSBLQL = 1).`
        );
      }

      return {
        code: String(activeRecord.a1_cod ?? activeRecord.A1_COD ?? '').trim(),
        storeId: String(activeRecord.a1_loja ?? activeRecord.A1_LOJA ?? '0001').trim(),
        name: String(activeRecord.a1_nome ?? activeRecord.A1_NOME ?? '').trim(),
        shortName: String(activeRecord.a1_nreduz ?? activeRecord.A1_NREDUZ ?? '').trim(),
        cnpj: cleanCnpj,
        state: String(activeRecord.a1_est ?? activeRecord.A1_EST ?? '').trim().toUpperCase() || undefined,
        stateRegistration: String(activeRecord.a1_inscr ?? activeRecord.A1_INSCR ?? '').trim() || undefined,
        blocked: false,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleProtheusError(error);
    }
  }

  /**
   * 1B. Cadastrar Cliente automaticamente no Protheus (SA1 / MATA030) caso não exista
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
    console.log(`[ProtheusService][Cadastro Cliente MATA030] POST ${endpoint}`);

    try {
      const response = await this.api.post(endpoint, payload);
      const data = response.data;

      const code = String(data?.code ?? data?.A1_COD ?? '').trim();
      const storeId = String(data?.storeId ?? data?.A1_LOJA ?? '0001').trim();

      if (!code) {
        throw new Error(
          `Protheus não retornou o código do cliente (code/A1_COD) ao cadastrar na SA1. Resposta: ${JSON.stringify(data)}`
        );
      }

      return {
        code,
        storeId,
        name: customerData.name,
        shortName: payload.shortName,
        cnpj: cleanCnpj,
        state: payload.state,
        stateRegistration: payload.stateRegistration,
        blocked: false,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * 1C. Garantir Cliente na SA1 (consulta por CNPJ e cadastra se não existir)
   */
  public async ensureCustomer(
    customerData: CreateProtheusCustomerDTO
  ): Promise<{ customer: ProtheusCustomer; createdNow: boolean }> {
    const existing = await this.findCustomerByCnpj(customerData.cnpj);
    if (existing) {
      return { customer: existing, createdNow: false };
    }

    const created = await this.createCustomer(customerData);
    return { customer: created, createdNow: true };
  }

  /**
   * 2A. Criar Oportunidade de Venda no CRM (WSCROPP.prw -> FATA300 / AD1)
   */
  public async createOpportunity(
    data: CreateProtheusOpportunityDTO
  ): Promise<ProtheusOpportunityResponse> {
    const [tenantCompany] = env.PROTHEUS_TENANT.split(',').map((s) => s.trim());
    const companyId = tenantCompany || '01';
    const branchId = String(data.branchId || env.PROTHEUS_DEFAULT_BRANCH || '0101').trim();

    if (!(ALLOWED_BRANCHES as readonly string[]).includes(branchId)) {
      throw new Error(
        `Filial inválida para Oportunidade: "${branchId}". Permitidas: ${ALLOWED_BRANCHES.join(', ')}.`
      );
    }

    const tenantId = `${companyId},${branchId}`;
    const today = new Date().toISOString().slice(0, 10);
    const startDate = data.startDate || today;
    const salesmanCode = String(data.salesmanCode || env.PROTHEUS_DEFAULT_SALESMAN || '000001').trim();

    const payload = {
      companyId,
      branchId,
      customerCode: data.customerCode,
      storeId: data.storeId,
      description: data.description,
      salesmanCode,
      process: data.process || env.PROTHEUS_DEFAULT_PROCESS,
      stage: data.stage || env.PROTHEUS_DEFAULT_STAGE,
      startDate,
      currency: 1,
      priority: data.priority || '1',
      status: data.status || '1',
    };

    const endpoint = '/custom_opportunity/opportunity';
    console.log(`[ProtheusService][Criar Oportunidade AD1] POST ${endpoint} (TenantId: ${tenantId})`);

    try {
      const response = await this.api.post(endpoint, payload, {
        headers: { TenantId: tenantId },
      });
      const body = response.data;

      if (body && body.success === false) {
        throw new Error(`Falha na criação da Oportunidade (AD1/FATA300): ${body.message || ''} - ${body.details || ''}`);
      }

      const opportunityId = String(
        body?.opportunityId ?? body?.AD1_NROPOR ?? body?.code ?? body?.id ?? ''
      ).trim();

      if (!opportunityId) {
        throw new Error(`O Protheus não retornou o ID da Oportunidade (AD1_NROPOR). Resposta: ${JSON.stringify(body)}`);
      }

      const revision = String(body?.revision ?? body?.AD1_REVISA ?? '01').trim() || '01';

      return {
        opportunityId,
        revision,
        branchId,
        customerCode: data.customerCode,
        storeId: data.storeId,
        salesmanCode,
        rawResponse: body,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * 2B. Consultar uma Oportunidade específica (AD1) pelo número (AD1_NROPOR)
   */
  public async findOpportunityById(
    opportunityId: string,
    branchId?: string
  ): Promise<ProtheusOpportunityRecord | null> {
    const cleanId = String(opportunityId || '').trim();
    if (!cleanId) return null;

    const fields = 'AD1_FILIAL,AD1_NROPOR,AD1_REVISA,AD1_DESCRI,AD1_CODCLI,AD1_LOJCLI,AD1_VEND,AD1_STATUS';
    const branchFilter = branchId ? ` AND AD1_FILIAL = '${String(branchId).trim()}'` : '';
    const where = `AD1_NROPOR = '${cleanId.replace(/'/g, "''")}'${branchFilter}`;
    const endpoint = `/api/framework/v1/genericQuery?tables=AD1&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=10`;

    try {
      const response = await this.api.get(endpoint);
      const items: any[] = Array.isArray(response.data?.items) ? response.data.items : [];
      if (items.length === 0) return null;

      // Prioriza oportunidade ativa (AD1_STATUS = '1')
      const chosen =
        items.find((r) => String(r.ad1_status ?? r.AD1_STATUS ?? '') === '1') || items[0];

      return {
        branchId: String(chosen.ad1_filial ?? chosen.AD1_FILIAL ?? branchId ?? '0101').trim(),
        opportunityId: String(chosen.ad1_nropor ?? chosen.AD1_NROPOR ?? cleanId).trim(),
        revision: String(chosen.ad1_revisa ?? chosen.AD1_REVISA ?? '01').trim(),
        description: String(chosen.ad1_descri ?? chosen.AD1_DESCRI ?? '').trim(),
        customerCode: String(chosen.ad1_codcli ?? chosen.AD1_CODCLI ?? '').trim(),
        storeId: String(chosen.ad1_lojcli ?? chosen.AD1_LOJCLI ?? '0001').trim(),
        salesmanCode: String(chosen.ad1_vend ?? chosen.AD1_VEND ?? '000001').trim(),
        status: String(chosen.ad1_status ?? chosen.AD1_STATUS ?? '1').trim(),
      };
    } catch {
      return null;
    }
  }

  /**
   * 2C. Buscar a última Oportunidade ativa (AD1) vinculada ao CNPJ do cliente no Protheus
   */
  public async findLatestActiveOpportunityByCnpj(
    cnpj: string,
    branchId?: string
  ): Promise<{ opportunity: ProtheusOpportunityRecord; customer: ProtheusCustomer } | null> {
    const customer = await this.findCustomerByCnpj(cnpj);
    if (!customer) {
      return null;
    }

    const fields = 'AD1_FILIAL,AD1_NROPOR,AD1_REVISA,AD1_DESCRI,AD1_CODCLI,AD1_LOJCLI,AD1_VEND,AD1_STATUS';
    const branchClause = branchId ? ` AND AD1_FILIAL = '${String(branchId).trim()}'` : '';
    const where = `AD1_CODCLI = '${customer.code}' AND AD1_LOJCLI = '${customer.storeId}'${branchClause}`;
    const endpoint = `/api/framework/v1/genericQuery?tables=AD1&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=100`;

    console.log(`[ProtheusService][Busca Última Oportunidade AD1] GET ${endpoint}`);

    try {
      const response = await this.api.get(endpoint);
      const items: any[] = Array.isArray(response.data?.items) ? response.data.items : [];
      if (items.length === 0) {
        return null;
      }

      const mapped: ProtheusOpportunityRecord[] = items.map((r) => ({
        branchId: String(r.ad1_filial ?? r.AD1_FILIAL ?? branchId ?? '0101').trim(),
        opportunityId: String(r.ad1_nropor ?? r.AD1_NROPOR ?? '').trim(),
        revision: String(r.ad1_revisa ?? r.AD1_REVISA ?? '01').trim(),
        description: String(r.ad1_descri ?? r.AD1_DESCRI ?? '').trim(),
        customerCode: String(r.ad1_codcli ?? r.AD1_CODCLI ?? customer.code).trim(),
        storeId: String(r.ad1_lojcli ?? r.AD1_LOJCLI ?? customer.storeId).trim(),
        salesmanCode: String(r.ad1_vend ?? r.AD1_VEND ?? '000001').trim(),
        status: String(r.ad1_status ?? r.AD1_STATUS ?? '1').trim(),
      }));

      // Filtra oportunidades em aberto (AD1_STATUS === '1') e ordena pelo maior AD1_NROPOR
      const activeList = mapped.filter((o) => o.status === '1');
      const pool = activeList.length > 0 ? activeList : mapped;
      pool.sort((a, b) => b.opportunityId.localeCompare(a.opportunityId));

      return {
        opportunity: pool[0],
        customer,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * 3A. Consultar vários produtos na tabela SB1 do Protheus em lote pelo código (B1_COD)
   */
  public async findProductsByCodes(productCodes: string[]): Promise<Map<string, ProtheusProductInfo>> {
    const cleanCodes = [...new Set(productCodes.map((c) => String(c || '').trim()).filter(Boolean))];
    const map = new Map<string, ProtheusProductInfo>();
    if (cleanCodes.length === 0) return map;

    const fields =
      'B1_FILIAL,B1_COD,B1_DESC,B1_TIPO,B1_UM,B1_LOCPAD,B1_TS,B1_PRV1,B1_MSBLQL,B1_POSIPI,B1_ORIGEM,B1_CLASFIS,B1_GRTRIB,B1_PICM,B1_PICMRET';
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
          blocked: String(row.b1_msblql ?? row.B1_MSBLQL ?? '') === '1',
          ncm: String(row.b1_posipi ?? row.B1_POSIPI ?? '').trim(),
          origin: String(row.b1_origem ?? row.B1_ORIGEM ?? '0').trim() || '0',
          clasfis: String(row.b1_clasfis ?? row.B1_CLASFIS ?? '').trim(),
          taxGroup: String(row.b1_grtrib ?? row.B1_GRTRIB ?? '').trim(),
          picm: Number(row.b1_picm ?? row.B1_PICM ?? 0),
          mva: Number(row.b1_picmret ?? row.B1_PICMRET ?? 0),
        });
      }

      return map;
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }

  /**
   * 3B. Consultar na DA1/DA0 qual tabela de preço ativa contém os produtos informados
   */
  public async resolvePriceTableForProducts(
    productCodes: string[],
    preferredTables: string[] = []
  ): Promise<{
    tableId: string;
    coveredAll: boolean;
    matchingTables: string[];
    pricesByProduct: Record<string, number>;
  }> {
    const cleanCodes = [...new Set(productCodes.map((c) => String(c || '').trim()).filter(Boolean))];
    const fallback = preferredTables[0] || env.PROTHEUS_DEFAULT_PRICE_TABLE || '003';
    if (cleanCodes.length === 0) {
      return { tableId: fallback, coveredAll: false, matchingTables: [], pricesByProduct: {} };
    }

    const inList = cleanCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
    const da1Endpoint = `/api/framework/v1/genericQuery?tables=DA1&fields=DA1_CODTAB,DA1_CODPRO,DA1_PRCVEN,DA1_ATIVO&where=${encodeURIComponent(
      `DA1_CODPRO IN (${inList}) AND DA1_ATIVO = '1'`
    )}&pageSize=300`;

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

      const tablePrices = new Map<string, Map<string, number>>();
      for (const row of da1Res.data?.items || []) {
        const tab = String(row.da1_codtab ?? row.DA1_CODTAB ?? '').trim();
        const prod = String(row.da1_codpro ?? row.DA1_CODPRO ?? '').trim();
        const prc = Number(row.da1_prcven ?? row.DA1_PRCVEN ?? 0);
        if (!tab || !prod || prc <= 0 || !activeDa0.has(tab)) continue;
        if (!tablePrices.has(tab)) tablePrices.set(tab, new Map());
        tablePrices.get(tab)!.set(prod, prc);
      }

      const fullCoverageTables = [...tablePrices.entries()]
        .filter(([, prods]) => cleanCodes.every((c) => prods.has(c)))
        .map(([tab]) => tab);

      let chosenTable = fallback;
      let coveredAll = false;

      for (const pref of preferredTables) {
        if (fullCoverageTables.includes(pref)) {
          chosenTable = pref;
          coveredAll = true;
          break;
        }
      }

      if (!coveredAll && fullCoverageTables.length > 0) {
        fullCoverageTables.sort();
        chosenTable = fullCoverageTables[0];
        coveredAll = true;
      }

      if (!coveredAll) {
        for (const pref of preferredTables) {
          if (tablePrices.has(pref)) {
            chosenTable = pref;
            break;
          }
        }
      }

      const pricesMap = tablePrices.get(chosenTable) || new Map<string, number>();
      const pricesByProduct: Record<string, number> = {};
      for (const [k, v] of pricesMap.entries()) {
        pricesByProduct[k] = v;
      }

      return {
        tableId: chosenTable,
        coveredAll,
        matchingTables: fullCoverageTables,
        pricesByProduct,
      };
    } catch (err: any) {
      console.warn(`[ProtheusService] Aviso ao consultar DA1/DA0 (${err.message}). Usando tabela ${fallback}.`);
      return { tableId: fallback, coveredAll: false, matchingTables: [], pricesByProduct: {} };
    }
  }

  /**
   * 3C. Consultar os preços de uma lista de produtos em uma tabela específica da DA1
   */
  public async getProductPricesInTable(
    productCodes: string[],
    priceTable: string
  ): Promise<Record<string, number>> {
    const cleanCodes = [...new Set(productCodes.map((c) => String(c || '').trim()).filter(Boolean))];
    const table = String(priceTable || '').trim();
    if (cleanCodes.length === 0 || !table) return {};

    const inList = cleanCodes.map((c) => `'${c.replace(/'/g, "''")}'`).join(',');
    const where = `DA1_CODTAB = '${table.replace(/'/g, "''")}' AND DA1_CODPRO IN (${inList}) AND DA1_ATIVO = '1'`;
    const endpoint = `/api/framework/v1/genericQuery?tables=DA1&fields=DA1_CODTAB,DA1_CODPRO,DA1_PRCVEN&where=${encodeURIComponent(where)}&pageSize=100`;

    try {
      const response = await this.api.get(endpoint);
      const result: Record<string, number> = {};
      for (const row of response.data?.items || []) {
        const prod = String(row.da1_codpro ?? row.DA1_CODPRO ?? '').trim();
        const prc = Number(row.da1_prcven ?? row.DA1_PRCVEN ?? 0);
        if (prod && prc > 0) result[prod] = prc;
      }
      return result;
    } catch {
      return {};
    }
  }

  /**
   * 3D. Busca código do vendedor na tabela SA3 pelo e-mail do responsável no Bitrix
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
   * 4A. Consultar os itens gravados na tabela ADZ do Protheus após criar a Proposta Comercial,
   * obtendo os preços unitários exatos (ADZ_PRCVEN) calculados pelo motor do TOTVS Protheus.
   */
  public async getProposalItemsFromAdz(
    branchId: string,
    proposalId: string
  ): Promise<AdzSavedProposalItem[]> {
    const cleanBranch = String(branchId || '0101').trim();
    const cleanProp = String(proposalId || '').trim();
    if (!cleanProp) return [];

    const fields =
      'ADZ_FILIAL,ADZ_PROPOS,ADZ_REVISA,ADZ_ITEM,ADZ_PRODUT,ADZ_DESCRI,ADZ_UM,ADZ_QTDVEN,ADZ_PRCVEN,ADZ_PRCTAB,ADZ_TOTAL,ADZ_TES,ADZ_CONDPG,ADZ_ORCAME';
    const where = `ADZ_FILIAL = '${cleanBranch}' AND ADZ_PROPOS = '${cleanProp.replace(/'/g, "''")}'`;
    const endpoint = `/api/framework/v1/genericQuery?tables=ADZ&fields=${fields}&where=${encodeURIComponent(where)}&pageSize=100`;

    console.log(`[ProtheusService][Leitura Preços ADZ] GET ${endpoint}`);

    try {
      const response = await this.api.get(endpoint);
      const rows: any[] = Array.isArray(response.data?.items) ? response.data.items : [];

      return rows.map((r, idx) => ({
        item: String(r.adz_item ?? r.ADZ_ITEM ?? String(idx + 1).padStart(2, '0')).trim(),
        productCode: String(r.adz_produt ?? r.ADZ_PRODUT ?? '').trim(),
        description: String(r.adz_descri ?? r.ADZ_DESCRI ?? '').trim(),
        unitOfMeasure: String(r.adz_um ?? r.ADZ_UM ?? 'UN').trim(),
        quantity: Number(r.adz_qtdven ?? r.ADZ_QTDVEN ?? 1),
        unitPrice: Number(r.adz_prcven ?? r.ADZ_PRCVEN ?? 0),
        priceTableValue: Number(r.adz_prctab ?? r.ADZ_PRCTAB ?? 0),
        totalValue: Number(r.adz_total ?? r.ADZ_TOTAL ?? 0),
        outflowType: String(r.adz_tes ?? r.ADZ_TES ?? '').trim(),
        conditionPayment: String(r.adz_condpg ?? r.ADZ_CONDPG ?? '').trim(),
        budgetId: String(r.adz_orcame ?? r.ADZ_ORCAME ?? '').trim(),
        ncm: '',
        cst: '',
        icmsRate: 0,
        icmsValue: 0,
        stUnitValue: 0,
        stTotalValue: 0,
      }));
    } catch (error: any) {
      console.warn(`[ProtheusService] Aviso ao ler itens na ADZ da proposta ${cleanProp}: ${error.message}`);
      return [];
    }
  }

  /**
   * Calcula sempre +7 dias corridos (1 semana) a partir da data de emissão da proposta (ex: dia 07 -> vence dia 14).
   */
  private calculateSevenDayValidity(baseYmd?: string): { validityDate: string; validityDateBr: string } {
    let year: number;
    let month: number;
    let day: number;

    const clean = String(baseYmd || '').trim();
    if (/^\d{8}$/.test(clean)) {
      year = Number(clean.slice(0, 4));
      month = Number(clean.slice(4, 6));
      day = Number(clean.slice(6, 8));
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
      const parts = clean.split('-').map(Number);
      year = parts[0];
      month = parts[1];
      day = parts[2];
    } else {
      const brNow = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
      const parts = brNow.split('-').map(Number);
      year = parts[0];
      month = parts[1];
      day = parts[2];
    }

    const dt = new Date(Date.UTC(year, month - 1, day + 7));
    const yyyy = String(dt.getUTCFullYear());
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');

    return {
      validityDate: `${yyyy}-${mm}-${dd}`,
      validityDateBr: `${dd}/${mm}/${yyyy}`,
    };
  }

  /**
   * 4B-Aux. Calcula a validade da proposta (+7 dias a partir da emissão SCJ->CJ_EMISSAO) e consulta
   * o CST de cada item (SCK->CK_CLASFIS) gravados pelo MATA415/FATA600, além dos dados fiscais da TES na SF4.
   */
  public async getProposalFiscalMetadata(params: {
    branchId: string;
    proposalId: string;
    budgetId?: string;
    tesCodes: string[];
  }): Promise<{
    validityDate: string;
    validityDateBr: string;
    sckCstByItem: Map<string, string>;
    sckCstByProduct: Map<string, string>;
    sf4ByCode: Map<string, { icm: string; sitTrib: string; cf: string; mkpSol: string }>;
  }> {
    const cleanBranch = String(params.branchId || '0101').trim();
    const cleanProp = String(params.proposalId || '').trim();
    const cleanBudget = String(params.budgetId || '').trim();
    const uniqueTes = [...new Set(params.tesCodes.map((t) => String(t || '').trim()).filter(Boolean))];

    const scjWhere = cleanBudget
      ? `CJ_FILIAL = '${cleanBranch}' AND (CJ_NUM = '${cleanBudget.replace(/'/g, "''")}' OR CJ_PROPOST = '${cleanProp.replace(/'/g, "''")}')`
      : `CJ_FILIAL = '${cleanBranch}' AND CJ_PROPOST = '${cleanProp.replace(/'/g, "''")}'`;

    const sckWhere = cleanBudget
      ? `CK_FILIAL = '${cleanBranch}' AND (CK_NUM = '${cleanBudget.replace(/'/g, "''")}' OR CK_PROPOST = '${cleanProp.replace(/'/g, "''")}')`
      : `CK_FILIAL = '${cleanBranch}' AND CK_PROPOST = '${cleanProp.replace(/'/g, "''")}'`;

    const sf4In = uniqueTes.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');

    const [scjRes, sckRes, sf4Res] = await Promise.all([
      this.api
        .get(
          `/api/framework/v1/genericQuery?tables=SCJ&fields=CJ_FILIAL,CJ_NUM,CJ_PROPOST,CJ_EMISSAO,CJ_VALIDA&where=${encodeURIComponent(
            scjWhere
          )}&pageSize=5`
        )
        .then((r) => r.data?.items || [])
        .catch(() => []),
      this.api
        .get(
          `/api/framework/v1/genericQuery?tables=SCK&fields=CK_FILIAL,CK_NUM,CK_PROPOST,CK_ITEM,CK_PRODUTO,CK_TES,CK_CLASFIS&where=${encodeURIComponent(
            sckWhere
          )}&pageSize=100`
        )
        .then((r) => r.data?.items || [])
        .catch(() => []),
      uniqueTes.length > 0
        ? this.api
            .get(
              `/api/framework/v1/genericQuery?tables=SF4&fields=F4_CODIGO,F4_ICM,F4_SITTRIB,F4_CF,F4_MKPSOL&where=${encodeURIComponent(
                `F4_CODIGO IN (${sf4In})`
              )}&pageSize=50`
            )
            .then((r) => r.data?.items || [])
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    const rawEmissao = String(scjRes[0]?.cj_emissao ?? scjRes[0]?.CJ_EMISSAO ?? '').trim();
    const { validityDate, validityDateBr } = this.calculateSevenDayValidity(rawEmissao);

    const sckCstByItem = new Map<string, string>();
    const sckCstByProduct = new Map<string, string>();
    for (const row of sckRes) {
      const item = String(row.ck_item ?? row.CK_ITEM ?? '').trim().padStart(2, '0');
      const prod = String(row.ck_produto ?? row.CK_PRODUTO ?? '').trim();
      const cst = String(row.ck_clasfis ?? row.CK_CLASFIS ?? '').trim();
      if (cst) {
        if (item) sckCstByItem.set(item, cst);
        if (prod && !sckCstByProduct.has(prod)) sckCstByProduct.set(prod, cst);
      }
    }

    const sf4ByCode = new Map<string, { icm: string; sitTrib: string; cf: string; mkpSol: string }>();
    for (const row of sf4Res) {
      const code = String(row.f4_codigo ?? row.F4_CODIGO ?? '').trim();
      if (!code || sf4ByCode.has(code)) continue;
      sf4ByCode.set(code, {
        icm: String(row.f4_icm ?? row.F4_ICM ?? 'S').trim(),
        sitTrib: String(row.f4_sittrib ?? row.F4_SITTRIB ?? '00').trim(),
        cf: String(row.f4_cf ?? row.F4_CF ?? '').trim(),
        mkpSol: String(row.f4_mkpsol ?? row.F4_MKPSOL ?? '').trim(),
      });
    }

    return {
      validityDate,
      validityDateBr,
      sckCstByItem,
      sckCstByProduct,
      sf4ByCode,
    };
  }

  /**
   * 4B. Criar Proposta Comercial vinculada à Oportunidade (ADY / ADZ -> FATA600 via WSCROPP.prw)
   *
   * IMPORTANTE (Precificação Nativa no ERP):
   * Envia apenas os dados da proposta, filial, tabela de preço, TES, condição de pagamento e
   * a lista com código do produto (ADZ_PRODUT) e quantidade (ADZ_QTDVEN), SEM enviar preço unitário.
   * O próprio Protheus calcula o ADZ_PRCVEN e, em seguida, a API lê os valores gravados na ADZ.
   */
  public async createCommercialProposal(
    data: CreateProtheusProposalDTO
  ): Promise<ProtheusProposalResponse> {
    const [tenantCompany] = env.PROTHEUS_TENANT.split(',').map((s) => s.trim());
    const companyId = tenantCompany || '01';
    const branchId = String(data.branchId || env.PROTHEUS_DEFAULT_BRANCH || '0101').trim();
    const tenantId = `${companyId},${branchId}`;
    const opportunityId = String(data.opportunityId || '').trim();
    const opportunityRevision = String(data.opportunityRevision || '01').trim();

    if (!opportunityId) {
      throw new Error('O número da Oportunidade (opportunityId / AD1_NROPOR) é obrigatório para gerar a Proposta Comercial.');
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('A Proposta Comercial exige ao menos 1 produto na lista `items` (com `productCode` e `quantity`).');
    }

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

    const sb1Map = await this.findProductsByCodes(data.items.map((i) => i.productCode));

    const sentItems: EnrichedProposalItem[] = data.items.map((raw, idx) => {
      const itemNumber = raw.item || String(idx + 1).padStart(2, '0');
      const code = String(raw.productCode || '').trim();
      if (!code) {
        throw new Error(`Item ${itemNumber}: O código do produto (productCode) é obrigatório.`);
      }

      const sb1 = sb1Map.get(code);
      if (!sb1) {
        throw new Error(`Item ${itemNumber}: Produto "${code}" não encontrado na tabela SB1 do Protheus.`);
      }
      if (sb1.blocked) {
        throw new Error(`Item ${itemNumber}: Produto "${code}" (${sb1.description}) está bloqueado na SB1 (B1_MSBLQL = 1).`);
      }

      const quantity = Number(raw.quantity) > 0 ? Number(raw.quantity) : 1;
      const itemCondPg = String(raw.conditionPayment || conditionPayment).trim();
      const itemTes = String(
        raw.outflowType ||
          (sb1.defaultTes && Number(sb1.defaultTes) > 500 ? sb1.defaultTes : '') ||
          env.PROTHEUS_DEFAULT_TES ||
          '501'
      ).trim();

      return {
        item: itemNumber,
        productCode: sb1.code,
        description: raw.description || sb1.description,
        unitOfMeasure: raw.unitOfMeasure || sb1.unitOfMeasure || 'UN',
        warehouse: sb1.warehouse || '01',
        quantity,
        conditionPayment: itemCondPg,
        outflowType: itemTes,
      };
    });

    // Payload enviado ao WSCROPP.prw SEM unitPrice para que o Protheus calcule via tabela DA1 e FATA600
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
      items: sentItems.map((it) => ({
        item: it.item,
        productCode: it.productCode,
        description: it.description,
        unitOfMeasure: it.unitOfMeasure,
        warehouse: it.warehouse,
        quantity: it.quantity,
        conditionPayment: it.conditionPayment,
        outflowType: it.outflowType,
      })),
    };

    const customEndpoint = '/custom_opportunity/opportunity';
    console.log(`[ProtheusService][Criar Proposta Comercial ADY/ADZ] POST ${customEndpoint} (Oportunidade: ${opportunityId}, Tabela: ${priceTable})`);

    try {
      const maxAttempts = 3;
      let body: any = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await this.api.post(customEndpoint, customPayload, {
          headers: { TenantId: tenantId },
          timeout: 60000,
        });
        body = response.data;

        if (!body || body.success !== false) {
          if (attempt > 1) {
            console.log(
              `[ProtheusService][Proposta Comercial] ✅ Sucesso na tentativa ${attempt}/${maxAttempts} (próxima thread REST do Protheus).`
            );
          }
          break;
        }

        const errDetails = `${body.message || ''} ${body.details || ''}`;
        const isRetryableThreadError =
          /CLI_CODMUN|variable is not array|MATA415|ADY_OPORTU/i.test(errDetails);

        if (isRetryableThreadError && attempt < maxAttempts) {
          console.warn(
            `[ProtheusService][Proposta Comercial] ⚠️ Thread REST do Protheus com estado fiscal sujo na tentativa ${attempt}/${maxAttempts} (${body.message}). Retentando na próxima thread...`
          );
          continue;
        }

        break;
      }

      console.log('[ProtheusService][Proposta Comercial] Resposta do Protheus:', JSON.stringify(body, null, 2));

      if (body && body.success === false) {
        const err: any = new Error(
          `Falha na criação da Proposta Comercial (ADY/ADZ): ${body.message || ''} - ${body.details || ''}`
        );
        err.response = { status: 422, data: body };
        throw err;
      }

      const proposalId = String(
        body?.proposalId ?? body?.ProposalNumber ?? body?.ADY_PROPOS ?? body?.id ?? ''
      ).trim();

      if (!proposalId) {
        throw new Error(`Protheus não retornou o número da Proposta Comercial (ADY_PROPOS). Resposta: ${JSON.stringify(body)}`);
      }

      const proposalRevision = String(
        body?.proposalRevision ?? body?.ProposalReview ?? body?.ADY_PREVIS ?? '01'
      ).trim();

      // Lê os itens gravados na tabela ADZ para obter os preços unitários exatos calculados pelo TOTVS
      let savedAdzItems = await this.getProposalItemsFromAdz(branchId, proposalId);

      // Mapeia itens retornados diretamente pelo WSCROPP.prw (que podem conter MaFisRet)
      const bodyItemsByItem = new Map<string, any>();
      const bodyItemsByCode = new Map<string, any>();
      if (Array.isArray(body?.items)) {
        for (const [idx, it] of body.items.entries()) {
          const itemKey = String(it.item ?? String(idx + 1).padStart(2, '0')).trim().padStart(2, '0');
          const codeKey = String(it.productCode ?? '').trim();
          bodyItemsByItem.set(itemKey, it);
          if (codeKey && !bodyItemsByCode.has(codeKey)) bodyItemsByCode.set(codeKey, it);
        }
      }

      // Fallback para os itens retornados diretamente pelo WSCROPP.prw caso a query demore
      if (savedAdzItems.length === 0 && Array.isArray(body?.items)) {
        savedAdzItems = body.items.map((it: any, idx: number) => ({
          item: String(it.item ?? String(idx + 1).padStart(2, '0')).trim(),
          productCode: String(it.productCode ?? '').trim(),
          description: String(it.description ?? '').trim(),
          unitOfMeasure: String(it.unitOfMeasure ?? 'UN').trim(),
          quantity: Number(it.quantity ?? 1),
          unitPrice: Number(it.unitPrice ?? 0),
          priceTableValue: Number(it.priceTableValue ?? it.unitPrice ?? 0),
          totalValue: Number(it.totalValue ?? 0),
          outflowType: String(it.outflowType ?? '').trim(),
          conditionPayment: String(it.conditionPayment ?? conditionPayment).trim(),
          budgetId: String(it.budgetId ?? body?.budgetId ?? '').trim(),
          ncm: String(it.ncm ?? '').trim(),
          cst: String(it.cst ?? '').trim(),
          icmsRate: Number(it.icmsRate ?? 0),
          icmsValue: Number(it.icmsValue ?? 0),
          stUnitValue: Number(it.stUnitValue ?? 0),
          stTotalValue: Number(it.stTotalValue ?? 0),
        }));
      }

      const budgetId =
        String(body?.budgetId || savedAdzItems[0]?.budgetId || '').trim() || undefined;

      // Consulta metadados fiscais (SCJ->CJ_VALIDA, SCK->CK_CLASFIS, SF4) no Protheus
      const fiscalMeta = await this.getProposalFiscalMetadata({
        branchId,
        proposalId,
        budgetId,
        tesCodes: savedAdzItems.map((i) => i.outflowType),
      });

      const rawBodyValidity = String(body?.validityDate || '').trim();
      const validityDate = /^\d{4}-\d{2}-\d{2}$/.test(rawBodyValidity)
        ? rawBodyValidity
        : fiscalMeta.validityDate;
      const [vY, vM, vD] = validityDate.split('-');
      const validityDateBr = `${vD}/${vM}/${vY}`;

      // Enriquece cada item da ADZ com NCM (SB1), CST (SCK/SF4), % ICMS e Valor Unitário de ST
      savedAdzItems = savedAdzItems.map((adzItem) => {
        const paddedItem = adzItem.item.padStart(2, '0');
        const bodyItem = bodyItemsByItem.get(paddedItem) || bodyItemsByCode.get(adzItem.productCode);
        const sb1 = sb1Map.get(adzItem.productCode);
        const sf4 = fiscalMeta.sf4ByCode.get(adzItem.outflowType);

        const fallbackTax = fiscalService.calculateItemTaxesFallback({
          uf: data.uf || 'SP',
          isExempt: Boolean(data.isExempt),
          tes: adzItem.outflowType,
          f4Icm: sf4?.icm,
          f4SitTrib: sf4?.sitTrib,
          f4MkpSol: sf4?.mkpSol,
          productOrigin: sb1?.origin,
          productPicm: sb1?.picm,
          productMva: sb1?.mva,
          unitPrice: adzItem.unitPrice,
          quantity: adzItem.quantity,
        });

        const ncm = String(bodyItem?.ncm || adzItem.ncm || sb1?.ncm || '').trim();
        const cst = String(
          bodyItem?.cst ||
            adzItem.cst ||
            fiscalMeta.sckCstByItem.get(paddedItem) ||
            fiscalMeta.sckCstByProduct.get(adzItem.productCode) ||
            fallbackTax.cst
        ).trim();

        const hasBodyTax =
          bodyItem &&
          (Number(bodyItem.icmsRate) > 0 ||
            Number(bodyItem.stUnitValue) > 0 ||
            Number(bodyItem.stTotalValue) > 0);

        const icmsRate = hasBodyTax ? Number(bodyItem.icmsRate ?? 0) : fallbackTax.icmsRate;
        const icmsValue = hasBodyTax ? Number(bodyItem.icmsValue ?? 0) : fallbackTax.icmsValue;
        const stUnitValue = hasBodyTax ? Number(bodyItem.stUnitValue ?? 0) : fallbackTax.stUnitValue;
        const stTotalValue = hasBodyTax ? Number(bodyItem.stTotalValue ?? 0) : fallbackTax.stTotalValue;

        return {
          ...adzItem,
          ncm,
          cst,
          icmsRate,
          icmsValue,
          stUnitValue,
          stTotalValue,
        };
      });

      return {
        proposalId,
        proposalRevision,
        opportunityId,
        budgetId,
        validityDate,
        validityDateBr,
        branchId,
        priceTable,
        conditionPayment,
        sentItems,
        savedAdzItems,
        rawResponse: body,
      };
    } catch (error: any) {
      this.handleProtheusError(error);
    }
  }
}

export const protheusService = new ProtheusService();
