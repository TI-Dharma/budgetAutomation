import { env } from '../config/env';

export type AllowedBranch = '0101' | '0202';

export type SpecialOperationType =
  | 'VENDA'
  | 'SERVICO'
  | 'REMESSA_LOCACAO'
  | 'ORCAMENTO_LOCACAO'
  | 'DEMONSTRACAO_VENDA'
  | 'DEMONSTRACAO_LOCACAO';

export interface TesResolutionInput {
  branchId: string;
  uf: string;
  isExempt: boolean;
  productCode?: string;
  productDescription?: string;
  productType?: string; // B1_TIPO (ex: "SV" para serviço, "ME" mercadoria)
  operationType?: string;
  explicitTes?: string;
}

export interface TesResolutionResult {
  tes: string;
  cfopReference: string;
  ruleApplied: string;
  isProtocolState: boolean;
  isMaterialWithoutSt: boolean;
}

export interface PaymentConditionResolution {
  code: string;
  label: string;
  rawInput: string;
  usedFallback: boolean;
}

export interface ItemTaxCalculationInput {
  uf: string;
  isExempt: boolean;
  tes: string;
  f4Icm?: string;      // F4_ICM ("S" | "N")
  f4SitTrib?: string;  // F4_SITTRIB ("00" | "10" | "60" | "41" ...)
  f4MkpSol?: string;   // F4_MKPSOL ("1" | "2" | "")
  productOrigin?: string; // B1_ORIGEM ("0", "1", "2"...)
  productPicm?: number;   // B1_PICM
  productMva?: number;    // B1_PICMRET
  unitPrice: number;
  quantity: number;
}

export interface ItemTaxCalculationResult {
  cst: string;
  icmsRate: number;      // Alíquota % ICMS (ex: 0, 4, 7, 12, 18)
  icmsValue: number;     // Valor de ICMS da linha
  stUnitValue: number;   // Valor Unitário de ST (Valor Uni ST)
  stTotalValue: number;  // Valor Total de ST da linha
}

/** Estados Protocolados (Com ST - CFOP 6.404) */
export const PROTOCOL_STATES_0101_TES: Record<string, string> = {
  AL: '641', // ICMS 7%
  AP: '643', // ICMS 7%
  PE: '636', // ICMS 7%
  SE: '643', // ICMS 7%
  DF: '540', // ICMS 7%
  MA: '540', // ICMS 7%
  MT: '540', // ICMS 7%
  MS: '540', // ICMS 7%
  MG: '540', // ICMS 12%
  PR: '540', // ICMS 12%
  RJ: '540', // ICMS 12%
};

/** Estados Não Protocolados (Material sem ST - CFOP 5.102/6.102) */
export const NON_PROTOCOL_STATES = new Set<string>([
  'RS', 'SC', // ICMS 12%
  'AC', 'AM', 'BA', 'CE', 'ES', 'GO', 'PA', 'PB', 'PI', 'RN', 'RO', 'RR', 'TO', // ICMS 7%
]);

/** Alíquotas interestaduais de referência (7% vs 12% vs 18% SP) */
export const INTERSTATE_ICMS_12_STATES = new Set<string>(['MG', 'PR', 'RJ', 'RS', 'SC']);

/** Alíquotas internas de ICMS por UF (MV_ESTICM do Protheus) */
export const UF_INTERNAL_ICMS_RATE: Record<string, number> = {
  AC: 19,
  AL: 20,
  AM: 20,
  AP: 18,
  BA: 20.5,
  CE: 20,
  DF: 20,
  ES: 17,
  GO: 19,
  MA: 23,
  MG: 18,
  MS: 17,
  MT: 17,
  PA: 19,
  PB: 20,
  PE: 20.5,
  PI: 21,
  PR: 19.5,
  RJ: 22,
  RN: 20,
  RO: 19.5,
  RR: 17,
  RS: 17,
  SC: 17,
  SE: 19,
  SP: 18,
  TO: 20,
};

