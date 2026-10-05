"""Local test server: serves www/ and relays /api/ to a nihongo-sync instance, like Apache does in production.
Usage: python3 outils/devserver.py [port] [sync-port]"""
import http.server, os, sys, urllib.request, urllib.error

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8797
SYNC = f'http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else 8798}'
WWW = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'www')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WWW, **kw)
    def relay(self):
        n = int(self.headers.get('Content-Length') or 0)
        req = urllib.request.Request(SYNC + self.path, data=self.rfile.read(n) if n else None, method=self.command)
        for h in ('Authorization', 'Content-Type'):
            if self.headers.get(h): req.add_header(h, self.headers[h])
        try:
            res = urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:
            res = e
        body = res.read()
        self.send_response(res.status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith('/api/'): return self.relay()
        super().do_GET()
    def do_PUT(self):
        if self.path.startswith('/api/'): return self.relay()
        self.send_error(405)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
