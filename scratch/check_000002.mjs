import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');
const where = encodeURIComponent("AD1_NROPOR = '000002'");

const req = https.request({
  hostname: '192.168.0.80',
  port: 8887,
  path: '/rest/api/framework/v1/genericQuery?tables=AD1&fields=AD1_NROPOR,AD1_DESCRI,AD1_VEND,AD1_CODCLI&where=' + where,
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
  res.on('end', () => console.log('STATUS:', res.statusCode, '\nBODY:', b));
});

req.end();