/**
 * Dicionário oficial De-Para de Condições de Pagamento (SE4)
 */
const PAYMENT_CONDITION_DESCRIPTIONS: Record<string, string> = {
  '002': 'À VISTA',
  '107': '05 DIAS (5 DDL)',
  '046': '21 DIAS (21 DDL)',
  '111': '28 DIAS (28 DDL)',
  '043': '30 DIAS (30 DDL)',
  '044': '45 DIAS (45 DDL)',
  '013': '60 DIAS (60 DDL)',
  '115': '70 DIAS (70 DDL)',
  '110': '90 DIAS (90 DDL)',
  '017': '15/45 DDL',
  '012': '0/30/45',
  '011': '0/30/60 (ENTRADA 30/60)',
  '009': '30/60 DDL',
  '042': '30/60/90 DDL',
  '156': 'ENTRADA 30/60/90',
  '094': '30/60/90/120 DDL',
};

const PAYMENT_CONDITION_ALIASES: Record<string, string> = {
  // 002 - À Vista (ID Enum Bitrix: 3416)
  '002': '002',
  '2': '002',
  '0': '002',
  '3416': '002',
  'A VISTA': '002',
  'AVISTA': '002',
  'A VISTA 0': '002',
  'PAGAMENTO A VISTA': '002',

  // 107 - 05 Dias (ID Enum Bitrix: 3418)
  '107': '107',
  '3418': '107',
  '05 DIAS': '107',
  '5 DIAS': '107',
  '05 DDL': '107',
  '5 DDL': '107',
  '5DIAS': '107',
  '5DDL': '107',
  'A PRAZO 5 DIAS': '107',
  'A PRAZO 05 DIAS': '107',

  // 046 - 21 Dias (ID Enum Bitrix: 3420)
  '046': '046',
  '46': '046',
  '3420': '046',
  '21 DIAS': '046',
  '21 DDL': '046',
  '21DIAS': '046',
  '21DDL': '046',
  'A PRAZO 21 DIAS': '046',

  // 111 - 28 Dias (ID Enum Bitrix: 3422)
  '111': '111',
  '3422': '111',
  '28 DIAS': '111',
  '28 DDL': '111',
  '28DIAS': '111',
  '28DDL': '111',
  'A PRAZO 28 DIAS': '111',

  // 043 - 30 Dias (ID Enum Bitrix: 3424)
  '043': '043',
  '43': '043',
  '3424': '043',
  '30 DIAS': '043',
  '30 DDL': '043',
  '30DIAS': '043',
  '30DDL': '043',
  'A PRAZO 30 DIAS': '043',

  // 044 - 45 Dias (ID Enum Bitrix: 3426)
  '044': '044',
  '44': '044',
  '3426': '044',
  '45 DIAS': '044',
  '45 DDL': '044',
  '45DIAS': '044',
  '45DDL': '044',
  'A PRAZO 45 DIAS': '044',

  // 013 - 60 Dias (ID Enum Bitrix: 3428)
  '013': '013',
  '13': '013',
  '3428': '013',
  '60 DIAS': '013',
  '60 DDL': '013',
  '60DIAS': '013',
  '60DDL': '013',
  'A PRAZO 60 DIAS': '013',

  // 115 - 70 Dias (ID Enum Bitrix: 3430)
  '115': '115',
  '3430': '115',
  '70 DIAS': '115',
  '70 DDL': '115',
  '70DIAS': '115',
  '70DDL': '115',
  'A PRAZO 70 DIAS': '115',

  // 110 - 90 Dias (ID Enum Bitrix: 3432)
  '110': '110',
  '3432': '110',
  '90 DIAS': '110',
  '90 DDL': '110',
  '90DIAS': '110',
  '90DDL': '110',
  'A PRAZO 90 DIAS': '110',

  // 017 - 15/45 (ID Enum Bitrix: 3434)
  '017': '017',
  '17': '017',
  '3434': '017',
  '15/45': '017',
  '15/45 DDL': '017',
  '15/45 DIAS': '017',
  '15/45DDL': '017',
  '15 45': '017',
  'PARCELADO 15/45': '017',
  'PARCELADO 2X 15/45 DIAS': '017',
  'PARCELADO 2X 15/45': '017',

  // 009 - 30/60 (ID Enum Bitrix: 3436)
  '009': '009',
  '9': '009',
  '3436': '009',
  '30/60': '009',
  '30/60 DDL': '009',
  '30/60 DIAS': '009',
  '30 60': '009',
  '30 60 DDL': '009',
  'PARCELADO 30/60': '009',
  'PARCELADO 2X 30/60 DIAS': '009',
  'PARCELADO 2X 30/60': '009',

  // 012 - 0/30/45 (ID Enum Bitrix: 3438)
  '012': '012',
  '12': '012',
  '3438': '012',
  '0/30/45': '012',
  '0/30/45 DDL': '012',
  '0/30/45 DIAS': '012',
  'ENTRADA 30/45': '012',
  'ENTRADA 2X 0/30/45 DIAS': '012',
  'ENTRADA 2X 0/30/45': '012',

  // 011 - 0/30/60 (ID Enum Bitrix: 3440)
  '011': '011',
  '11': '011',
  '3440': '011',
  '0/30/60': '011',
  '0/30/60 DDL': '011',
  '0/30/60 DIAS': '011',
  'ENTRADA 30/60': '011',
  'ENTRADA 2X 0/30/60 DIAS': '011',
  'ENTRADA 2X 0/30/60': '011',

  // 042 - 30/60/90 (ID Enum Bitrix: 3442)
  '042': '042',
  '42': '042',
  '3442': '042',
  '30/60/90': '042',
  '30/60/90 DDL': '042',
  '30/60/90 DD': '042',
  '30/60/90 DIAS': '042',
  '30 60 90': '042',
  'PARCELADO 30/60/90': '042',
  'PARCELADO 3X 30/60/90 DIAS': '042',
  'PARCELADO 3X 30/60/90': '042',

  // 156 - Entrada 30/60/90 (ID Enum Bitrix: 3444)
  '156': '156',
  '3444': '156',
  'ENTRADA 30/60/90': '156',
  '0/30/60/90': '156',
  '0/30/60/90 DDL': '156',
  'ENTRADA 3': '156',
  'ENTRADA 3X 0/30/60/90 DIAS': '156',
  'ENTRADA 3X 0/30/60/90': '156',

  // 094 - 30/60/90/120 (ID Enum Bitrix: 3446)
  '094': '094',
  '94': '094',
  '3446': '094',
  '30/60/90/120': '094',
  '30/60/90/120 DDL': '094',
  '30/60/90/120 DD': '094',
  '30/60/90/120 DIAS': '094',
  '30 60 90 120': '094',
  'PARCELADO 30/60/90/120': '094',
  'PARCELADO 4X 30/60/90/120 DIAS': '094',
  'PARCELADO 4X 30/60/90/120': '094',
};

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[-()+]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifica se a descrição do produto na SB1 enquadra na exceção de Material sem ST:
 * CAPA, CLIP, BATERIA ou RÁDIO MÓVEL
 */
