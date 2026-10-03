import json
import urllib.request
import urllib.parse
import os
import sys
import time

class RoomClient:
    def __init__(self, server=None, room=None, name=None):
        self.server = (server or os.getenv("ROOM_SERVER") or "http://localhost:8765").rstrip("/")
        self.room = (room or os.getenv("ROOM_CODE") or "general").strip().lower()
        self.name = (name or os.getenv("ROOM_NAME") or "python-agent").strip()

        # Load from .roomrc if present
        if os.path.exists(".roomrc"):
            try:
                with open(".roomrc") as f:
                    cfg = json.load(f)
                    if not server and "server" in cfg: self.server = cfg["server"].rstrip("/")
                    if not room and "room" in cfg: self.room = cfg["room"].strip().lower()
                    if not name and "name" in cfg: self.name = cfg["name"].strip()
            except Exception:
                pass

    def send(self, text, room=None, name=None):
        r = room or self.room
        n = name or self.name
        url = f"{self.server}/api/rooms/{urllib.parse.quote(r)}/messages"
        data = json.dumps({"name": n, "text": text}).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def read(self, limit=20, room=None):
        r = room or self.room
        url = f"{self.server}/api/rooms/{urllib.parse.quote(r)}/messages?limit={limit}"
        req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))


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
                t = time.strftime('%H:%M:%S', time.localtime(m['time']/1000))
                print(f"[{t}] {m['name']}: {m['text']}")
    else:
        print("Usage: python3 room.py send <message> | python3 room.py read")
