import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');

function request(method, path, body = null) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve) => {
    const headers = {
      'Authorization': auth,
      'TenantId': '01,0101',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request({
      hostname: '192.168.0.80',
      port: 8887,
      path: '/rest' + path,
      method,
      headers,
      agent
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', err => resolve({ status: 'ERR', body: err.message }));
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const todayIso = new Date().toISOString().slice(0, 10); // '2026-11-05'
  const todayYmd = todayIso.replace(/-/g, ''); // '20261105'

  const tests = [
    {
      name: "Com startDate ISO YYYY-MM-DD",
      body: {
        branchId: "0101",
        customerCode: "003608",
        storeId: "0001",
        description: "PROPOSTA - CLIENTE TESTE",
        salesmanCode: "000001",
        process: "000001",
        stage: "000001",
        startDate: todayIso,
        currency: 1,
        priority: "1",
        status: "1"
      }
    },
    {
      name: "Com startDate YYYYMMDD",
      body: {
        branchId: "0101",
        customerCode: "003608",
        storeId: "0001",
        description: "PROPOSTA - CLIENTE TESTE",
        salesmanCode: "000001",
        process: "000001",
        stage: "000001",
        startDate: todayYmd,
        currency: 1,
        priority: "1",
        status: "1"
      }
    },
    {
      name: "Com initialDate e expectedCloseDate",
      body: {
        branchId: "0101",
        customerCode: "003608",
        storeId: "0001",
        description: "PROPOSTA - CLIENTE TESTE",
        salesmanCode: "000001",
        process: "000001",
        stage: "000001",
        initialDate: todayIso,
        expectedCloseDate: todayIso,
        startDate: todayIso,
        currency: 1,
        priority: "1",
        status: "1"
      }
    },
    {
      name: "Com campos Protheus AD1_* explícitos no JSON",
      body: {
        branchId: "0101",
        customerCode: "003608",
        storeId: "0001",
        description: "PROPOSTA - CLIENTE TESTE",
        salesmanCode: "000001",
        process: "000001",
        stage: "000001",
        currency: 1,
        priority: "1",
        status: "1",
        AD1_FILIAL: "0101",
        AD1_CODCLI: "003608",
        AD1_LOJCLI: "0001",
        AD1_DESCRI: "PROPOSTA - CLIENTE TESTE",
        AD1_VEND: "000001",
        AD1_PROVEN: "000001",
        AD1_STAGE: "000001",
        AD1_DTINI: todayIso,
        AD1_DATA: todayIso,
        AD1_HORA: "17:50",
        AD1_MOEDA: 1,
        AD1_PRIOR: "1",
        AD1_STATUS: "1",
        AD1_IDESTN: "01",
        AD1_USER: "000000"
      }
    }
  ];

  for (const t of tests) {
    const res = await request('POST', '/api/crm/v1/opportunity', t.body);
    console.log(`[${t.name}] Status ${res.status} => ${res.body}`);
  }
}

run();

