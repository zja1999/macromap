#!/usr/bin/env python3
"""Macro Map — local dev server.

Like `python -m http.server` but sends no-cache headers, so the browser always
picks up your latest HTML/CSS/JS on reload (handy while iterating). For
production the app is just static files on GitHub Pages — this is dev-only.

    python scripts/dev_server.py [port]   # default port 8000
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Macro Map dev server on http://localhost:{PORT} (no-cache)")
        httpd.serve_forever()
