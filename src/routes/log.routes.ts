import { Router, Request, Response } from 'express';
import {
  clearAllLogs,
  getLogFilePath,
  queryLogs,
} from '../services/request-logger.service';

const logRoutes = Router();

function handleGetLogs(req: Request, res: Response): void {
  const tokens: string[] = [];
  if (req.params.p1) tokens.push(String(req.params.p1));
  if (req.params.p2) tokens.push(String(req.params.p2));
  if (req.params.p3) tokens.push(String(req.params.p3));

  const statusQuery =
    (req.query.status as string) ??
    (req.query.tipo as string) ??
    (req.query.erro !== undefined ? 'erro' : undefined) ??
    (req.query.ok !== undefined ? 'ok' : undefined);

  const dateTimeQuery =
    (req.query.datetime as string) ??
    (req.query.dateTime as string) ??
    (req.query.datahora as string) ??
    (req.query.dataHora as string);

  const dateQuery =
    (req.query.date as string) ??
    (req.query.data as string) ??
    (req.query.dia as string);

  const timeQuery =
    (req.query.time as string) ??
    (req.query.hora as string) ??
    (req.query.horario as string);

  const qQuery =
    (req.query.q as string) ??
    (req.query.search as string) ??
    (req.query.busca as string) ??
    (req.query.filtro as string);

  const quoteId =
    (req.query.quoteId as string) ??
    (req.query.orcamento as string);

  const opportunityId =
    (req.query.opportunityId as string) ??
    (req.query.oportunidade as string);

  const route =
    (req.query.route as string) ??
    (req.query.rota as string);

  const rawLimit = req.query.limit ?? req.query.limite;
  const limit = rawLimit ? Number(rawLimit) : undefined;

  const result = queryLogs({
    status: statusQuery,
    dateTime: dateTimeQuery,
    date: dateQuery,
    time: timeQuery,
    q: qQuery,
    quoteId,
    opportunityId,
    route,
    limit,
    tokens,
  });

  res.status(200).json({
    success: true,
    logFile: getLogFilePath(),
    totalStored: result.totalStored,
    totalMatched: result.totalMatched,
    summary: result.summary,
    appliedFilters: result.appliedFilters,
    usageExamples: {
      todos: '/log',
      apenasErros: '/log?status=erro  ou  /log/erro',
      apenasOk: '/log?status=ok    ou  /log/ok',
      dataHoraCompleta: '/log/16-25-30-19-11-2026  ou  /log?data=16-25-30-19-11-2026',
      apenasHoraCompleta: '/log/16-25-30  ou  /log?hora=16-25-30',
      apenasHoraMinuto: '/log/16-25  ou  /log?hora=16-25',
      apenasDataCurta: '/log/19-11-26  ou  /log?data=19-11-26',
      apenasDataCompleta: '/log/19-11-2026  ou  /log?data=19-11-2026',
      combinado: '/log/erro/19-11-26  ou  /log?data=19-11-26&hora=16-25&status=erro',
    },
    logs: result.logs,
  });
}

// Rotas /log e /logs (com suporte a filtros tanto por Query Params quanto direto na URL)
logRoutes.get('/log', handleGetLogs);
logRoutes.get('/log/:p1', handleGetLogs);
logRoutes.get('/log/:p1/:p2', handleGetLogs);
logRoutes.get('/log/:p1/:p2/:p3', handleGetLogs);

logRoutes.get('/logs', handleGetLogs);
logRoutes.get('/logs/:p1', handleGetLogs);
logRoutes.get('/logs/:p1/:p2', handleGetLogs);
logRoutes.get('/logs/:p1/:p2/:p3', handleGetLogs);

// DELETE /log — Limpa o arquivo JSON de logs se desejar zerar o histórico
logRoutes.delete('/log', (_req: Request, res: Response) => {
  clearAllLogs();
  res.status(200).json({
    success: true,
    message: 'Histórico de logs (logs/requests-log.json) limpo com sucesso.',
  });
});

export { logRoutes };
