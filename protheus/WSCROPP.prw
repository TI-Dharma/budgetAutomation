#Include "TOTVS.ch"
#Include "RESTFUL.ch"
#Include "FWMVCDEF.ch"

/*/{Protheus.doc} WSCROPP
    WebService REST para criacao de Oportunidades de Venda (AD1 - FATA300)
    e Propostas Comerciais vinculadas (ADY/ADZ - FATA600)
/*/
WSRESTFUL custom_opportunity DESCRIPTION "Integracao de Oportunidades e Propostas Comerciais CRM"
    WSDATA cResponse AS CHARACTER

    WSMETHOD POST MAIN DESCRIPTION "Criar Oportunidade ou Proposta Comercial" WSSYNTAX "/opportunity" PATH "/opportunity"
END WSRESTFUL

WSMETHOD POST MAIN WSRESTFUL custom_opportunity
    Local cBody     := Self:GetContent()
    Local oJson     := JsonObject():New()
    Local oResponse := JsonObject():New()

    Self:SetContentType("application/json; charset=utf-8")

    If oJson:FromJson(cBody) != Nil
        SetRestFault(400, "JSON invalido no corpo da requisicao")
        Return .F.
    EndIf

    // Se receber opportunityId preenchido, cria a Proposta Comercial (ADY/ADZ) vinculada a Oportunidade
    If oJson:HasProperty("opportunityId") .And. !Empty(oJson["opportunityId"])
        fCreateProp(oJson, @oResponse)
    Else
        // Caso contrario, cria a Oportunidade de Venda (AD1)
        fCreateOpp(oJson, @oResponse)
    EndIf

    Self:SetResponse(oResponse:ToJson())
Return .T.

//=============================================================================
// FUNCAO 1: Criar Oportunidade de Venda (FATA300 / AD1)
//=============================================================================
Static Function fCreateOpp(oJson, oResponse)
    Local aAD1     := {}
    Local cFil     := "0101"
    Local cCodCli  := ""
    Local cLojCli  := "0001"
    Local cVend    := "000001"
    Local cDescri  := "OPORTUNIDADE BITRIX"
    Local cProcess := "000001"
    Local cStage   := "000001"
    Local cNrOpor  := ""
    Local dData    := dDataBase

    If oJson:HasProperty("branchId") .And. !Empty(oJson["branchId"])
        cFil := PadR(AllTrim(oJson["branchId"]), TamSX3("AD1_FILIAL")[1])
    EndIf
    If oJson:HasProperty("customerCode") .And. !Empty(oJson["customerCode"])
        cCodCli := PadR(AllTrim(oJson["customerCode"]), TamSX3("AD1_CODCLI")[1])
    EndIf
    If oJson:HasProperty("storeId") .And. !Empty(oJson["storeId"])
        cLojCli := PadR(AllTrim(oJson["storeId"]), TamSX3("AD1_LOJCLI")[1])
    EndIf
    If oJson:HasProperty("salesmanCode") .And. !Empty(oJson["salesmanCode"])
        cVend := PadR(AllTrim(oJson["salesmanCode"]), TamSX3("AD1_VEND")[1])
    EndIf
    If oJson:HasProperty("description") .And. !Empty(oJson["description"])
        cDescri := SubStr(AllTrim(oJson["description"]), 1, TamSX3("AD1_DESCRI")[1])
    EndIf
    If oJson:HasProperty("process") .And. !Empty(oJson["process"])
        cProcess := PadR(AllTrim(oJson["process"]), TamSX3("AD1_PROVEN")[1])
    EndIf
    If oJson:HasProperty("stage") .And. !Empty(oJson["stage"])
        cStage := PadR(AllTrim(oJson["stage"]), TamSX3("AD1_STAGE")[1])
    EndIf

    cNrOpor := GetSxeNum("AD1", "AD1_NROPOR")

    aAdd(aAD1, {"AD1_FILIAL", cFil,            Nil})
    aAdd(aAD1, {"AD1_NROPOR", cNrOpor,         Nil})
    aAdd(aAD1, {"AD1_REVISA", "01",            Nil})
    aAdd(aAD1, {"AD1_DESCRI", cDescri,         Nil})
    aAdd(aAD1, {"AD1_DATA",   dData,           Nil})
    aAdd(aAD1, {"AD1_HORA",   Left(Time(), 5), Nil})
    aAdd(aAD1, {"AD1_USER",   "000000",        Nil})
    aAdd(aAD1, {"AD1_VEND",   cVend,           Nil})
    aAdd(aAD1, {"AD1_CODCLI", cCodCli,         Nil})
    aAdd(aAD1, {"AD1_LOJCLI", cLojCli,         Nil})
    aAdd(aAD1, {"AD1_PROVEN", cProcess,        Nil})
    aAdd(aAD1, {"AD1_STAGE",  cStage,          Nil})
    aAdd(aAD1, {"AD1_MOEDA",  1,               Nil})
    aAdd(aAD1, {"AD1_PRIOR",  "1",             Nil})
    aAdd(aAD1, {"AD1_MODO",   "1",             Nil})
    aAdd(aAD1, {"AD1_DTINI",  dData,           Nil})

    Private lMsErroAuto := .F.
    MSExecAuto({|x, y| FATA300(x, y)}, 3, aAD1)

    If lMsErroAuto
        RollBackSX8()
        oResponse["success"] := .F.
        oResponse["message"] := "Erro no MsExecAuto da FATA300"
        oResponse["details"] := MostraErro("/temp", "erro_fata300.log")
        Return Nil
    EndIf

    ConfirmSX8()

    oResponse["success"]       := .T.
    oResponse["message"]       := "Oportunidade criada com sucesso"
    oResponse["opportunityId"] := AD1->AD1_NROPOR
    oResponse["revision"]      := AD1->AD1_REVISA
    oResponse["description"]   := AllTrim(AD1->AD1_DESCRI)
    oResponse["customerCode"]  := AllTrim(AD1->AD1_CODCLI)
    oResponse["storeId"]       := AllTrim(AD1->AD1_LOJCLI)
    oResponse["salesmanCode"]  := AllTrim(AD1->AD1_VEND)
