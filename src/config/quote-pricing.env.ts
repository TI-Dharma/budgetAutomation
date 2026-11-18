import dotenv from 'dotenv';

dotenv.config();

/**
 * Configuração da rota de atualização de preços de orçamentos (Bitrix24 + PostgreSQL).
 *
 * As variáveis são validadas de forma "preguiçosa" (somente quando a rota é chamada),
 * para não derrubar o servidor nem a rota de pedidos do Protheus caso ainda não estejam definidas.
 */
function required(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return value.trim();
}

export const quotePricingEnv = {
  /** URL base do webhook de entrada do Bitrix24, ex: https://portal.bitrix24.com.br/rest/16668/TOKEN/ */
  get bitrixWebhookUrl(): string {
    const url = required('BITRIX_WEBHOOK_URL');
    return url.endsWith('/') ? url : `${url}/`;
  },

  /** STATUS_ID da etapa "Preço Atualizado" no orçamento */
  get quotePriceUpdatedStatus(): string {
    return process.env.BITRIX_QUOTE_PRICE_UPDATED_STATUS?.trim() || 'UC_1KJDXH';
  },

  /** Campo personalizado do ORÇAMENTO que guarda o CNPJ do cliente */
  get quoteCnpjField(): string {
    return process.env.BITRIX_QUOTE_CNPJ_FIELD?.trim() || 'UF_CRM_5EF5FA28D794B';
  },

  /** Campo personalizado do NEGÓCIO (card) que guarda o CNPJ do cliente */
  get dealCnpjField(): string {
    return process.env.BITRIX_DEAL_CNPJ_FIELD?.trim() || 'UF_CRM_1574685317';
  },

  /** Campo personalizado da EMPRESA que guarda o CNPJ */
  get companyCnpjField(): string {
    return process.env.BITRIX_COMPANY_CNPJ_FIELD?.trim() || 'UF_CRM_1568309909';
  },

  /** URL da API pública de CNPJ (o CNPJ é concatenado ao final) */
  get cnpjApiUrl(): string {
    const url = process.env.CNPJ_API_URL?.trim() || 'https://publica.cnpj.ws/cnpj/';
    return url.endsWith('/') ? url : `${url}/`;
  },

  get pg() {
    return {
      host: required('PG_HOST'),
      port: Number(process.env.PG_PORT) || 5432,
      database: required('PG_DATABASE'),
      user: required('PG_USER'),
      password: required('PG_PASSWORD'),
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };
  },

  /** Margens de lucro (padrões iguais ao fluxo do n8n) */
  get marginExempt(): number {
    return Number(process.env.PRICING_MARGIN_EXEMPT) || 0.30;
  },
  get marginTaxpayer(): number {
    return Number(process.env.PRICING_MARGIN_TAXPAYER) || 0.25;
  },
};