export function isMaterialWithoutStDescription(description?: string): boolean {
  const norm = normalizeText(description || '');
  if (!norm) return false;
  const cleaned = norm.replace(
    /\bCARREGADOR(?:ES)?\s+(?:RAPIDOS?\s+)?(?:DE\s+|P\/\s*|PARA\s+)?BATERIAS?\b/g,
    'CARREGADOR'
  );
  return (
    /\bCAPAS?\b/.test(cleaned) ||
    /\bCLIPS?\b/.test(cleaned) ||
    /\bBATERIAS?\b/.test(cleaned) ||
    /\bRADIOS?\s+MOVE(?:L|IS)\b/.test(cleaned)
  );
}

/**
 * Normaliza o tipo de operação especial quando informado no payload (ou via ID da lista do Bitrix)
 */
function resolveSpecialOperationTes(
  branchId: AllowedBranch,
  operationType?: string
): { tes: string; cfop: string; rule: string } | null {
  const norm = normalizeText(operationType || '').replace(/[-_]/g, ' ');
  if (!norm || norm === 'VENDA' || norm === 'VENDA DE MERCADORIA' || norm === '3452' || norm === 'PADRAO' || norm === 'NORMAL') {
    return null;
  }

  if (norm.includes('SERVICO') || norm === '3454') {
    return {
      tes: '512',
      cfop: '5.933/6.933',
      rule: `Operação Específica: Serviço Prestado (${branchId})`,
    };
  }
  if ((norm.includes('REMESSA') && norm.includes('LOCACAO')) || norm === '3458') {
    return {
      tes: '622',
      cfop: '5.908/6.908',
      rule: 'Operação Específica: Remessa de Locação',
    };
  }
  if ((norm.includes('ORCAMENTO') && norm.includes('LOCACAO')) || norm === 'LOCACAO' || norm === '3456') {
    return {
      tes: '617',
      cfop: '5.303',
      rule: 'Operação Específica: Orçamento de Locação',
    };
  }
  if ((norm.includes('DEMONSTRACAO') && norm.includes('LOCACAO')) || norm === '3462') {
    return {
      tes: '558',
      cfop: '5.912/6.912',
      rule: 'Operação Específica: Demonstração Estoque Locação',
    };
  }
  if (norm.includes('DEMONSTRACAO') || norm === '3460') {
    return {
      tes: '525',
      cfop: '5.912/6.912',
      rule: 'Operação Específica: Demonstração Estoque Venda',
    };
  }

  return null;
}

