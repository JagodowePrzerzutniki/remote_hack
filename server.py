#!/usr/bin/env python3
"""
Simple Persistent Message Board Server (Pure Python 3 Standard Library)
Zero dependencies required (No pip, no npm).
"""

import http.server
import socketserver
import sqlite3
import json
import urllib.parse
import os
import sys
import time
import threading
import platform
import subprocess
import shutil
import urllib.request
import gzip

PORT = int(os.environ.get("PORT", "8765"))
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "messages.db")

# Thread-local storage for SQLite connections
_local = threading.local()

def get_db():
    if not hasattr(_local, "db") or _local.db is None:
        _local.db = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.db.row_factory = sqlite3.Row
        with _local.db:
            _local.db.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room TEXT NOT NULL,
                    name TEXT NOT NULL,
                    text TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
            """)
            _local.db.execute("CREATE INDEX IF NOT EXISTS idx_room_id ON messages (room, id)")
    return _local.db


class RequestHandler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == "/health" or path == "/":
            db = get_db()
            cur = db.execute("SELECT COUNT(*) as count FROM messages")
            total = cur.fetchone()["count"]
            self._send_json({"status": "ok", "total_messages": total})
            return

        if path == "/api/messages":
            room = params.get("room", ["general"])[0].strip().lower()
            limit = int(params.get("limit", [50])[0])
            limit = min(max(1, limit), 500)
            since_id = int(params.get("since_id", [0])[0])

            db = get_db()
            if since_id > 0:
                cur = db.execute(
                    "SELECT id, room, name, text, created_at FROM messages WHERE room = ? AND id > ? ORDER BY id ASC LIMIT ?",
                    (room, since_id, limit),
                )
            else:
                cur = db.execute(
                    "SELECT id, room, name, text, created_at FROM (SELECT id, room, name, text, created_at FROM messages WHERE room = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC",
                    (room, limit),
                )

            rows = [
                {
                    "id": r["id"],
                    "room": r["room"],
                    "name": r["name"],
                    "text": r["text"],
                    "created_at": r["created_at"],
                }
                for r in cur.fetchall()
            ]
            self._send_json(rows)
            return

        if path == "/api/rooms":
            db = get_db()
            cur = db.execute("SELECT room, COUNT(*) as count, MAX(created_at) as last_activity FROM messages GROUP BY room")
            rooms = [{"room": r["room"], "count": r["count"], "last_activity": r["last_activity"]} for r in cur.fetchall()]
            self._send_json({"rooms": rooms})
            return

        self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/messages":
            content_length = int(self.headers.get("Content-Length", 0))
            if content_length == 0:
                self._send_json({"error": "Empty body"}, 400)
                return

            try:
                body = json.loads(self.rfile.read(content_length).decode("utf-8"))
            except Exception:
                self._send_json({"error": "Invalid JSON"}, 400)
                return

            room = (body.get("room") or "general").strip().lower()
            name = (body.get("name") or "agent").strip()
            text = str(body.get("text") or "").strip()

            if not text:
                self._send_json({"error": "Text is required"}, 400)
                return

            now = time.time()
            db = get_db()
            with db:
                cur = db.execute(
                    "INSERT INTO messages (room, name, text, created_at) VALUES (?, ?, ?, ?)",
                    (room, name, text, now),
                )
                msg_id = cur.lastrowid

            self._send_json({
                "id": msg_id,
                "room": room,
                "name": name,
                "text": text,
                "created_at": now,
            }, 201)
            return

        self._send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)

        if path == "/api/messages":
            room = params.get("room", [None])[0]
            db = get_db()
            with db:
                if room:
                    clean_room = room.strip().lower()
                    db.execute("DELETE FROM messages WHERE room = ?", (clean_room,))
                else:
                    db.execute("DELETE FROM messages")
            self._send_json({"ok": True, "message": f"Cleared messages for {room or 'all rooms'}"})
            return

        self._send_json({"error": "Not found"}, 404)


    def log_message(self, format, *args):
        # Silent or minimal logging
        pass


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_cloudflare_tunnel(port):
    """Start Cloudflare tunnel, auto-downloading standalone binary if needed."""
    bin_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".bin")
    os.makedirs(bin_dir, exist_ok=True)
    
    cf_path = shutil.which("cloudflared")
    if not cf_path:
        local_cf = os.path.join(bin_dir, "cloudflared.exe" if platform.system() == "Windows" else "cloudflared")
        if not os.path.exists(local_cf):
            print("⏳ Downloading lightweight Cloudflare tunnel binary (one-time setup)...")
            sys_name = platform.system().lower()
            machine = platform.machine().lower()

            if sys_name == "darwin":
                arch = "arm64" if "arm" in machine or "aarch" in machine else "amd64"
                url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-{arch}.tgz"
                tar_path = os.path.join(bin_dir, "cf.tgz")
                urllib.request.urlretrieve(url, tar_path)
                subprocess.run(["tar", "-xzf", tar_path, "-C", bin_dir], check=True)
                if os.path.exists(tar_path): os.remove(tar_path)
            elif sys_name == "linux":
                arch = "arm64" if "arm" in machine or "aarch" in machine else "amd64"
                url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}"
                urllib.request.urlretrieve(url, local_cf)
            elif sys_name == "windows":
                url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
                urllib.request.urlretrieve(url, local_cf)
            
            if os.path.exists(local_cf):
                os.chmod(local_cf, 0o755)
        cf_path = local_cf

    if not cf_path or not os.path.exists(cf_path):
        print("Could not launch cloudflared tunnel.")
        return None

    proc = subprocess.Popen(
        [cf_path, "tunnel", "--url", f"http://localhost:{port}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Read stderr for the public URL
    public_url = None
    start_time = time.time()
    while time.time() - start_time < 20:
        line = proc.stderr.readline()
        if "https://" in line and "trycloudflare.com" in line:
            import re
            match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if match:
                public_url = match.group(0)
                break
    return public_url


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Persistent Room Message Board Server")
    parser.add_argument("-p", "--port", type=int, default=PORT, help="Port to listen on (default: 8765)")
    parser.add_argument("--public", action="store_true", help="Create a public Cloudflare WAN tunnel")
    args = parser.parse_args()

    # Initialize DB schema
    get_db()

    server = ThreadedHTTPServer(("0.0.0.0", args.port), RequestHandler)
    local_url = f"http://localhost:{args.port}"

    print("=" * 60)
    print("📡 Message Board Server is LIVE!")
    print(f"📁 Database: {DB_PATH} (Persistent SQLite)")
    print(f"🏠 Local:    {local_url}")

    if args.public:
        print("⏳ Creating secure public WAN tunnel...")
        try:
            pub_url = start_cloudflare_tunnel(args.port)
            if pub_url:
                print(f"🌍 Public:   {pub_url}  <-- Share with your team!")
            else:
                print("Could not obtain public URL.")
        except Exception as e:
            print(f"Tunnel error: {e}")

    print("=" * 60)
    print("Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        server.shutdown()


if __name__ == "__main__":
    main()
