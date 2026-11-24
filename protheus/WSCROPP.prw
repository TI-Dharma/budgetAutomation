#Include "TOTVS.ch"
#Include "RESTFUL.ch"
#Include "FWMVCDEF.ch"

/*/{Protheus.doc} WSCROPP
    WebService REST para criacao de Oportunidades de Venda (AD1 - FATA300)
    e Propostas Comerciais vinculadas (ADY/ADZ - FATA600) com precificacao nativa
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
    Local cErrFile := ""

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

    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .F.

    cErrFile := "erro_f300_" + AllTrim(cNrOpor) + "_" + StrTran(Time(), ":", "") + ".log"

    MSExecAuto({|x, y| FATA300(x, y)}, 3, aAD1)

    If lMsErroAuto
        RollBackSX8()
        oResponse["success"] := .F.
        oResponse["message"] := "Erro no MsExecAuto da FATA300"
        oResponse["details"] := MostraErro("/temp", cErrFile)
        FErase("/temp/" + cErrFile)
        Return Nil
    EndIf

    ConfirmSX8()

    oResponse["success"]       := .T.
    oResponse["message"]       := "Oportunidade criada com sucesso"
    oResponse["opportunityId"] := AllTrim(AD1->AD1_NROPOR)
    oResponse["revision"]      := AllTrim(AD1->AD1_REVISA)
    oResponse["description"]   := AllTrim(AD1->AD1_DESCRI)
    oResponse["customerCode"]  := AllTrim(AD1->AD1_CODCLI)
    oResponse["storeId"]       := AllTrim(AD1->AD1_LOJCLI)
    oResponse["salesmanCode"]  := AllTrim(AD1->AD1_VEND)
Return Nil

//=============================================================================
// FUNCAO 2: Criar Proposta Comercial vinculada (FATA600 / ADY + ADZ)
//=============================================================================
Static Function fCreateProp(oJson, oResponse)
    Local cFil        := "0101"
    Local cNrOpor     := ""
    Local cCodCli     := ""
    Local cLojCli     := "0001"
    Local cVend       := "000001"
    Local cCondPg     := "043"
    Local cTabela     := "003"
    Local cPrazo      := "10"
    Local cFrete      := "C"
    Local aItems      := {}
    Local aSavedItems := {}
    Local oSavedItem  := Nil
    Local oModel      := Nil
    Local oAdy        := Nil
    Local oAdz        := Nil
    Local aErro       := {}
    Local nI          := 0
    Local cCodProd    := ""
    Local nQtd        := 0
    Local nPrc        := 0
    Local nPrcCalc    := 0
    Local cItemTes    := "501"
    Local cItemCnd    := "043"
    Local cPropos     := ""
    Local cPrevis     := "01"
    Local cOrcame     := ""
    Local cValida     := ""
    Local cItemNum    := ""
    Local cNcm        := ""
    Local cCst        := ""
    Local nAliqIcm    := 0
    Local nValIcm     := 0
    Local nValSt      := 0
    Local nUniSt      := 0
    Local lFisOk      := .F.
    Local bOldFisErr  := Nil
    Local aLogErro    := {}
    Local cErrMsg     := ""
    Local cErrFile    := ""
    Local cOppNum     := ""
    Local cOppRev     := ""

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

    cOppNum := AD1->AD1_NROPOR
    cOppRev := AD1->AD1_REVISA

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
    Private lMsErroAuto    := .F.
    Private lMsHelpAuto    := .T.
    Private lAutoErrNoFile := .F.
    Private INCLUI         := .T.
    Private ALTERA         := .F.
    Private aRotina        := {}

    // Limpa eventual estado fiscal residual (MATXFIS) na thread REST antes de ativar o FATA600
    If MaFisFound()
        MaFisEnd()
    EndIf

    // Garante posicionamento na AD1 imediatamente antes do Activate (X3_RELACAO de ADY_OPORTU)
    DbSelectArea("AD1")
    AD1->(DbSetOrder(1))
    AD1->(DbSeek(cFil + cNrOpor))

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
    If Empty(oAdy:GetValue("ADY_OPORTU")) .Or. oAdy:GetValue("ADY_OPORTU") != cOppNum
        If !oAdy:SetValue("ADY_OPORTU", cOppNum)
            oAdy:LoadValue("ADY_OPORTU", cOppNum)
        EndIf
    EndIf
    If Empty(oAdy:GetValue("ADY_REVISA")) .Or. oAdy:GetValue("ADY_REVISA") != cOppRev
        If !oAdy:SetValue("ADY_REVISA", cOppRev)
            oAdy:LoadValue("ADY_REVISA", cOppRev)
        EndIf
    EndIf

    oAdy:SetValue("ADY_ENTIDA", "1")
    oAdy:SetValue("ADY_CODIGO", cCodCli)
    oAdy:SetValue("ADY_LOJA",   cLojCli)
    oAdy:SetValue("ADY_CLIENT", cCodCli)
    oAdy:SetValue("ADY_LOJENT", cLojCli)
    oAdy:SetValue("ADY_VEND",   cVend)
    oAdy:SetValue("ADY_CONDPG", cCondPg)
    oAdy:SetValue("ADY_TABELA", cTabela)
    oAdy:SetValue("ADY_ZZPRAZ", cPrazo)
    oAdy:SetValue("ADY_ZZFRT",  cFrete)

    // Reforca ADY_OPORTU/ADY_REVISA caso algum gatilho de cliente/tabela tenha limpado
    If Empty(oAdy:GetValue("ADY_OPORTU")) .Or. oAdy:GetValue("ADY_OPORTU") != cOppNum
        oAdy:LoadValue("ADY_OPORTU", cOppNum)
        oAdy:LoadValue("ADY_REVISA", cOppRev)
    EndIf

    // 4. Preenche Itens da Proposta Comercial (ADZPRODUTO)
    // Precificacao Nativa: quando unitPrice nao e enviado (<= 0), o proprio Protheus
    // calcula ADZ_PRCTAB e ADZ_PRCVEN a partir da tabela de preco (DA1) e gatilhos da FATA600.
    oAdz := oModel:GetModel("ADZPRODUTO")
    DbSelectArea("SB1")
    SB1->(DbSetOrder(1))
    DbSelectArea("DA1")
    DA1->(DbSetOrder(1))

    For nI := 1 To Len(aItems)
        If nI > 1
            oAdz:AddLine()
        EndIf

        cCodProd := PadR(AllTrim(cValToChar(aItems[nI]["productCode"])), TamSX3("ADZ_PRODUT")[1])
        nQtd     := Val(cValToChar(aItems[nI]["quantity"]))
        nPrc     := 0
        If aItems[nI]:HasProperty("unitPrice") .And. aItems[nI]["unitPrice"] != Nil
            nPrc := Val(cValToChar(aItems[nI]["unitPrice"]))
        EndIf

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

        If nPrc > 0
            // Override manual de preco enviado no payload
            If oAdz:GetValue("ADZ_PRCTAB") <= 0
                oAdz:SetValue("ADZ_PRCTAB", nPrc)
            EndIf
            oAdz:SetValue("ADZ_PRCVEN", nPrc)
        Else
            // Precificacao automatica nativa pelo Protheus (FATA600 / DA1 / SB1)
            If oAdz:GetValue("ADZ_PRCVEN") <= 0
                nPrcCalc := oAdz:GetValue("ADZ_PRCTAB")
                If nPrcCalc <= 0 .And. DA1->(DbSeek(xFilial("DA1") + cTabela + cCodProd)) .And. DA1->DA1_PRCVEN > 0
                    nPrcCalc := DA1->DA1_PRCVEN
                EndIf
                If nPrcCalc <= 0 .And. SB1->B1_PRV1 > 0
                    nPrcCalc := SB1->B1_PRV1
                EndIf
                If nPrcCalc > 0
                    If oAdz:GetValue("ADZ_PRCTAB") <= 0
                        oAdz:SetValue("ADZ_PRCTAB", nPrcCalc)
                    EndIf
                    oAdz:SetValue("ADZ_PRCVEN", nPrcCalc)
                EndIf
            ElseIf oAdz:GetValue("ADZ_PRCTAB") <= 0
                oAdz:SetValue("ADZ_PRCTAB", oAdz:GetValue("ADZ_PRCVEN"))
            EndIf
        EndIf
    Next nI

    // 5. Valida e Comita a Proposta Comercial
    lMsErroAuto := .F.
    cErrFile    := "erro_f600_" + AllTrim(cOppNum) + "_" + StrTran(Time(), ":", "") + ".log"

    If oModel:VldData() .And. oModel:CommitData()
        cPropos := oAdy:GetValue("ADY_PROPOS")
        cPrevis := oAdy:GetValue("ADY_PREVIS")
        cOrcame := oAdz:GetValue("ADZ_ORCAME")

        For nI := 1 To oAdz:Length()
            oAdz:GoLine(nI)
            oSavedItem := JsonObject():New()
            oSavedItem["item"]             := AllTrim(oAdz:GetValue("ADZ_ITEM"))
            oSavedItem["productCode"]      := AllTrim(oAdz:GetValue("ADZ_PRODUT"))
            oSavedItem["description"]      := AllTrim(oAdz:GetValue("ADZ_DESCRI"))
            oSavedItem["unitOfMeasure"]    := AllTrim(oAdz:GetValue("ADZ_UM"))
            oSavedItem["quantity"]         := oAdz:GetValue("ADZ_QTDVEN")
            oSavedItem["unitPrice"]        := oAdz:GetValue("ADZ_PRCVEN")
            oSavedItem["priceTableValue"]  := oAdz:GetValue("ADZ_PRCTAB")
            oSavedItem["totalValue"]       := oAdz:GetValue("ADZ_TOTAL")
            oSavedItem["outflowType"]      := AllTrim(oAdz:GetValue("ADZ_TES"))
            oSavedItem["conditionPayment"] := AllTrim(oAdz:GetValue("ADZ_CONDPG"))
            oSavedItem["budgetId"]         := AllTrim(oAdz:GetValue("ADZ_ORCAME"))
            aAdd(aSavedItems, oSavedItem)
        Next nI

        oModel:DeActivate()
        oModel:Destroy()

        DbSelectArea("ADY")
        ADY->(DbSetOrder(1))
        If lMsErroAuto .Or. !ADY->(DbSeek(cFil + cPropos))
            aLogErro := GetAutoGRLog()
            cErrMsg  := ""
            For nI := 1 To Len(aLogErro)
                cErrMsg += aLogErro[nI] + CRLF
            Next nI
            If Empty(cErrMsg)
                cErrMsg := MostraErro("/temp", cErrFile)
            EndIf
            FErase("/temp/" + cErrFile)

            oResponse["success"]  := .F.
            oResponse["message"]  := "Erro ao gravar orcamento (MATA415/SCJ) vinculado a Proposta Comercial"
            oResponse["details"]  := cErrMsg
            oResponse["sx7Debug"] := fSx7Debug()
            oResponse["envDebug"] := fEnvDebug()
            Return Nil
        EndIf

        FErase("/temp/" + cErrFile)

        // 6. Forca a Validade da Proposta para sempre +7 dias a partir da data da proposta (SCJ->CJ_VALIDA := dDataBase + 7)
        cValida := Transform(DtoS(dDataBase + 7), "@R 9999-99-99")
        If !Empty(cOrcame)
            DbSelectArea("SCJ")
            SCJ->(DbSetOrder(1))
            If SCJ->(DbSeek(cFil + PadR(AllTrim(cOrcame), TamSX3("CJ_NUM")[1])))
                dDtBaseVal := IIf(!Empty(SCJ->CJ_EMISSAO), SCJ->CJ_EMISSAO, dDataBase)
                RecLock("SCJ", .F.)
                SCJ->CJ_VALIDA := dDtBaseVal + 7
                SCJ->(MsUnlock())
                cValida := Transform(DtoS(SCJ->CJ_VALIDA), "@R 9999-99-99")
            EndIf
        EndIf

        // Calcula impostos via motor fiscal MATXFIS (ICMS e Valor Unitario de ST)
        lFisOk     := .F.
        bOldFisErr := ErrorBlock({|e| Break(e)})
        Begin Sequence
            If MaFisFound()
                MaFisEnd()
            EndIf
            DbSelectArea("SA1")
            SA1->(DbSetOrder(1))
            SA1->(DbSeek(xFilial("SA1") + cCodCli + cLojCli))

            MaFisIni(cCodCli, cLojCli, "C", "N", SA1->A1_TIPO, MaFisRelImp("MT100", {"SF2", "SD2"}), , .F., "SB1", "MATA415")
            For nI := 1 To Len(aSavedItems)
                cCodProd := PadR(AllTrim(aSavedItems[nI]["productCode"]), TamSX3("B1_COD")[1])
                cItemTes := PadR(AllTrim(aSavedItems[nI]["outflowType"]), TamSX3("F4_CODIGO")[1])
                nQtd     := aSavedItems[nI]["quantity"]
                nPrc     := aSavedItems[nI]["unitPrice"]
                MaFisAdd(cCodProd, cItemTes, nQtd, nPrc, 0, "", "", , 0, 0, 0, 0, Round(nQtd * nPrc, 2), 0)
            Next nI
            lFisOk := .T.
        Recover
            lFisOk := .F.
        End Sequence
        ErrorBlock(bOldFisErr)

        DbSelectArea("SB1")
        SB1->(DbSetOrder(1))
        DbSelectArea("SF4")
        SF4->(DbSetOrder(1))
        DbSelectArea("SCK")
        SCK->(DbSetOrder(1))

        For nI := 1 To Len(aSavedItems)
            cCodProd := PadR(AllTrim(aSavedItems[nI]["productCode"]), TamSX3("B1_COD")[1])
            cItemTes := PadR(AllTrim(aSavedItems[nI]["outflowType"]), TamSX3("F4_CODIGO")[1])
            cItemNum := PadR(AllTrim(aSavedItems[nI]["item"]), TamSX3("CK_ITEM")[1])
            nQtd     := IIf(aSavedItems[nI]["quantity"] > 0, aSavedItems[nI]["quantity"], 1)

            cNcm := ""
            cCst := ""
            If SB1->(DbSeek(xFilial("SB1") + cCodProd))
                cNcm := AllTrim(SB1->B1_POSIPI)
                cCst := AllTrim(SB1->B1_ORIGEM)
            EndIf
            If SF4->(DbSeek(xFilial("SF4") + cItemTes))
                cCst += AllTrim(SF4->F4_SITTRIB)
            EndIf
            If !Empty(cOrcame) .And. SCK->(DbSeek(cFil + PadR(AllTrim(cOrcame), TamSX3("CK_NUM")[1]) + cItemNum + cCodProd))
                If !Empty(SCK->CK_CLASFIS)
                    cCst := AllTrim(SCK->CK_CLASFIS)
                EndIf
            EndIf

            nAliqIcm := 0
            nValIcm  := 0
            nValSt   := 0
            nUniSt   := 0
            If lFisOk .And. MaFisFound("IT", nI)
                If Empty(cCst)
                    cCst := AllTrim(cValToChar(MaFisRet(nI, "IT_CLASFIS")))
                EndIf
                nAliqIcm := MaFisRet(nI, "IT_ALIQICM")
                nValIcm  := MaFisRet(nI, "IT_VALICM")
                nValSt   := MaFisRet(nI, "IT_VALSOL")
                nUniSt   := Round(nValSt / nQtd, 2)
            EndIf

            aSavedItems[nI]["ncm"]          := cNcm
            aSavedItems[nI]["cst"]          := cCst
            aSavedItems[nI]["icmsRate"]     := nAliqIcm
            aSavedItems[nI]["icmsValue"]    := nValIcm
            aSavedItems[nI]["stUnitValue"]  := nUniSt
            aSavedItems[nI]["stTotalValue"] := nValSt
        Next nI

        If MaFisFound()
            MaFisEnd()
        EndIf

        oResponse["success"]          := .T.
        oResponse["message"]          := "Proposta Comercial criada com sucesso"
        oResponse["proposalId"]       := AllTrim(cPropos)
        oResponse["proposalRevision"] := AllTrim(cPrevis)
        oResponse["opportunityId"]    := AllTrim(cOppNum)
        oResponse["budgetId"]         := AllTrim(cOrcame)
        oResponse["validityDate"]     := cValida
        oResponse["customerCode"]     := AllTrim(cCodCli)
        oResponse["storeId"]          := AllTrim(cLojCli)
        oResponse["salesmanCode"]     := AllTrim(cVend)
        oResponse["priceTable"]       := AllTrim(cTabela)
        oResponse["conditionPayment"] := AllTrim(cCondPg)
        oResponse["items"]            := aSavedItems
    Else
        aErro := oModel:GetErrorMessage()
        oModel:DeActivate()
        oModel:Destroy()

        oResponse["success"]  := .F.
        oResponse["message"]  := "Erro na validacao/gravacao da Proposta Comercial (FATA600)"
        oResponse["details"]  := "Form: " + AllToChar(aErro[1]) + " | Campo: " + AllToChar(aErro[2]) + " | Erro: " + AllToChar(aErro[5]) + " | Msg: " + AllToChar(aErro[6]) + " | Solucao: " + AllToChar(aErro[7])
        oResponse["envDebug"] := fEnvDebug()
    EndIf
Return Nil

//=============================================================================
// DEBUG: Estado do ambiente e gatilhos SX7 quando ha erro na gravacao
//=============================================================================
Static Function fEnvDebug()
    Local oEnv := JsonObject():New()

    oEnv["funName"]     := FunName()
    oEnv["isBlind"]     := IsBlind()
    oEnv["nModulo"]     := IIf(Type("nModulo") == "N", nModulo, -1)
    oEnv["cModulo"]     := IIf(Type("cModulo") == "C", cModulo, "")
    oEnv["typeAHeader"] := Type("aHeader")
    oEnv["typeACols"]   := Type("aCols")
    oEnv["typeARotina"] := Type("aRotina")
    oEnv["typeInclui"]  := Type("INCLUI")
    oEnv["typeAltera"]  := Type("ALTERA")
    oEnv["ad1Eof"]      := IIf(Select("AD1") > 0, AD1->(Eof()), .T.)
    oEnv["ad1Opor"]     := IIf(Select("AD1") > 0 .And. !AD1->(Eof()), AllTrim(AD1->AD1_NROPOR), "")
    oEnv["sa1Cod"]      := IIf(Select("SA1") > 0 .And. !SA1->(Eof()), AllTrim(SA1->A1_COD) + "/" + AllTrim(SA1->A1_LOJA), "")
    oEnv["sa1CodMun"]   := IIf(Select("SA1") > 0 .And. !SA1->(Eof()), AllTrim(SA1->A1_COD_MUN), "")
    oEnv["sa1Naturez"]  := IIf(Select("SA1") > 0 .And. !SA1->(Eof()), AllTrim(SA1->A1_NATUREZ), "")
    oEnv["sx7RecCount"] := IIf(Select("SX7") > 0, SX7->(RecCount()), -1)
Return oEnv

Static Function fSx7Debug()
    Local aRes    := {}
    Local aAlvos  := {"CLI_CODMUN", "CJ_CLIENTE", "CJ_LOJA", "CJ_CLIENT", "CJ_LOJAENT", "CJ_TABELA", "CK_PRODUTO", "CK_QTDVEN", "CK_OPER", "CK_TES", "ADY_CLIENT", "ADY_LOJENT", "ADY_CODIGO"}
    Local aArea   := GetArea()
    Local bOldErr := ErrorBlock({|e| Break(e)})
    Local cCampo  := ""
    Local cCDomin := ""
    Local cRegra  := ""
    Local cCondic := ""
    Local cPropri := ""
    Local cUpper  := ""
    Local nCount  := 0
    Local oItem   := Nil

    Begin Sequence
        If Select("SX7") == 0
            DbSelectArea("SX7")
        EndIf
        If Select("SX7") > 0
            SX7->(DbGoTop())
            While !SX7->(Eof()) .And. nCount < 80
                cCampo  := Upper(AllTrim(SX7->X7_CAMPO))
                cCDomin := Upper(AllTrim(SX7->X7_CDOMIN))
                cRegra  := AllTrim(SX7->X7_REGRA)
                cCondic := AllTrim(SX7->X7_CONDIC)
                cPropri := Upper(AllTrim(SX7->X7_PROPRI))
                cUpper  := Upper(cCampo + "|" + cCDomin + "|" + cRegra + "|" + cCondic)

                If aScan(aAlvos, {|x| x == cCampo}) > 0 .Or. "CODMUN" $ cUpper .Or. "CLI_" $ cUpper .Or. cPropri == "U"
                    oItem := JsonObject():New()
                    oItem["campo"]  := cCampo
                    oItem["seq"]    := AllTrim(SX7->X7_SEQUENC)
                    oItem["cdomin"] := cCDomin
                    oItem["tipo"]   := AllTrim(SX7->X7_TIPO)
                    oItem["regra"]  := cRegra
                    oItem["condic"] := cCondic
                    oItem["propri"] := cPropri
                    aAdd(aRes, oItem)
                    nCount++
                EndIf
                SX7->(DbSkip())
            EndDo
        EndIf
    Recover
        oItem := JsonObject():New()
        oItem["error"] := "Falha ao ler SX7 via AdvPL"
        aAdd(aRes, oItem)
    End Sequence

    ErrorBlock(bOldErr)
    RestArea(aArea)
Return aRes
