export interface TranslatedError {
  errorCode: string;
  friendlyMessage: string;
  actionHint: string;
  technicalError: string;
  httpStatus: number;
}

/**
 * Traduz erros técnicos do TOTVS Protheus, Bitrix24, CNPJ.ws e validações fiscais
 * em diagnósticos claros e acionáveis (usados tanto no retorno HTTP quanto na aba "Erro" do Bitrix24).
 */
export function translateIntegrationError(error: any): TranslatedError {
  const rawMessage = String(
    error?.response?.data?.errorMessage ||
      error?.response?.data?.message ||
      error?.response?.data?.details ||
      error?.message ||
      error ||
      'Erro desconhecido na integração.'
  ).trim();

  const status = Number(error?.response?.status) || Number(error?.httpStatus) || 500;

  if (/CLI_CODMUN/i.test(rawMessage) || /variable is not array/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_TRIGGER_CLI_CODMUN',
      friendlyMessage:
        'Bloqueio no gatilho fiscal/municipal (CLI_CODMUN) do Protheus durante a geração do orçamento (MATA415/SCJ).',
      actionHint:
        'Verifique o cadastro de município/CEP do cliente na SA1 (A1_COD_MUN / A1_CEPC / A1_NATUREZ) ou recompile o WSCROPP.prw atualizado no AppServer REST.',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/ADY_OPORTU.*n[aã]o foi preenchido/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_FATA600_MISSING_OPPORTUNITY',
      friendlyMessage:
        'O modelo MVC da Proposta Comercial (FATA600) não recebeu ou limpou o vínculo da Oportunidade (ADY_OPORTU).',
      actionHint:
        'Recompile o fonte WSCROPP.prw atualizado (com LoadValue em ADY_OPORTU) e verifique se a oportunidade AD1 está ativa na filial informada.',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/FT300PENDF/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_FATA300_REVISION_LOCK',
      friendlyMessage:
        'A Oportunidade de Venda (AD1) possui bloqueio/pendência de revisão no CRM do Protheus (AJUDA: FT300PENDF).',
      actionHint:
        'Crie uma nova Oportunidade na Etapa 1 (/webhook/bitrix/opportunity) ou verifique as propostas já sincronizadas nessa oportunidade.',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/A1_MSBLQL/i.test(rawMessage) || /cliente bloqueado/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_CUSTOMER_BLOCKED',
      friendlyMessage: 'O cliente encontra-se bloqueado no cadastro do TOTVS Protheus (SA1 - A1_MSBLQL = 1).',
      actionHint: 'Desbloqueie o cliente na rotina MATA030 (Clientes) no Protheus antes de gerar a oportunidade/proposta.',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/B1_MSBLQL/i.test(rawMessage) || /produto.*bloqueado/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_PRODUCT_BLOCKED',
      friendlyMessage: 'Um ou mais produtos estão bloqueados no cadastro do Protheus (SB1 - B1_MSBLQL = 1).',
      actionHint: 'Desbloqueie o produto na tabela SB1 do Protheus ou substitua o item no orçamento do Bitrix24.',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/n[aã]o encontrado.*SB1/i.test(rawMessage) || /produtos n[aã]o foram encontrados.*SB1/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_PRODUCT_NOT_FOUND_SB1',
      friendlyMessage: 'Um ou mais códigos de produto do orçamento não existem na tabela SB1 do TOTVS Protheus.',
      actionHint:
        'Confira se o nome do produto no Bitrix24 inicia com o código exato da SB1 separado por " - " (ex: "PMPN4468A - CARREGADOR...").',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/Condi[cç][aã]o de pagamento inv[aá]lida/i.test(rawMessage) || /ExistCpo.*SE4/i.test(rawMessage)) {
    return {
      errorCode: 'INVALID_PAYMENT_CONDITION_SE4',
      friendlyMessage: 'A condição de pagamento informada não foi reconhecida ou não existe na tabela SE4 do Protheus.',
      actionHint:
        'Envie uma condição válida (ex: "À Vista"/"002", "30 dias"/"043", "30/60"/"009", "30/60/90"/"042", "21 dias"/"046", "28 dias"/"111", "45 dias"/"044", "60 dias"/"013").',
      technicalError: rawMessage,
      httpStatus: 400,
    };
  }

  if (/MaVldTabPrc/i.test(rawMessage) || /tabela de pre[cç]o/i.test(rawMessage) || /DA1/i.test(rawMessage)) {
    return {
      errorCode: 'PROTHEUS_PRICE_TABLE_INVALID',
      friendlyMessage: 'Falha de validação na Tabela de Preço (DA0/DA1) ou produto sem preço cadastrado no Protheus.',
      actionHint:
        'Verifique se a tabela de preço está ativa/dentro da validade na DA0 e se todos os produtos possuem preço maior que zero na DA1.',
      technicalError: rawMessage,
      httpStatus: 422,
    };
  }

  if (/Nenhuma Oportunidade ativa/i.test(rawMessage) || (/Oportunidade/i.test(rawMessage) && /nao encontrada/i.test(rawMessage))) {
    return {
      errorCode: 'PROTHEUS_OPPORTUNITY_NOT_FOUND',
      friendlyMessage: 'Não foi encontrada uma Oportunidade de Venda (AD1) ativa no Protheus para este cliente/ID.',
      actionHint:
        'Execute primeiro a Etapa 1 (POST /webhook/bitrix/opportunity) para gerar a Oportunidade (AD1) ou informe um opportunityId válido.',
      technicalError: rawMessage,
      httpStatus: 404,
    };
  }

  if (/CNPJ/i.test(rawMessage) && (/inv[aá]lido/i.test(rawMessage) || /n[aã]o encontrado/i.test(rawMessage) || /429/i.test(rawMessage))) {
    return {
      errorCode: 'CNPJ_VALIDATION_ERROR',
      friendlyMessage: 'Não foi possível validar o CNPJ do cliente no Bitrix24 ou na API pública (cnpj.ws).',
      actionHint:
        'Verifique se o CNPJ de 14 dígitos está preenchido corretamente na Empresa/Negócio/Orçamento no Bitrix24.',
      technicalError: rawMessage,
      httpStatus: /429/.test(rawMessage) ? 429 : 400,
    };
  }

  if (/timeout/i.test(rawMessage) || /ECONNREFUSED/i.test(rawMessage) || /ENOTFOUND/i.test(rawMessage)) {
    return {
      errorCode: 'EXTERNAL_SERVICE_UNAVAILABLE',
      friendlyMessage: 'Falha de comunicação ou tempo limite excedido (timeout) ao conectar ao TOTVS Protheus ou Bitrix24.',
      actionHint: 'Verifique se o serviço AppServer REST do Protheus (porta 8887) está online e acessível na rede.',
      technicalError: rawMessage,
      httpStatus: 503,
    };
  }

  return {
    errorCode: 'INTEGRATION_EXECUTION_ERROR',
    friendlyMessage: rawMessage,
    actionHint: 'Consulte o detalhe técnico no log do orçamento e valide os dados do cliente e dos produtos no Protheus.',
    technicalError: rawMessage,
    httpStatus: status >= 400 && status < 600 ? status : 500,
  };
}