export class FiscalService {
  /**
   * Determina automaticamente a TES (ADZ_TES) conforme Filial (0101 DHARMACOM vs 0202 DHARMASERV),
   * UF do cliente, regime fiscal (Isento vs Contribuinte), descrição do produto na SB1 e operação especial.
   */
  public resolveTes(input: TesResolutionInput): TesResolutionResult {
    const branchId = String(input.branchId || env.PROTHEUS_DEFAULT_BRANCH || '0101').trim() as AllowedBranch;
    if (branchId !== '0101' && branchId !== '0202') {
      throw new Error(`Filial inválida para Matriz Fiscal: "${branchId}". Permitidas: 0101 (DHARMACOM), 0202 (DHARMASERV).`);
    }

    const uf = String(input.uf || '').trim().toUpperCase();
    if (!uf || uf.length !== 2) {
      throw new Error(`UF inválida para cálculo de TES na Matriz Fiscal: "${input.uf}".`);
    }

    const isExempt = Boolean(input.isExempt);
    const isProtocolState = Object.prototype.hasOwnProperty.call(PROTOCOL_STATES_0101_TES, uf);
    const isMaterialWithoutSt = isMaterialWithoutStDescription(input.productDescription);

    // 0. TES explícita enviada no item (se for código de 3 dígitos > 500)
    const explicit = String(input.explicitTes || '').trim();
    if (/^\d{3}$/.test(explicit) && Number(explicit) > 500) {
      return {
        tes: explicit,
        cfopReference: 'EXPLICITO_PAYLOAD',
        ruleApplied: `TES informada explicitamente no payload (${explicit})`,
        isProtocolState,
        isMaterialWithoutSt,
      };
    }

    // 0B. Operações Específicas (Serviço, Locação, Demonstração)
    const specialOp = resolveSpecialOperationTes(branchId, input.operationType);
    if (specialOp) {
      return {
        tes: specialOp.tes,
        cfopReference: specialOp.cfop,
        ruleApplied: specialOp.rule,
        isProtocolState,
        isMaterialWithoutSt,
      };
    }

    // Se o produto na SB1 for do tipo Serviço (B1_TIPO === 'SV'), aplica TES 512
    if (String(input.productType || '').trim().toUpperCase() === 'SV') {
      return {
        tes: '512',
        cfopReference: '5.933/6.933',
        ruleApplied: `Produto tipo Serviço (B1_TIPO=SV) na filial ${branchId}`,
        isProtocolState,
        isMaterialWithoutSt,
      };
    }

    // =========================================================================
    // A. FILIAL 0101 — DHARMACOM
    // =========================================================================
    if (branchId === '0101') {
      // 1. Cliente Isento / Não Contribuinte (sem IE): TES = "542" (CFOP 6.108 - não gera DIFAL)
      if (isExempt) {
        return {
          tes: '542',
          cfopReference: '6.108',
          ruleApplied: 'Filial 0101 (DHARMACOM) - Cliente Isento / Não Contribuinte (sem IE)',
          isProtocolState,
          isMaterialWithoutSt,
        };
      }

      // 3. Exceção de Material sem ST (CAPA, CLIP, BATERIA ou RÁDIO MÓVEL): TES = "501"
      if (isMaterialWithoutSt) {
        return {
          tes: '501',
          cfopReference: uf === 'SP' ? '5.102' : '6.102',
          ruleApplied: `Filial 0101 (DHARMACOM) - Exceção de Material sem ST (CAPA/CLIP/BATERIA/RÁDIO MÓVEL) para ${uf}`,
          isProtocolState,
          isMaterialWithoutSt,
        };
      }

      // 2. Cliente Contribuinte de São Paulo (UF === "SP"): TES = "502" (CFOP 5.405)
      if (uf === 'SP') {
        return {
          tes: '502',
          cfopReference: '5.405',
          ruleApplied: 'Filial 0101 (DHARMACOM) - Cliente Contribuinte SP',
          isProtocolState: false,
          isMaterialWithoutSt: false,
        };
      }

      // 4. Cliente Contribuinte — Estados Protocolados (Com ST - CFOP 6.404)
      if (isProtocolState) {
        const protocolTes = PROTOCOL_STATES_0101_TES[uf];
        return {
          tes: protocolTes,
          cfopReference: '6.404',
          ruleApplied: `Filial 0101 (DHARMACOM) - Cliente Contribuinte em Estado Protocolado (${uf} ➔ TES ${protocolTes})`,
          isProtocolState: true,
          isMaterialWithoutSt: false,
        };
      }

      // 5. Cliente Contribuinte — Estados Não Protocolados (Material sem ST - CFOP 5.102/6.102): TES = "501"
      return {
        tes: '501',
        cfopReference: '6.102',
        ruleApplied: `Filial 0101 (DHARMACOM) - Cliente Contribuinte em Estado Não Protocolado (${uf} ➔ TES 501)`,
        isProtocolState: false,
        isMaterialWithoutSt,
      };
    }

    // =========================================================================
    // B. FILIAL 0202 — DHARMASERV
    // =========================================================================
    // 1. Cliente Isento / Não Contribuinte: TES = "501" (CFOP 6.108)
    if (isExempt) {
      return {
        tes: '501',
        cfopReference: '6.108',
        ruleApplied: 'Filial 0202 (DHARMASERV) - Cliente Isento / Não Contribuinte (sem IE)',
        isProtocolState,
        isMaterialWithoutSt,
      };
    }

    // 2. Cliente de São Paulo (UF === "SP"): TES = "513" (CFOP 5.405)
    if (uf === 'SP') {
      return {
        tes: '513',
        cfopReference: '5.405',
        ruleApplied: 'Filial 0202 (DHARMASERV) - Cliente Contribuinte SP',
        isProtocolState: false,
        isMaterialWithoutSt,
      };
    }

    // 3. Cliente Contribuinte — Estados Protocolados (AL, AP, DF, MA, MT, MS, MG, PR, PE, RJ, SE): TES = "504" (CFOP 6.404)
    if (isProtocolState && !isMaterialWithoutSt) {
      return {
        tes: '504',
        cfopReference: '6.404',
        ruleApplied: `Filial 0202 (DHARMASERV) - Cliente Contribuinte em Estado Protocolado (${uf} ➔ TES 504)`,
        isProtocolState: true,
        isMaterialWithoutSt: false,
      };
    }

    // 4. Cliente Contribuinte — Estados Não Protocolados (ou Material sem ST): TES = "502" (CFOP 5.102/6.102)
    return {
      tes: '502',
      cfopReference: '6.102',
      ruleApplied: `Filial 0202 (DHARMASERV) - Cliente Contribuinte Material sem ST / Estado Não Protocolado (${uf} ➔ TES 502)`,
      isProtocolState,
      isMaterialWithoutSt,
    };
  }

