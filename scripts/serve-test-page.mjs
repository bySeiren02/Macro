// 로컬 테스트 페이지 정적 서버 (127.0.0.1 전용). 사용법: PORT=4173 node scripts/serve-test-page.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test-page');
const port = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const filePath = path.resolve(root, `.${relative}`);
    // 디렉터리 탈출(../) 차단
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const type = TYPES[path.extname(filePath)];
    if (!type) {
      res.writeHead(404).end('not found');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`test page: http://127.0.0.1:${port}/index.html`);
});
