import dotenv from 'dotenv';

dotenv.config();

export interface EnvConfig {
  PORT: number;
  PROTHEUS_API_URL: string;
  PROTHEUS_USER: string;
  PROTHEUS_PASS: string;
  PROTHEUS_TENANT: string;
  PROTHEUS_DEFAULT_PAYMENT_TERM: string;
  PROTHEUS_DEFAULT_TES: string;
  PROTHEUS_DEFAULT_PRICE_TABLE: string;
  PROTHEUS_DEFAULT_DELIVERY_DAYS: string;
  PROTHEUS_DEFAULT_FREIGHT_TYPE: string;
  PROTHEUS_DEFAULT_SALESMAN: string;
  PROTHEUS_DEFAULT_PROCESS: string;
  PROTHEUS_DEFAULT_STAGE: string;
}

function getEnvOrThrow(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return value;
}

export const env: EnvConfig = {
  PORT: Number(process.env.PORT) || 3000,
  PROTHEUS_API_URL: getEnvOrThrow('PROTHEUS_API_URL').replace(/\/+$/, ''),
  PROTHEUS_USER: getEnvOrThrow('PROTHEUS_USER'),
  PROTHEUS_PASS: getEnvOrThrow('PROTHEUS_PASS'),
  PROTHEUS_TENANT: getEnvOrThrow('PROTHEUS_TENANT', '01,0101'),
  // Padrões para Proposta Comercial (ADY / ADZ - FATA600) e Pedido (SC5 / SC6 - MATA410)
  PROTHEUS_DEFAULT_PAYMENT_TERM: process.env.PROTHEUS_DEFAULT_PAYMENT_TERM || '043',
  PROTHEUS_DEFAULT_TES: process.env.PROTHEUS_DEFAULT_TES || '501',
  PROTHEUS_DEFAULT_PRICE_TABLE: process.env.PROTHEUS_DEFAULT_PRICE_TABLE || '003',
  PROTHEUS_DEFAULT_DELIVERY_DAYS: process.env.PROTHEUS_DEFAULT_DELIVERY_DAYS || '10',
  PROTHEUS_DEFAULT_FREIGHT_TYPE: process.env.PROTHEUS_DEFAULT_FREIGHT_TYPE || 'C',
  // Padrões para criação de Oportunidade no CRM (FATA300 / AD1)
  PROTHEUS_DEFAULT_SALESMAN: process.env.PROTHEUS_DEFAULT_SALESMAN || '000001',
  PROTHEUS_DEFAULT_PROCESS: process.env.PROTHEUS_DEFAULT_PROCESS || '000001',
  PROTHEUS_DEFAULT_STAGE: process.env.PROTHEUS_DEFAULT_STAGE || '000001',
};
