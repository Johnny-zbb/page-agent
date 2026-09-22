#!/usr/bin/env python3
"""HTTP bridge from the browser demo to the Python Laya runtime."""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from laya import Router

HOST = os.getenv("LAYA_HOST", "127.0.0.1")
PORT = int(os.getenv("LAYA_PORT", "8765"))
DEVICE = os.getenv("LAYA_DEVICE") or None
MAX_LOADED = int(os.getenv("LAYA_MAX_LOADED", "2"))
PRELOAD = os.getenv("LAYA_PRELOAD", "0") == "1"

router = Router(device=DEVICE, max_loaded=MAX_LOADED, preload=PRELOAD)
predict_lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(204, {})

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"ok": True, "loaded": router.loaded, "device": DEVICE or "auto"})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/predict":
            self._send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            with predict_lock:
                result = router.predict(
                    payload["state"],
                    payload["questions"],
                    model=payload.get("model"),
                    task=payload.get("task"),
                    lang=payload.get("lang"),
                )
            self._send_json(200, result)
        except Exception as exc:
            self._send_json(500, {"error": type(exc).__name__, "message": str(exc)})

    def log_message(self, fmt, *args):
        print("[laya-sidecar] " + fmt % args)

if __name__ == "__main__":
    print("Laya sidecar listening on http://%s:%s" % (HOST, PORT))
    print("First request may download/build a checkpoint. Set LAYA_PRELOAD=1 for a warm demo.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
