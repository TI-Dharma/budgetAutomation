import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');

function request(method, path, body = null, tenant = '01,0101', timeoutMs = 15000) {
  return new Promise((resolve) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const headers = {
      'Authorization': auth,
      'TenantId': tenant,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const start = Date.now();
    const req = https.request({
      hostname: '192.168.0.80',
      port: 8887,
      path: '/rest' + path,
      method,
      headers,
      agent
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, ms: Date.now() - start, body: resBody });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 'ERR', ms: Date.now() - start, body: err.message });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ status: 'TIMEOUT', ms: Date.now() - start, body: 'Timed out after ' + timeoutMs + 'ms' });
    });

    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log("=== 1. Testar POST /api/crm/v1/opportunity com dados do usuário ===");
  const p1 = {
    companyId: "01",
    branchId: "0101",
    customerCode: "003608",
    storeId: "0001",
    description: "PROPOSTA - CLIENTE TESTE",
    salesmanCode: "000001",
    process: "000001",
    stage: "000001",
    currency: 1
  };
  const r1 = await request('POST', '/api/crm/v1/opportunity', p1);
  console.log("POST /api/crm/v1/opportunity:", r1.status, r1.body);

  console.log("\n=== 2. Testar PUT /crmmopportunities com OPPORTUNITIES array ===");
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const p2 = {
    OPPORTUNITIES: [
      {
        OPP_BRANCH: "0101",
        OPP_DESCRIPTION: "PROPOSTA - CLIENTE TESTE",
        ACCOUNT_ENTITY: "SA1",
        ACCOUNT_ID: "0036080001",
        SALES_REPRESENTATIVE: "000001",
        PROCESS: "000001",
        SELECTED_STAGE: "000001",
        CURRENCY: "1",
        START_DATE: today,
        NOTES: "Integracao Bitrix"
      }
    ]
  };
  const r2 = await request('PUT', '/crmmopportunities', p2);
  console.log("PUT /crmmopportunities:", r2.status, r2.body);

  console.log("\n=== 3. Testar PUT /crmmopportunities com objeto único ===");
  const p3 = {
    OPP_BRANCH: "0101",
    OPP_DESCRIPTION: "PROPOSTA - CLIENTE TESTE",
    ACCOUNT_ENTITY: "SA1",
    ACCOUNT_ID: "0036080001",
    SALES_REPRESENTATIVE: "000001",
    PROCESS: "000001",
    SELECTED_STAGE: "000001",
    CURRENCY: "1",
    START_DATE: today
  };
  const r3 = await request('PUT', '/crmmopportunities', p3);
  console.log("PUT /crmmopportunities (single):", r3.status, r3.body);
}

run();

