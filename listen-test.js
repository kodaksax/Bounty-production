// Minimal listening test to isolate OS/network issues
const http = require('http');
const PORT = process.env.TEST_PORT || 40055;
const server = http.createServer((req,res)=>{res.end('ok');});
server.listen(PORT, '0.0.0.0', () => {
  console.log('[listen-test] listening', server.address());
});
server.on('error', (e)=>{
  console.error('[listen-test] error', e);
});
setInterval(()=>process.stdout.write('#'), 3000);