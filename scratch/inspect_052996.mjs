import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');

async function queryTable(table, fields, where) {
  return new Promise((resolve) => {
    const url = `/rest/api/framework/v1/genericQuery?tables=${table}&fields=${fields}&where=${encodeURIComponent(where)}`;
    const req = https.request({
      hostname: '192.168.0.80',
      port: 8887,
      path: url,
      method: 'GET',
      headers: {
        'Authorization': auth,
        'TenantId': '01,0101',
        'Accept': 'application/json'
      },
      agent
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b) });
        } catch {
          resolve({ status: res.statusCode, raw: b });
        }
      });
    });
    req.on('error', err => resolve({ status: 'ERR', err: err.message }));
    req.end();
  });
}

async function run() {
  console.log("=== 1. Buscar campos da oportunidade 052996 na AD1 ===");
  // Vamos buscar os campos da AD1 que não dão erro
  const sx3Fields = [
    'AD1_FILIAL','AD1_NROPOR','AD1_REVISA','AD1_DESCRI','AD1_CODCLI','AD1_LOJCLI','AD1_VEND',
    'AD1_PROVEN','AD1_STAGE','AD1_MOEDA','AD1_STATUS','AD1_IDESTN','AD1_CANAL','AD1_FEELIN',
    'AD1_DATA','AD1_HORA','AD1_USER','AD1_DTINI','AD1_PRIOR','AD1_PERCEN','AD1_RCINIC',
    'AD1_VERBA','AD1_RCFECH','AD1_RCREAL','AD1_CUSTO','AD1_NVESTN','AD1_MODO','AD1_SETOR',
    'AD1_MSBLQL'
  ].join(',');

  const rAd1 = await queryTable('AD1', sx3Fields, "AD1_NROPOR = '052996'");
  console.log("AD1 Status:", rAd1.status);
  if (rAd1.data && rAd1.data.items) {
    console.log("AD1 Data:", JSON.stringify(rAd1.data.items[0], null, 2));
  } else {
    console.log("AD1 Raw:", rAd1);
  }

  console.log("\n=== 2. Buscar registros na AD2 (Equipe de Vendas) ===");
  const ad2Fields = 'AD2_FILIAL,AD2_NROPOR,AD2_REVISA,AD2_VEND,AD2_PERC,AD2_PAPEL,AD2_CODPAP,AD2_IDESTN,AD2_NVESTN';
  const rAd2 = await queryTable('AD2', ad2Fields, "AD2_NROPOR = '052996'");
  console.log("AD2 Status:", rAd2.status);
  if (rAd2.data && rAd2.data.items) {
    console.log("AD2 Items:", JSON.stringify(rAd2.data.items, null, 2));
  } else {
    console.log("AD2 Raw:", rAd2);
  }

  console.log("\n=== 3. Testar GET /crmmopportunities para ver 052996 ===");
  const rCrmm = await new Promise(resolve => {
    const req = https.request({
      hostname: '192.168.0.80', port: 8887, path: '/rest/crmmopportunities', method: 'GET',
      headers: { 'Authorization': auth, 'TenantId': '01,0101', 'Accept': 'application/json' },
      agent
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          const found = j.OPPORTUNITIES.find(o => o.OPP_NUMBER === '052996');
          resolve({ status: res.statusCode, found });
        } catch {
          resolve({ status: res.statusCode, raw: b });
        }
      });
    });
    req.end();
  });
  console.log("crmmopportunities:", JSON.stringify(rCrmm, null, 2));
}

run();

