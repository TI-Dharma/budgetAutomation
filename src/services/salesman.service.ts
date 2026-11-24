import fs from 'fs';
import path from 'path';
import { env } from '../config/env';

export interface SalesmanEntry {
  code: string;
  name: string;
  shortName?: string;
  bitrixName?: string;
  email?: string;
}

export interface SalesmanResolution {
  code: string;
  name: string;
  shortName: string;
  bitrixName: string;
  email: string;
  matchedBy: string;
}

const normalize = (v: any): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export class SalesmanService {
  private getFilePath(): string {
    const srcPath = path.resolve(process.cwd(), 'src', 'config', 'vendedores.json');
    if (fs.existsSync(srcPath)) return srcPath;
    return path.resolve(__dirname, '..', 'config', 'vendedores.json');
  }

  /**
   * Lê o arquivo src/config/vendedores.json em tempo real (permite editar o JSON sem precisar recompilar)
   */
  public listSalesmen(): SalesmanEntry[] {
    try {
      const filePath = this.getFilePath();
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err: any) {
      console.warn(`[SalesmanService] Aviso ao ler vendedores.json: ${err.message}`);
      return [];
    }
  }

  /**
   * Resolve o vendedor a partir do nome ou código enviado no payload, do campo Responsável TOTVS no orçamento,
   * ou do usuário responsável pelo card/orçamento no Bitrix24.
   */
  public resolve(params: {
    payloadInput?: string;
    quoteFieldInput?: string;
    assignedUserName?: string;
    assignedUserEmail?: string;
    fallbackCode?: string;
  }): SalesmanResolution {
    const list = this.listSalesmen();
    const defaultCode = params.fallbackCode || env.PROTHEUS_DEFAULT_SALESMAN || '000001';
    const defaultEntry = list.find((s) => s.code === defaultCode) || {
      code: defaultCode,
      name: 'VENDEDOR PADRAO',
      shortName: 'VENDEDOR PADRAO',
      bitrixName: 'VENDEDOR PADRAO',
      email: '',
    };

    const candidates: Array<{ value: string; source: string }> = [
      { value: String(params.payloadInput ?? '').trim(), source: 'payload' },
      { value: String(params.quoteFieldInput ?? '').trim(), source: 'quote.ResponsavelTOTVS' },
      { value: String(params.assignedUserName ?? '').trim(), source: 'bitrix.assignedUserName' },
    ].filter((c) => c.value.length > 0);

    for (const candidate of candidates) {
      const raw = candidate.value;
      const norm = normalize(raw);
      if (!norm) continue;

      // 1. Busca por código exato (ex: "000006" ou "6")
      if (/^\d{1,6}$/.test(raw)) {
        const padded = raw.padStart(6, '0');
        const byCode = list.find((s) => s.code === padded || s.code === raw);
        if (byCode) {
          return this.toResolution(byCode, `${candidate.source}:code(${raw})`);
        }
      }

      // 2. Busca por nome exato (bitrixName, name ou shortName)
      const byExactName = list.find(
        (s) =>
          normalize(s.bitrixName) === norm ||
          normalize(s.name) === norm ||
          (s.shortName && normalize(s.shortName) === norm)
      );
      if (byExactName) {
        return this.toResolution(byExactName, `${candidate.source}:exactName(${raw})`);
      }

      // 3. Busca parcial (contém o nome completo ou o nome enviado contém o bitrixName/name)
      const byContains = list.find((s) => {
        const nBitrix = normalize(s.bitrixName);
        const nName = normalize(s.name);
        const nShort = normalize(s.shortName);
        return (
          (nBitrix && (nBitrix.includes(norm) || norm.includes(nBitrix))) ||
          (nName && (nName.includes(norm) || norm.includes(nName))) ||
          (nShort && nShort.length >= 3 && nShort === norm.split(' ')[0])
        );
      });
      if (byContains) {
        return this.toResolution(byContains, `${candidate.source}:partialName(${raw})`);
      }
    }

    // 4. Busca por e-mail do responsável no Bitrix
    const email = String(params.assignedUserEmail ?? '').trim().toLowerCase();
    if (email) {
      const byEmail = list.find((s) => String(s.email ?? '').trim().toLowerCase() === email);
      if (byEmail) {
        return this.toResolution(byEmail, `bitrix.assignedUserEmail(${email})`);
      }
    }

    return this.toResolution(defaultEntry, 'defaultFallback');
  }

  private toResolution(entry: SalesmanEntry, matchedBy: string): SalesmanResolution {
    return {
      code: entry.code,
      name: entry.name,
      shortName: entry.shortName || entry.name,
      bitrixName: entry.bitrixName || entry.name,
      email: entry.email || '',
      matchedBy,
    };
  }
}

export const salesmanService = new SalesmanService();