  /**
   * Traduz a condição de pagamento enviada no webhook (texto, ID de enumeração Bitrix ou código)
   * para o código de 3 dígitos da SE4. NÃO calcula por faixa de valor.
   */
  public resolvePaymentCondition(rawCondition?: string | number | null): PaymentConditionResolution {
    const rawStr = String(rawCondition ?? '').trim();

    if (!rawStr) {
      const fallback = env.PROTHEUS_DEFAULT_PAYMENT_TERM || '043';
      return {
        code: fallback,
        label: PAYMENT_CONDITION_DESCRIPTIONS[fallback] || fallback,
        rawInput: '',
        usedFallback: true,
      };
    }

    const normalized = normalizeText(rawStr);
    const mapped = PAYMENT_CONDITION_ALIASES[normalized];
    if (mapped) {
      return {
        code: mapped,
        label: PAYMENT_CONDITION_DESCRIPTIONS[mapped] || mapped,
        rawInput: rawStr,
        usedFallback: false,
      };
    }

    // Busca flexível caso venha texto como "A Prazo - 05 Dias" ou "Parcelado 2x (30/60 Dias)"
    for (const [aliasKey, se4Code] of Object.entries(PAYMENT_CONDITION_ALIASES)) {
      if (aliasKey.length >= 4 && normalized.includes(aliasKey)) {
        return {
          code: se4Code,
          label: PAYMENT_CONDITION_DESCRIPTIONS[se4Code] || se4Code,
          rawInput: rawStr,
          usedFallback: false,
        };
      }
    }

    // Código numérico de 3 dígitos já existente na SE4
    if (/^\d{3}$/.test(normalized)) {
      return {
        code: normalized,
        label: PAYMENT_CONDITION_DESCRIPTIONS[normalized] || `Código SE4 ${normalized}`,
        rawInput: rawStr,
        usedFallback: false,
      };
    }

    const acceptedList = Object.entries(PAYMENT_CONDITION_DESCRIPTIONS)
      .map(([code, desc]) => `${code} (${desc})`)
      .join(', ');

    throw new Error(
      `Condição de pagamento inválida ou não mapeada: "${rawStr}". Valores aceitos: ${acceptedList}.`
    );
  }

