import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });
const auth = 'Basic ' + Buffer.from('Admin:Dharma@01').toString('base64');
const where = encodeURIComponent("X3_ARQUIVO = 'AD1'");
const url = '/rest/api/framework/v1/genericQuery?tables=SX3&fields=X3_CAMPO,X3_TITULO,X3_TIPO,X3_OBRIGAT&where=' + where;

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
      console.log('Fields count:', j.items?.length);
      console.log('Required fields:', j.items?.filter(x => x.x3_obrigat === 'X').map(x => x.x3_campo + ' (' + x.x3_titulo + ')'));
      console.log('All fields:', j.items?.map(x => x.x3_campo));
    } catch {
      console.log('Raw:', b);
    }
  });
});
req.on('error', e => console.error(e));
req.end();

