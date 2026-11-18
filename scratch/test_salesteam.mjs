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
  const p = {
    branchId: "0101",
    customerCode: "003608",
    storeId: "0001",
    description: "PROPOSTA - CLIENTE TESTE",
    salesmanCode: "000001",
    process: "000001",
    stage: "000001",
    currency: 1,
    salesTeam: [
      {
        salesmanCode: "000001",
        percentage: 100
      }
    ]
  };
  const res = await request('POST', '/api/crm/v1/opportunity', p);
  console.log("POST com salesTeam:", res.status, res.body);
}

run();

