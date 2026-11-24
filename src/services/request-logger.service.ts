import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { NextFunction, Request, Response } from 'express';

export interface RequestLogStep {
  time: string; // hh-mm-ss
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export interface RequestLogEntry {
  id: string;
  status: 'OK' | 'ERRO';
  httpStatus: number;
  dateTime: string;      // hh-mm-ss-dd-mm-aaaa (ex: "16-25-30-19-11-2026")
  dateTimeShort: string; // hh-mm-ss-dd-mm-aa   (ex: "16-25-30-19-11-26")
  time: string;          // hh-mm-ss            (ex: "16-25-30")
  hourMinute: string;    // hh-mm               (ex: "16-25")
  date: string;          // dd-mm-aaaa          (ex: "19-11-2026")
  dateShort: string;     // dd-mm-aa            (ex: "19-11-26")
  isoTimestamp: string;
  durationMs: number;
  method: string;
  path: string;
  summary: string;
  context: {
    quoteId?: number | null;
    dealId?: number | null;
    opportunityId?: string | null;
    proposalId?: string | null;
    cnpj?: string | null;
  };
  request: {
    query: Record<string, any>;
    body: any;
    ip?: string;
    userAgent?: string;
  };
  steps: RequestLogStep[];
  response: any;
}

export interface LogSearchFilter {
  status?: string;   // "ok" | "erro"
  q?: string;        // busca geral (hh-mm-ss-dd-mm-aaaa, hh-mm-ss, hh-mm, dd-mm-aa, dd-mm-aaaa)
  dateTime?: string; // hh-mm-ss-dd-mm-aaaa
  date?: string;     // dd-mm-aa ou dd-mm-aaaa
  time?: string;     // hh-mm-ss ou hh-mm
  quoteId?: string;
  opportunityId?: string;
  route?: string;
  limit?: number;
  tokens?: string[]; // tokens vindos de path params (/log/:p1/:p2/:p3)
}

interface ActiveRequestContext {
  steps: RequestLogStep[];
}

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_FILE_PATH = path.join(LOG_DIR, 'requests-log.json');
const MAX_LOG_ENTRIES = 1000;

const requestAsyncStorage = new AsyncLocalStorage<ActiveRequestContext>();
let consoleHookInitialized = false;

export function formatBrazilDateParts(dateObj: Date = new Date()): {
  dateTime: string;
  dateTimeShort: string;
  time: string;
  hourMinute: string;
  date: string;
  dateShort: string;
  isoTimestamp: string;
} {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(dateObj);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  const dd = (map.day || '01').padStart(2, '0');
  const mm = (map.month || '01').padStart(2, '0');
  const yyyy = map.year || '2026';
  const yy = yyyy.slice(-2);
  const hh = (map.hour === '24' ? '00' : map.hour || '00').padStart(2, '0');
  const min = (map.minute || '00').padStart(2, '0');
  const ss = (map.second || '00').padStart(2, '0');

  const time = `${hh}-${min}-${ss}`;
  const hourMinute = `${hh}-${min}`;
  const date = `${dd}-${mm}-${yyyy}`;
  const dateShort = `${dd}-${mm}-${yy}`;

  return {
    dateTime: `${time}-${date}`,           // hh-mm-ss-dd-mm-aaaa
    dateTimeShort: `${time}-${dateShort}`, // hh-mm-ss-dd-mm-aa
    time,                                  // hh-mm-ss
    hourMinute,                            // hh-mm
    date,                                  // dd-mm-aaaa
    dateShort,                             // dd-mm-aa
    isoTimestamp: dateObj.toISOString(),
  };
}

function stringifyConsoleArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.message}${arg.stack ? ` | ${arg.stack}` : ''}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/**
 * Intercepta console.log, console.warn e console.error para gravar o passo a passo
 * completo de cada requisição dentro do array `steps` do JSON de log.
 */
