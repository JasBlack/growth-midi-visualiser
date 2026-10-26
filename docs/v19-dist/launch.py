"""Start Growth locally, then open the browser once the server is listening."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parent))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        print(f'Could not start Growth: {error}', flush=True)
        print('Close the other server or run: python launch.py --port 8766', flush=True)
        return 1
    with server:
        url = f'http://localhost:{server.server_port}/'
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f'Growth is ready at {url}\nKeep this window open. Ctrl+C stops the server.', flush=True)
        if not args.no_browser:
            try:
                webbrowser.open(url)
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
