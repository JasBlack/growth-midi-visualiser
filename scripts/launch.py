"""Serve Growth on this computer only, then open the browser once the server is listening.

Copied next to index.html by scripts/release.mjs. Keeps http://localhost:8765/
as the address so settings and preset slots saved by earlier versions load.
"""
import argparse
import functools
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    # Python reads MIME types from the Windows registry, where .js / .mjs can be
    # text/plain, which browsers refuse to run as a module.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.task': 'application/octet-stream',
        '.json': 'application/json',
    }

    def end_headers(self):
        # a new version in the same folder or on the same port must not be served from cache
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        pass


class Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second server bind a port that is already
    # in use, so a copy of an older version could answer instead of this one.
    allow_reuse_address = sys.platform != 'win32'

    def server_bind(self):
        if sys.platform == 'win32' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    handler = functools.partial(Handler, directory=str(Path(__file__).resolve().parent))
    try:
        # loopback only: the folder is not shared with the venue Wi-Fi
        server = Server(('127.0.0.1', args.port), handler)
    except OSError as error:
        print(f'Could not start Growth: {error}', flush=True)
        print(f'Port {args.port} is in use. Close the other Growth window, or run: python launch.py --port {args.port + 1}', flush=True)
        return 1
    with server:
        url = f'http://localhost:{server.server_port}/'
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f'Growth is ready at {url}\nKeep this window open. Ctrl+C stops the server.', flush=True)
        if not args.no_browser:
            try:
                if not webbrowser.open(url):
                    print('Open the address above in your browser.', flush=True)
            except webbrowser.Error:
                print('Open the address above in your browser.', flush=True)
        try:
            while thread.is_alive():
                thread.join(0.5)
        except KeyboardInterrupt:
            print('\nStopping Growth.', flush=True)
        finally:
            server.shutdown()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
