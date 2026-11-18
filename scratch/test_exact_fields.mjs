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
  const payload1 = {
    AD1_FILIAL: "0101",
    AD1_CODCLI: "003608",
    AD1_LOJCLI: "0001",
    AD1_DESCRI: "PROPOSTA - CLIENTE TESTE",
    AD1_VEND: "000001",
    AD1_PROVEN: "000001",
    AD1_STAGE: "000001",
    AD1_MOEDA: 1,
    AD1_PRIOR: "1",
    AD1_STATUS: "1",
    AD1_IDESTN: "01",
    AD1_USER: "000000",
    AD1_DATA: "20261105",
    AD1_HORA: "17:45",
    AD1_DTINI: "20261105"
  };

  console.log("=== 1. POST /api/crm/v1/opportunity com campos nativos exatos ===");
  const r1 = await request('POST', '/api/crm/v1/opportunity', payload1);
  console.log("r1:", r1.status, r1.body);

  console.log("\n=== 2. POST /api/framework/v1/data/AD1 com campos nativos exatos ===");
  const r2 = await request('POST', '/api/framework/v1/data/AD1', payload1);
  console.log("r2:", r2.status, r2.body);

  console.log("\n=== 3. POST /api/crm/v1/opportunity com customerVendorCode e customerStore ===");
  const payload3 = {
    branchId: "0101",
    description: "PROPOSTA - CLIENTE TESTE",
    customerVendorCode: "003608",
    customerStore: "0001",
    salesmanCode: "000001",
    process: "000001",
    stage: "000001",
    currency: 1,
    priority: "1",
    status: "1"
  };
  const r3 = await request('POST', '/api/crm/v1/opportunity', payload3);
  console.log("r3:", r3.status, r3.body);
}

run();