Return Nil

//=============================================================================
// FUNCAO 2: Criar Proposta Comercial vinculada (FATA600 / ADY + ADZ)
//=============================================================================
Static Function fCreateProp(oJson, oResponse)
    Local cFil     := "0101"
    Local cNrOpor  := ""
    Local cCodCli  := ""
    Local cLojCli  := "0001"
    Local cVend    := "000001"
    Local cCondPg  := "043"
    Local cTabela  := "003"
    Local cPrazo   := "10"
    Local cFrete   := "C"
    Local aItems   := {}
    Local oModel   := Nil
    Local oAdy     := Nil
    Local oAdz     := Nil
    Local aErro    := {}
    Local nI       := 0
    Local cCodProd := ""
    Local nQtd     := 0
    Local nPrc     := 0
    Local cItemTes := "501"
    Local cItemCnd := "043"
    Local cPropos  := ""
    Local cPrevis  := "01"
    Local cOrcame  := ""

    If oJson:HasProperty("branchId") .And. !Empty(oJson["branchId"])
        cFil := PadR(AllTrim(oJson["branchId"]), TamSX3("AD1_FILIAL")[1])
    EndIf
    If oJson:HasProperty("opportunityId") .And. !Empty(oJson["opportunityId"])
        cNrOpor := PadR(AllTrim(oJson["opportunityId"]), TamSX3("AD1_NROPOR")[1])
    EndIf
    If oJson:HasProperty("customerCode") .And. !Empty(oJson["customerCode"])
        cCodCli := PadR(AllTrim(oJson["customerCode"]), TamSX3("ADY_CODIGO")[1])
    EndIf
    If oJson:HasProperty("storeId") .And. !Empty(oJson["storeId"])
        cLojCli := PadR(AllTrim(oJson["storeId"]), TamSX3("ADY_LOJA")[1])
    EndIf
    If oJson:HasProperty("salesmanCode") .And. !Empty(oJson["salesmanCode"])
        cVend := PadR(AllTrim(oJson["salesmanCode"]), TamSX3("ADY_VEND")[1])
    EndIf
    If oJson:HasProperty("conditionPayment") .And. !Empty(oJson["conditionPayment"])
        cCondPg := PadR(AllTrim(oJson["conditionPayment"]), TamSX3("ADY_CONDPG")[1])
    EndIf
    If oJson:HasProperty("priceTable") .And. !Empty(oJson["priceTable"])
        cTabela := PadR(AllTrim(oJson["priceTable"]), TamSX3("ADY_TABELA")[1])
    EndIf
    If oJson:HasProperty("deliveryDays") .And. !Empty(oJson["deliveryDays"])
        cPrazo := SubStr(AllTrim(cValToChar(oJson["deliveryDays"])), 1, TamSX3("ADY_ZZPRAZ")[1])
    EndIf
    If oJson:HasProperty("freightType") .And. !Empty(oJson["freightType"])
        cFrete := SubStr(Upper(AllTrim(oJson["freightType"])), 1, 1)
    EndIf
    If oJson:HasProperty("items") .And. ValType(oJson["items"]) == "A"
        aItems := oJson["items"]
    EndIf

    If Len(aItems) == 0
        oResponse["success"] := .F.
        oResponse["message"] := "A lista de produtos (items) nao pode estar vazia."
        Return Nil
    EndIf

    // 1. Posiciona na Oportunidade (AD1)
    DbSelectArea("AD1")
    AD1->(DbSetOrder(1))
    If !AD1->(DbSeek(cFil + cNrOpor))
        oResponse["success"] := .F.
        oResponse["message"] := "Oportunidade " + AllTrim(cNrOpor) + " nao encontrada na filial " + AllTrim(cFil)
        Return Nil
    EndIf

    If Empty(cCodCli)
        cCodCli := AD1->AD1_CODCLI
    EndIf
    If Empty(cLojCli)
        cLojCli := AD1->AD1_LOJCLI
    EndIf
    If Empty(cVend)
        cVend := AD1->AD1_VEND
    EndIf

    DbSelectArea("SA1")
    SA1->(DbSetOrder(1))
    SA1->(DbSeek(xFilial("SA1") + cCodCli + cLojCli))

    // 2. Carrega e ativa o modelo MVC da Proposta Comercial (FATA600)
    SetFunName("FATA600")
    oModel := FWLoadModel("FATA600")
    oModel:SetOperation(MODEL_OPERATION_INSERT)

    If !oModel:Activate()
        aErro := oModel:GetErrorMessage()
        oResponse["success"] := .F.
        oResponse["message"] := "Falha ao ativar o modelo FATA600"
        oResponse["details"] := AllToChar(aErro[4]) + " - " + AllToChar(aErro[6])
        Return Nil
    EndIf

    // 3. Preenche Cabecalho da Proposta Comercial (ADYMASTER)
    oAdy := oModel:GetModel("ADYMASTER")
    oAdy:SetValue("ADY_OPORTU", AD1->AD1_NROPOR)
    oAdy:SetValue("ADY_REVISA", AD1->AD1_REVISA)
    oAdy:SetValue("ADY_ENTIDA", "1")
    oAdy:SetValue("ADY_CODIGO", cCodCli)
    oAdy:SetValue("ADY_LOJA",   cLojCli)
    oAdy:SetValue("ADY_CLIENT", cCodCli)
    oAdy:SetValue("ADY_LOJENT", cLojCli)
    oAdy:SetValue("ADY_VEND",   cVend)
    oAdy:SetValue("ADY_TABELA", cTabela)
    oAdy:SetValue("ADY_ZZPRAZ", cPrazo)
    oAdy:SetValue("ADY_ZZFRT",  cFrete)

    // 4. Preenche Itens da Proposta Comercial (ADZPRODUTO)
    oAdz := oModel:GetModel("ADZPRODUTO")
    DbSelectArea("SB1")
    SB1->(DbSetOrder(1))

    For nI := 1 To Len(aItems)
        If nI > 1
            oAdz:AddLine()
        EndIf

        cCodProd := PadR(AllTrim(cValToChar(aItems[nI]["productCode"])), TamSX3("ADZ_PRODUT")[1])
        nQtd     := Val(cValToChar(aItems[nI]["quantity"]))
        nPrc     := Val(cValToChar(aItems[nI]["unitPrice"]))

        If nQtd <= 0
            nQtd := 1
        EndIf

        cItemCnd := cCondPg
        If aItems[nI]:HasProperty("conditionPayment") .And. !Empty(aItems[nI]["conditionPayment"])
            cItemCnd := PadR(AllTrim(cValToChar(aItems[nI]["conditionPayment"])), TamSX3("ADZ_CONDPG")[1])
        EndIf

        cItemTes := "501"
        If aItems[nI]:HasProperty("outflowType") .And. !Empty(aItems[nI]["outflowType"])
            cItemTes := PadR(AllTrim(cValToChar(aItems[nI]["outflowType"])), TamSX3("ADZ_TES")[1])
        ElseIf SB1->(DbSeek(xFilial("SB1") + cCodProd)) .And. !Empty(SB1->B1_TS) .And. SB1->B1_TS > "500"
            cItemTes := SB1->B1_TS
        EndIf

        SB1->(DbSeek(xFilial("SB1") + cCodProd))

        oAdz:SetValue("ADZ_ITEM",   StrZero(nI, TamSX3("ADZ_ITEM")[1]))
        oAdz:SetValue("ADZ_PRODUT", cCodProd)
        oAdz:SetValue("ADZ_CONDPG", cItemCnd)
        oAdz:SetValue("ADZ_TES",    cItemTes)
        oAdz:SetValue("ADZ_QTDVEN", nQtd)

        // Se unitPrice nao foi enviado (<= 0), usa o preco da tabela (ADZ_PRCTAB) ou B1_PRV1 da SB1
        If nPrc <= 0
            If oAdz:GetValue("ADZ_PRCTAB") > 0
                nPrc := oAdz:GetValue("ADZ_PRCTAB")
            ElseIf SB1->B1_PRV1 > 0
                nPrc := SB1->B1_PRV1
            EndIf
        EndIf

        If nPrc > 0
            If oAdz:GetValue("ADZ_PRCTAB") <= 0
                oAdz:SetValue("ADZ_PRCTAB", nPrc)
            EndIf
            oAdz:SetValue("ADZ_PRCVEN", nPrc)
        EndIf
    Next nI

    // 5. Valida e Comita a Proposta Comercial
    Private lMsErroAuto := .F.
    If oModel:VldData() .And. oModel:CommitData()
        cPropos := oAdy:GetValue("ADY_PROPOS")
        cPrevis := oAdy:GetValue("ADY_PREVIS")
        cOrcame := oAdz:GetValue("ADZ_ORCAME")

        oModel:DeActivate()
        oModel:Destroy()

        DbSelectArea("ADY")
        ADY->(DbSetOrder(1))
        If lMsErroAuto .Or. !ADY->(DbSeek(cFil + cPropos))
            oResponse["success"] := .F.
            oResponse["message"] := "Erro ao gravar orcamento (MATA415/SCJ) vinculado a Proposta Comercial"
            oResponse["details"] := MostraErro("/temp", "erro_fata600.log")
            Return Nil
        EndIf

        oResponse["success"]          := .T.
        oResponse["message"]          := "Proposta Comercial criada com sucesso"
        oResponse["proposalId"]       := AllTrim(cPropos)
        oResponse["proposalRevision"] := AllTrim(cPrevis)
        oResponse["opportunityId"]    := AllTrim(AD1->AD1_NROPOR)
        oResponse["budgetId"]         := AllTrim(cOrcame)
        oResponse["customerCode"]     := AllTrim(cCodCli)
        oResponse["storeId"]          := AllTrim(cLojCli)
        oResponse["salesmanCode"]     := AllTrim(cVend)
    Else
        aErro := oModel:GetErrorMessage()
        oModel:DeActivate()
        oModel:Destroy()

        oResponse["success"] := .F.
        oResponse["message"] := "Erro na validacao/gravacao da Proposta Comercial (FATA600)"
        oResponse["details"] := "Form: " + AllToChar(aErro[1]) + " | Campo: " + AllToChar(aErro[2]) + " | Erro: " + AllToChar(aErro[5]) + " | Msg: " + AllToChar(aErro[6]) + " | Solucao: " + AllToChar(aErro[7])
    EndIf
Return Nil
