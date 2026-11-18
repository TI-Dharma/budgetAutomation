import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');
const where = encodeURIComponent("AD1_NROPOR = '052996'");
const url = '/rest/api/framework/v1/genericQuery?tables=AD1&fields=*&where=' + where;

const req = https.request({
  hostname: '192.168.0.80', port: 8887, path: url, method: 'GET',
  headers: { 'Authorization': auth, 'TenantId': '01,0101', 'Accept': 'application/json' },
  agent
}, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    try {
      const j = JSON.parse(b);
      console.log('Record found:', JSON.stringify(j.items?.[0] || j, null, 2));
    } catch {
      console.log('Raw:', b);
    }
  });
});
req.on('error', e => console.error(e));
req.end();