  /**
   * Calcula CST, % ICMS e Valor Unitário ST seguindo as regras do motor fiscal MATXFIS do Protheus
   * (usado como fallback caso o WSCROPP.prw ainda não tenha retornado os campos diretamente via MaFisRet).
   */
  public calculateItemTaxesFallback(input: ItemTaxCalculationInput): ItemTaxCalculationResult {
    const uf = String(input.uf || 'SP').trim().toUpperCase();
    const origin = String(input.productOrigin ?? '0').trim() || '0';
    const sitTrib = String(
      input.f4SitTrib ||
        (input.tes === '502' || input.tes === '513'
          ? '60'
          : ['540', '636', '641', '643'].includes(input.tes)
            ? '10'
            : '00')
    ).trim();
    const cst = `${origin}${sitTrib}`;

    const calculatesIcm =
      input.f4Icm !== undefined
        ? input.f4Icm.toUpperCase() === 'S'
        : !['502', '512', '513', '525', '558', '617', '622'].includes(input.tes);

    let icmsRate = 0;
    if (calculatesIcm) {
      if (uf === 'SP') {
        icmsRate = input.productPicm && input.productPicm > 0 ? input.productPicm : 18;
      } else {
        // Operação interestadual saindo de SP (MV_ESTADO = SP)
        const isImported = ['1', '2', '3', '8'].includes(origin);
        if (isImported && !input.isExempt) {
          icmsRate = 4;
        } else if (INTERSTATE_ICMS_12_STATES.has(uf)) {
          icmsRate = 12;
        } else {
          icmsRate = 7;
        }
      }
    }

    const qty = input.quantity > 0 ? input.quantity : 1;
    const totalLine = input.unitPrice * qty;
    const icmsValue = Number(((totalLine * icmsRate) / 100).toFixed(2));

    // Cálculo de ICMS-ST nas TES com Substituição Tributária (540, 636, 641, 643)
    const isStTes = ['540', '636', '641', '643'].includes(input.tes) || sitTrib === '10';
    let stUnitValue = 0;
    let stTotalValue = 0;

    if (isStTes && input.unitPrice > 0) {
      const aliqInterna = UF_INTERNAL_ICMS_RATE[uf] || 18;
      if (input.tes === '540') {
        // Conforme SD2 do Protheus para TES 540: Base ST = Valor Total e ST = Base * (AliqSol - AliqIcm)
        const diffRate = Math.max(0, aliqInterna - icmsRate);
        stUnitValue = Number(((input.unitPrice * diffRate) / 100).toFixed(2));
        stTotalValue = Number((stUnitValue * qty).toFixed(2));
      } else {
        // TES 636, 641, 643: aplica MVA quando existente
        const mva = input.productMva && input.productMva > 0 ? input.productMva : 25;
        const baseStUnit = input.unitPrice * (1 + mva / 100);
        const stCalc = (baseStUnit * aliqInterna) / 100 - (input.unitPrice * icmsRate) / 100;
        stUnitValue = Number(Math.max(0, stCalc).toFixed(2));
        stTotalValue = Number((stUnitValue * qty).toFixed(2));
      }
    }

    return {
      cst,
      icmsRate,
      icmsValue,
      stUnitValue,
      stTotalValue,
    };
  }