export function initConsoleCapture(): void {
  if (consoleHookInitialized) return;
  consoleHookInitialized = true;

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  const pushStep = (level: 'INFO' | 'WARN' | 'ERROR', args: any[]) => {
    const store = requestAsyncStorage.getStore();
    if (!store) return;
    const msg = stringifyConsoleArgs(args).trim();
    // Ignora linhas puramente decorativas "===="
    if (!msg || /^=+$/.test(msg)) return;
    store.steps.push({
      time: formatBrazilDateParts(new Date()).time,
      level,
      message: msg,
    });
  };

  console.log = (...args: any[]) => {
    pushStep('INFO', args);
    origLog(...args);
  };

  console.warn = (...args: any[]) => {
    pushStep('WARN', args);
    origWarn(...args);
  };

  console.error = (...args: any[]) => {
    pushStep('ERROR', args);
    origError(...args);
  };
}

function ensureLogFileExists(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_FILE_PATH)) {
    fs.writeFileSync(LOG_FILE_PATH, '[]', 'utf-8');
  }
}

export function readAllLogs(): RequestLogEntry[] {
  try {
    ensureLogFileExists();
    const raw = fs.readFileSync(LOG_FILE_PATH, 'utf-8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLogEntry(entry: RequestLogEntry): void {
  try {
    ensureLogFileExists();
    const currentLogs = readAllLogs();
    // Insere o mais recente no topo do array
    currentLogs.unshift(entry);
    if (currentLogs.length > MAX_LOG_ENTRIES) {
      currentLogs.length = MAX_LOG_ENTRIES;
    }
    fs.writeFileSync(LOG_FILE_PATH, JSON.stringify(currentLogs, null, 2), 'utf-8');
  } catch (err) {
    // Evita quebrar a requisição caso haja falha de I/O no disco
  }
}

export function clearAllLogs(): void {
  ensureLogFileExists();
  fs.writeFileSync(LOG_FILE_PATH, '[]', 'utf-8');
}

export function getLogFilePath(): string {
  ensureLogFileExists();
  return LOG_FILE_PATH;
}

function normalizeToken(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[:/\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function parseStatusToken(raw?: string): 'OK' | 'ERRO' | undefined {
  if (!raw) return undefined;
  const v = normalizeToken(raw);
  if (['ok', 'sucesso', 'success', '200', '201', 'true'].includes(v)) return 'OK';
  if (['erro', 'error', 'err', 'falha', 'fail', 'false'].includes(v)) return 'ERRO';
  return undefined;
}

function matchesDateOrTimeToken(entry: RequestLogEntry, rawToken: string): boolean {
  const token = normalizeToken(rawToken);
  if (!token) return true;

  // Caso seja token de status ("ok" ou "erro")
  const asStatus = parseStatusToken(token);
  if (asStatus) {
    return entry.status === asStatus;
  }

  const candidates = [
    entry.dateTime.toLowerCase(),                          // hh-mm-ss-dd-mm-aaaa
    entry.dateTimeShort.toLowerCase(),                     // hh-mm-ss-dd-mm-aa
    `${entry.hourMinute}-${entry.date}`.toLowerCase(),     // hh-mm-dd-mm-aaaa
    `${entry.hourMinute}-${entry.dateShort}`.toLowerCase(),// hh-mm-dd-mm-aa
    entry.time.toLowerCase(),                              // hh-mm-ss
    entry.hourMinute.toLowerCase(),                        // hh-mm
    entry.date.toLowerCase(),                              // dd-mm-aaaa
    entry.dateShort.toLowerCase(),                         // dd-mm-aa
  ];

  // Match exato em qualquer um dos formatos suportados
  if (candidates.includes(token)) {
    return true;
  }

  // Match parcial (ex: prefixo de hora "16-25" em "16-25-30", ou substring em dateTime)
  if (
    entry.dateTime.toLowerCase().includes(token) ||
    entry.dateTimeShort.toLowerCase().includes(token) ||
    entry.time.toLowerCase().startsWith(token) ||
    entry.date.toLowerCase().startsWith(token) ||
    entry.dateShort.toLowerCase().startsWith(token)
  ) {
    return true;
  }

  return false;
}

export function queryLogs(filter: LogSearchFilter): {
  totalStored: number;
  totalMatched: number;
  summary: { ok: number; erro: number };
  appliedFilters: Record<string, any>;
  logs: RequestLogEntry[];
} {
  const allLogs = readAllLogs();

  const statusFilter = parseStatusToken(filter.status);
  const dateTimeToken = filter.dateTime ? normalizeToken(filter.dateTime) : undefined;
  const dateToken = filter.date ? normalizeToken(filter.date) : undefined;
  const timeToken = filter.time ? normalizeToken(filter.time) : undefined;
  const qToken = filter.q ? normalizeToken(filter.q) : undefined;
  const extraTokens = (filter.tokens ?? [])
    .map((t) => normalizeToken(t))
    .filter(Boolean);

  const matched = allLogs.filter((entry) => {
    // 1. Filtro por status (OK | ERRO)
    if (statusFilter && entry.status !== statusFilter) {
      return false;
    }

    // 2. Filtro por data/hora completa (hh-mm-ss-dd-mm-aaaa ou hh-mm-ss-dd-mm-aa)
    if (dateTimeToken && !matchesDateOrTimeToken(entry, dateTimeToken)) {
      return false;
    }

    // 3. Filtro específico de data (dd-mm-aa ou dd-mm-aaaa)
    if (dateToken) {
      const dFull = entry.date.toLowerCase();
      const dShort = entry.dateShort.toLowerCase();
      if (
        dFull !== dateToken &&
        dShort !== dateToken &&
        !dFull.includes(dateToken) &&
        !dShort.includes(dateToken) &&
        !matchesDateOrTimeToken(entry, dateToken)
      ) {
        return false;
      }
    }

    // 4. Filtro específico de hora (hh-mm-ss ou hh-mm)
    if (timeToken) {
      const tFull = entry.time.toLowerCase();
      const tShort = entry.hourMinute.toLowerCase();
      if (
        tFull !== timeToken &&
        tShort !== timeToken &&
        !tFull.startsWith(timeToken) &&
        !matchesDateOrTimeToken(entry, timeToken)
      ) {
        return false;
      }
    }

    // 5. Filtro geral q / busca
    if (qToken && !matchesDateOrTimeToken(entry, qToken)) {
      return false;
    }

    // 6. Tokens passados via URL (/log/:p1/:p2/:p3)
    for (const tk of extraTokens) {
      if (!matchesDateOrTimeToken(entry, tk)) {
        return false;
      }
    }

    // 7. Filtro opcional por quoteId
    if (filter.quoteId) {
      const qId = Number(String(filter.quoteId).replace(/\D/g, ''));
      if (entry.context?.quoteId !== qId) {
        return false;
      }
    }

    // 8. Filtro opcional por opportunityId
    if (filter.opportunityId) {
      const opp = String(filter.opportunityId).trim();
      if (entry.context?.opportunityId !== opp) {
        return false;
      }
    }

    // 9. Filtro opcional por rota
    if (filter.route) {
      const r = String(filter.route).toLowerCase();
      if (!entry.path.toLowerCase().includes(r)) {
        return false;
      }
    }

    return true;
  });

  const okCount = matched.filter((e) => e.status === 'OK').length;
  const erroCount = matched.filter((e) => e.status === 'ERRO').length;

  const limit =
    filter.limit && Number.isFinite(filter.limit) && filter.limit > 0
      ? Math.min(Number(filter.limit), MAX_LOG_ENTRIES)
      : undefined;

  return {
    totalStored: allLogs.length,
    totalMatched: matched.length,
    summary: {
      ok: okCount,
      erro: erroCount,
    },
    appliedFilters: {
      status: statusFilter ?? null,
      dateTime: dateTimeToken ?? null,
      date: dateToken ?? null,
      time: timeToken ?? null,
      q: qToken ?? null,
      urlTokens: extraTokens.length > 0 ? extraTokens : null,
      quoteId: filter.quoteId ?? null,
      opportunityId: filter.opportunityId ?? null,
      route: filter.route ?? null,
    },
    logs: limit ? matched.slice(0, limit) : matched,
  };
}

function extractContextFromRequestAndResponse(reqBody: any, resBody: any): RequestLogEntry['context'] {
  const src = reqBody?.['Bundle 1'] ?? reqBody?.bundle ?? reqBody ?? {};
  const data = resBody?.data ?? {};

  const rawQuoteId =
    data?.bitrix?.quoteId ??
    resBody?.trigger?.quoteId ??
    src?.quoteId ??
    src?.id;
  const quoteIdNum = rawQuoteId ? Number(String(rawQuoteId).replace(/\D/g, '')) || null : null;

  const rawDealId =
    data?.bitrix?.dealId ??
    resBody?.trigger?.dealId ??
    src?.dealId;
  const dealIdNum = rawDealId ? Number(String(rawDealId).replace(/\D/g, '')) || null : null;

  const opportunityId =
    data?.opportunityId ??
    src?.opportunityId ??
    null;

  const proposalId = data?.proposalId ?? null;

  const cnpj =
    data?.fiscal?.cnpj ??
    data?.customer?.cnpj ??
    src?.cnpj ??
    null;

  return {
    quoteId: quoteIdNum,
    dealId: dealIdNum,
    opportunityId: opportunityId ? String(opportunityId) : null,
    proposalId: proposalId ? String(proposalId) : null,
    cnpj: cnpj ? String(cnpj) : null,
  };
}

/**
 * Middleware Express que captura a requisição, todos os console.log/warn/error gerados durante
 * a execução e a resposta final, salvando tudo em `logs/requests-log.json`.
 */
export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Não grava no arquivo de log as próprias consultas na rota /log para não poluir
  if (req.path.startsWith('/log') || req.path === '/favicon.ico') {
    next();
    return;
  }

  initConsoleCapture();

  const startDate = new Date();
  const startMs = Date.now();
  const dateParts = formatBrazilDateParts(startDate);
  const store: ActiveRequestContext = { steps: [] };

  let capturedResponseBody: any = undefined;

  const origJson = res.json.bind(res);
  const origSend = res.send.bind(res);

  res.json = ((body: any) => {
    capturedResponseBody = body;
    return origJson(body);
  }) as any;

  res.send = ((body: any) => {
    if (capturedResponseBody === undefined) {
      if (typeof body === 'string') {
        try {
          capturedResponseBody = JSON.parse(body);
        } catch {
          capturedResponseBody = body;
        }
      } else {
        capturedResponseBody = body;
      }
    }
    return origSend(body);
  }) as any;

  res.on('finish', () => {
    const durationMs = Date.now() - startMs;
    const isError =
      res.statusCode >= 400 ||
      (capturedResponseBody &&
        typeof capturedResponseBody === 'object' &&
        capturedResponseBody.success === false);

    const status: 'OK' | 'ERRO' = isError ? 'ERRO' : 'OK';

    const summary =
      (capturedResponseBody &&
        typeof capturedResponseBody === 'object' &&
        (capturedResponseBody.message ||
          capturedResponseBody.error?.friendlyMessage ||
          capturedResponseBody.status)) ||
      `${req.method} ${req.path} -> HTTP ${res.statusCode}`;

    const entry: RequestLogEntry = {
      id: `req_${startMs}_${Math.random().toString(36).slice(2, 7)}`,
      status,
      httpStatus: res.statusCode,
      dateTime: dateParts.dateTime,           // hh-mm-ss-dd-mm-aaaa
      dateTimeShort: dateParts.dateTimeShort, // hh-mm-ss-dd-mm-aa
      time: dateParts.time,                   // hh-mm-ss
      hourMinute: dateParts.hourMinute,       // hh-mm
      date: dateParts.date,                   // dd-mm-aaaa
      dateShort: dateParts.dateShort,         // dd-mm-aa
      isoTimestamp: dateParts.isoTimestamp,
      durationMs,
      method: req.method,
      path: req.originalUrl || req.path,
      summary: String(summary),
      context: extractContextFromRequestAndResponse(req.body, capturedResponseBody),
      request: {
        query: req.query as Record<string, any>,
        body: req.body ?? null,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
      steps: store.steps,
      response: capturedResponseBody ?? null,
    };

    saveLogEntry(entry);
  });

  requestAsyncStorage.run(store, () => {
    next();
  });
}
