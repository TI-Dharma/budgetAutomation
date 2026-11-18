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
  const payloads = [
    {
      name: "T-Talk com type, customerVendorCode, storeId",
      body: {
        branchId: "0101",
        description: "TESTE PROPOSTA AUTOMATICA BITRIX",
        type: "1",
        customerVendorCode: "003608",
        storeId: "0001",
        salesmanCode: "000001",
        process: "000001",
        stage: "000001",
        startDate: "2026-11-05",
        currency: 1,
        priority: "1",
        status: "1"
      }
    },
    {
      name: "T-Talk com accountId e accountType",
      body: {
        branchId: "0101",
        description: "TESTE PROPOSTA AUTOMATICA BITRIX",
        accountType: "1",
        accountId: "0036080001",
        salesRepresentative: "000001",
        process: "000001",
        stage: "000001",
        startDate: "20261105",
        currency: "1",
        priority: "1",
        status: "1"
      }
    },
    {
      name: "Payload clone crmmopportunities",
      body: {
        OPP_BRANCH: "0101",
        OPP_DESCRIPTION: "TESTE PROPOSTA AUTOMATICA BITRIX",
        ACCOUNT_ENTITY: "SA1",
        ACCOUNT_ID: "0036080001",
        SALES_REPRESENTATIVE: "000001",
        PROCESS: "000001",
        SELECTED_STAGE: "000001",
        START_DATE: "20261105",
        CURRENCY: "1"
      }
    }
  ];

  for (const p of payloads) {
    const res = await request('POST', '/api/crm/v1/opportunity', p.body);
    console.log(p.name, '=> Status:', res.status, res.body);
  }
}

run();

