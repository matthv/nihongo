"""Minimal Chrome DevTools client (stdlib only) to drive chrome-headless-shell for UI checks."""
import base64, json, os, socket, struct, subprocess, sys, time, urllib.request

CHROME = os.path.expanduser('~/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell')
LIBS = os.path.expanduser('~/.local/opt/chrome-libs/usr/lib/x86_64-linux-gnu')

class WS:
    def __init__(self, url):
        host, rest = url[len('ws://'):].split('/', 1)
        h, p = host.split(':')
        self.s = socket.create_connection((h, int(p)))
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f'GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.s.recv(4096)
        self.buf = buf.split(b'\r\n\r\n', 1)[1]
        self.id = 0
    def _read(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d: raise EOFError
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        return out
    def send(self, obj):
        data = json.dumps(obj).encode()
        hdr = bytes([0x81])
        n = len(data)
        if n < 126: hdr += bytes([0x80 | n])
        elif n < 65536: hdr += bytes([0x80 | 126]) + struct.pack('>H', n)
        else: hdr += bytes([0x80 | 127]) + struct.pack('>Q', n)
        mask = os.urandom(4)
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))
    def recv(self):
        msg = b''
        while True:
            b1, b2 = self._read(2)
            n = b2 & 0x7f
            if n == 126: n = struct.unpack('>H', self._read(2))[0]
            elif n == 127: n = struct.unpack('>Q', self._read(8))[0]
            msg += self._read(n)
            if b1 & 0x80: return json.loads(msg)
    def call(self, method, **params):
        self.id += 1
        self.send({'id': self.id, 'method': method, 'params': params})
        while True:
            m = self.recv()
            if m.get('id') == self.id:
                if 'error' in m: raise RuntimeError(m['error'])
                return m.get('result', {})
            if m.get('method') == 'Runtime.consoleAPICalled':
                print('  [console]', ' '.join(str(a.get('value', a.get('description'))) for a in m['params']['args']))
            if m.get('method') == 'Runtime.exceptionThrown':
                print('  [exception]', m['params']['exceptionDetails'].get('exception', {}).get('description'))

class Browser:
    def __init__(self, width=1200, height=900, mobile=False, dark=False):
        env = dict(os.environ, LD_LIBRARY_PATH=LIBS)
        self.proc = subprocess.Popen([CHROME, '--remote-debugging-port=9333', '--no-sandbox', f'--window-size={width},{height}', 'about:blank'],
                                     env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen('http://127.0.0.1:9333/json'))
                page = [t for t in tabs if t['type'] == 'page'][0]
                break
            except Exception:
                time.sleep(0.2)
        self.ws = WS(page['webSocketDebuggerUrl'])
        self.ws.call('Runtime.enable')
        self.ws.call('Page.enable')
        if mobile:
            self.ws.call('Emulation.setDeviceMetricsOverride', width=width, height=height, deviceScaleFactor=2, mobile=True)
        if dark:
            self.ws.call('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'dark'}])
    def go(self, url, wait=1.5):
        self.ws.call('Page.navigate', url=url)
        time.sleep(wait)
    def js(self, expr, wait=0):
        r = self.ws.call('Runtime.evaluate', expression=expr, awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in r: print('  [js error]', r['exceptionDetails'].get('exception', {}).get('description'))
        if wait: time.sleep(wait)
        return r.get('result', {}).get('value')
    def shot(self, path, full=False):
        params = {'format': 'png'}
        if full:
            m = self.ws.call('Page.getLayoutMetrics')
            cs = m['cssContentSize']
            params.update(captureBeyondViewport=True, clip={'x': 0, 'y': 0, 'width': cs['width'], 'height': min(cs['height'], 6000), 'scale': 1})
        data = self.ws.call('Page.captureScreenshot', **params)['data']
        open(path, 'wb').write(base64.b64decode(data))
    def close(self):
        self.proc.terminate()
