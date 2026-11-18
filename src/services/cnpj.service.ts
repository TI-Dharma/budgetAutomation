import axios from 'axios';
import { quotePricingEnv } from '../config/quote-pricing.env';

export interface CnpjFiscalInfo {
  cnpj: string;
  uf: string;
  stateRegistrations: any[];
  isExempt: boolean;
  /** Dados cadastrais retornados pela API publica (uteis caso o cliente ainda nao exista na SA1) */
  companyDetails: {
    legalName?: string;
    tradeName?: string;
    email?: string;
    phone?: string;
    address?: string;
    neighborhood?: string;
    city?: string;
    cityIbgeCode?: string;
    state?: string;
    zipCode?: string;
    stateRegistration?: string;
  };
}

/**
 * Consulta a API pública https://publica.cnpj.ws para descobrir o estado (UF),
 * se o cliente possui Inscrição Estadual (sem IE => isento) e dados cadastrais completos.
 */
export class CnpjService {
  public async getFiscalInfo(cnpj: string): Promise<CnpjFiscalInfo> {
    const cleanCnpj = String(cnpj || '').replace(/\D/g, '');
    if (cleanCnpj.length !== 14) {
      throw new Error(`CNPJ inválido: "${cnpj}". Informe 14 dígitos.`);
    }

    const url = `${quotePricingEnv.cnpjApiUrl}${cleanCnpj}`;
    console.log(`[CnpjService] GET ${url}`);

    try {
      const { data } = await axios.get(url, { timeout: 20000 });

      const est = data?.estabelecimento;
      const uf = est?.estado?.sigla;
      if (!uf) {
        throw new Error(`A API de CNPJ não retornou o estado (sigla) para o CNPJ ${cleanCnpj}.`);
      }

      const stateRegistrations: any[] = Array.isArray(est?.inscricoes_estaduais)
        ? est.inscricoes_estaduais
        : [];

      const activeIe =
        stateRegistrations.find((ie) => ie?.ativo === true && ie?.inscricao_estadual) ??
        stateRegistrations.find((ie) => ie?.inscricao_estadual);

      const street = [est?.tipo_logradouro, est?.logradouro].filter(Boolean).join(' ').trim();
      const number = est?.numero ? String(est.numero).trim() : '';
      const fullAddress = [street, number].filter(Boolean).join(', ');

      const fullIbge = est?.cidade?.ibge_id ? String(est.cidade.ibge_id).replace(/\D/g, '') : '';
      const protheusCityCode = fullIbge.length === 7 ? fullIbge.slice(2) : undefined;

      const phone = est?.ddd1 && est?.telefone1 ? `${est.ddd1}${est.telefone1}` : undefined;

      return {
        cnpj: cleanCnpj,
        uf: String(uf).toUpperCase(),
        stateRegistrations,
        isExempt: stateRegistrations.length === 0,
        companyDetails: {
          legalName: data?.razao_social ? String(data.razao_social).trim() : undefined,
          tradeName: est?.nome_fantasia ? String(est.nome_fantasia).trim() : undefined,
          email: est?.email ? String(est.email).trim() : undefined,
          phone,
          address: fullAddress || undefined,
          neighborhood: est?.bairro ? String(est.bairro).trim() : undefined,
          city: est?.cidade?.nome ? String(est.cidade.nome).trim().toUpperCase() : undefined,
          cityIbgeCode: protheusCityCode,
          state: String(uf).toUpperCase(),
          zipCode: est?.cep ? String(est.cep).replace(/\D/g, '') : undefined,
          stateRegistration: activeIe?.inscricao_estadual
            ? String(activeIe.inscricao_estadual).trim()
            : stateRegistrations.length === 0
              ? 'ISENTO'
              : undefined,
        },
      };
    } catch (error: any) {
      if (error?.response?.status === 429) {
        throw new Error(
          'Limite de consultas da API pública de CNPJ atingido (HTTP 429). Aguarde 1 minuto e tente novamente.'
        );
      }
      if (error?.response?.status === 404) {
        throw new Error(`CNPJ ${cleanCnpj} não encontrado na API pública de CNPJ.`);
      }
      throw error;
    }
  }
}

export const cnpjService = new CnpjService();