  /**
   * Lista de prioridade de Tabelas de Preço (DA0) conforme Filial, UF, Isenção e Operação.
   */
  public getPreferredPriceTables(params: {
    branchId: string;
    uf: string;
    isExempt: boolean;
    operationType?: string;
    primaryTes?: string;
  }): string[] {
    const branchId = String(params.branchId || '0101').trim();
    const uf = String(params.uf || 'SP').trim().toUpperCase();
    const opNorm = normalizeText(params.operationType || '');

    if (opNorm.includes('LOCACAO') || opNorm === '3456' || opNorm === '3458') {
      return ['022', '003', '004', '005'];
    }

    if (branchId === '0202') {
      if (params.primaryTes === '513' || (!params.isExempt && uf === 'SP')) {
        return ['001', '002', '003'];
      }
      return ['002', '001', '003'];
    }

    // Filial 0101 (DHARMACOM)
    if (params.isExempt) {
      return ['024', '023', '025', '026', '027', '028', '029', '030', '003'];
    }
    if (uf === 'SP') {
      return ['003', '004', '005'];
    }
    if (INTERSTATE_ICMS_12_STATES.has(uf)) {
      return ['005', '003', '004'];
    }
    return ['004', '003', '005'];
  }
}

export const fiscalService = new FiscalService();
