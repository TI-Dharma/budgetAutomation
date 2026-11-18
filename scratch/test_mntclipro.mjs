import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');

async function testPost(name, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve) => {
    const headers = {
      'Authorization': auth,
      'TenantId': '01,0101',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    };

    const req = https.request({
      hostname: '192.168.0.80',
      port: 8887,
      path: '/rest/api/crm/v1/opportunity',
      method: 'POST',
      headers,
      agent
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ name, status: res.statusCode, body: b }));
    });
    req.on('error', err => resolve({ name, status: 'ERR', body: err.message }));
    req.write(data);
    req.end();
  });
}

async function run() {
  const base = {
    branchId: "0101",
    description: "PROPOSTA - GUARNIERI SISTEMAS DE SEGURANCA",
    salesmanCode: "000001",
    process: "000001",
    stage: "000001",
    startDate: "2026-11-06",
    currency: 1,
    priority: "1",
    status: "1"
  };

  const tests = [
    {
      name: "1. Com customer sub-objeto",
      payload: {
        ...base,
        customer: {
          code: "003608",
          store: "0001",
          customerCode: "003608",
          storeId: "0001"
        }
      }
    },
    {
      name: "2. Com customerVendor sub-objeto",
      payload: {
        ...base,
        customerVendor: {
          code: "003608",
          store: "0001",
          customerVendorCode: "003608",
          storeId: "0001"
        }
      }
    },
    {
      name: "3. Com client sub-objeto",
      payload: {
        ...base,
        client: {
          code: "003608",
          store: "0001",
          clientCode: "003608",
          storeId: "0001"
        }
      }
    },
    {
      name: "4. Com prospect sub-objeto",
      payload: {
        ...base,
        prospect: {
          code: "003608",
          store: "0001"
        }
      }
    },
    {
      name: "5. Com customer e type",
      payload: {
        ...base,
        type: "1",
        customer: {
          customerCode: "003608",
          storeId: "0001"
        }
      }
    },
    {
      name: "6. Com account sub-objeto",
      payload: {
        ...base,
        account: {
          entity: "SA1",
          id: "0036080001",
          code: "003608",
          store: "0001"
        }
      }
    }
  ];

  for (const t of tests) {
    const res = await testPost(t.name, t.payload);
    console.log(`[${t.name}] Status: ${res.status} => ${res.body}`);
  }
}

run();

