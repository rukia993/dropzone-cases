import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve(process.argv.includes('--dist')?'dist':'.');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+sep)){res.writeHead(403).end();return}if(file.includes(sep+'assets'+sep)&&!process.argv.includes('--dist'))file=file.replace(root+sep+'assets',root+sep+'public'+sep+'assets');if(!(await stat(file)).isFile()){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(file))}catch{res.writeHead(404).end('Not found')}});
server.listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));
