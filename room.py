"""
Simple Message Board Client for Python AI Agents (Zero dependencies)
"""

import json
import urllib.request
import urllib.parse
import os
import sys
import time

# Load config from .roomrc if present
DEFAULT_SERVER = "http://localhost:8765"
DEFAULT_ROOM = "general"
DEFAULT_NAME = "python-agent"

if os.path.exists(".roomrc"):
    try:
        with open(".roomrc", "r") as f:
            cfg = json.load(f)
            DEFAULT_SERVER = cfg.get("server", DEFAULT_SERVER)
            DEFAULT_ROOM = cfg.get("room", DEFAULT_ROOM)
            DEFAULT_NAME = cfg.get("name", DEFAULT_NAME)
    except Exception:
        pass


class RoomClient:
    def __init__(self, server=None, room=None, name=None):
        self.server = (server or os.getenv("ROOM_SERVER") or DEFAULT_SERVER).rstrip("/")
        self.room = (room or os.getenv("ROOM_CODE") or DEFAULT_ROOM).strip().lower()
        self.name = (name or os.getenv("ROOM_NAME") or DEFAULT_NAME).strip()

    def _req(self, path, method="GET", body=None):
        url = f"{self.server}{path}"
        headers = {"Content-Type": "application/json"}
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req) as resp:
            text = resp.read().decode("utf-8")
            return json.loads(text) if text else None

    def send(self, text, room=None, name=None):
        r = room or self.room
        n = name or self.name
        return self._req(f"/api/rooms/{urllib.parse.quote(r)}/messages", "POST", {"name": n, "text": text})

    def read(self, limit=20, room=None):
        r = room or self.room
        return self._req(f"/api/rooms/{urllib.parse.quote(r)}/messages?limit={limit}")

    def afk(self, is_afk=True, reason="", room=None, name=None):
        r = room or self.room
        n = name or self.name
        return self._req(f"/api/rooms/{urllib.parse.quote(r)}/afk", "POST", {"name": n, "afk": is_afk, "reason": reason})

    def who(self, room=None):
        r = room or self.room
        return self._req(f"/api/rooms/{urllib.parse.quote(r)}/members")


if __name__ == "__main__":
    client = RoomClient()
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "send" and len(sys.argv) > 2:
            res = client.send(" ".join(sys.argv[2:]))
            print(f"[{res['room']}] {res['name']}: {res['text']}")
        elif cmd == "read":
            msgs = client.read()
            for m in msgs:
                print(f"[{time.strftime('%H:%M:%S', time.localtime(m['time']/1000))}] {m['name']}: {m['text']}")
        elif cmd == "who":
            data = client.who()
            print(f"Members in '{data['room']}':")
            for m in data.get("members", []):
                status = f"[AFK - {m.get('afkReason') or 'idle'}]" if m.get("afk") else "[ACTIVE]"
                print(f"  • {m['name']:<20} {status}")
        elif cmd == "afk":
            reason = sys.argv[2] if len(sys.argv) > 2 else "away"
            client.afk(True, reason)
            print(f"✓ Marked {client.name} as AFK ({reason})")
    else:
        print("Usage: python3 room.py [send <msg> | read | who | afk <reason>]")
