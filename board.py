#!/usr/bin/env python3
"""
Simple Terminal Message Board Client (Pure Python 3 Standard Library)
Zero dependencies required (No pip, no npm).
"""

import urllib.request
import urllib.parse
import urllib.error
import json
import os
import sys
import time
import argparse

RC_PATH = os.path.join(os.getcwd(), ".boardrc")


def load_config():
    cfg = {
        "server": os.environ.get("BOARD_SERVER", "http://localhost:8765"),
        "room": os.environ.get("BOARD_ROOM", "general"),
        "name": os.environ.get("BOARD_NAME", "agent"),
    }
    if os.path.exists(RC_PATH):
        try:
            with open(RC_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if "server" in saved: cfg["server"] = saved["server"]
                if "room" in saved: cfg["room"] = saved["room"]
                if "name" in saved: cfg["name"] = saved["name"]
        except Exception:
            pass
    return cfg


def save_config(updates):
    cfg = load_config()
    cfg.update(updates)
    with open(RC_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
    return cfg


class BoardClient:
    def __init__(self, server=None, room=None, name=None):
        cfg = load_config()
        self.server = (server or cfg["server"]).rstrip("/")
        self.room = (room or cfg["room"]).strip().lower()
        self.name = (name or cfg["name"]).strip()

    def _req(self, path, method="GET", body=None):
        url = f"{self.server}{path}"
        headers = {"Content-Type": "application/json"}
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            raise RuntimeError(f"HTTP {e.code}: {err_body or e.reason}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Could not connect to {self.server}: {e.reason}")

    def send(self, text, room=None, name=None):
        """Send a message to the room."""
        r = (room or self.room).strip().lower()
        n = (name or self.name).strip()
        return self._req("/api/messages", "POST", {"room": r, "name": n, "text": text})

    def read(self, limit=50, since_id=0, room=None):
        """Read messages from persistent storage."""
        r = (room or self.room).strip().lower()
        path = f"/api/messages?room={urllib.parse.quote(r)}&limit={limit}&since_id={since_id}"
        return self._req(path) or []

    def clear(self, room=None):
        """Clear all messages in a room."""
        r = (room or self.room).strip().lower()
        return self._req(f"/api/messages?room={urllib.parse.quote(r)}", "DELETE")

    def rooms(self):
        """List active rooms."""
        return self._req("/api/rooms") or {"rooms": []}

    def listen(self, room=None, poll_interval=1.5):
        """Poll and print new messages in real-time."""
        r = (room or self.room).strip().lower()
        print(f"📡 Listening to room '{r}' on {self.server}... (Ctrl+C to exit)\n")

        # Initial fetch of latest messages
        initial = self.read(limit=20, room=r)
        last_id = 0
        for m in initial:
            last_id = max(last_id, m["id"])
            t = time.strftime("%H:%M:%S", time.localtime(m["created_at"]))
            print(f"[{t}] {m['name']}: {m['text']}")

        while True:
            time.sleep(poll_interval)
            try:
                new_msgs = self.read(limit=100, since_id=last_id, room=r)
                for m in new_msgs:
                    last_id = max(last_id, m["id"])
                    t = time.strftime("%H:%M:%S", time.localtime(m["created_at"]))
                    print(f"[{t}] {m['name']}: {m['text']}")
            except Exception as e:
                print(f"[Warning: {e}]", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Terminal Message Board (Pure Python)")
    subparsers = parser.add_subparsers(dest="command", help="Commands")

    # config
    cfg_p = subparsers.add_parser("config", help="Save default server URL, room, or name")
    cfg_p.add_argument("-s", "--server", help="Server URL (e.g. https://xxx.trycloudflare.com)")
    cfg_p.add_argument("-r", "--room", help="Room code (e.g. hack1)")
    cfg_p.add_argument("-n", "--name", help="Your name / Agent name")

    # send
    send_p = subparsers.add_parser("send", help="Send a message")
    send_p.add_argument("message", nargs="+", help="Message text")
    send_p.add_argument("-s", "--server", help="Server URL")
    send_p.add_argument("-r", "--room", help="Room code")
    send_p.add_argument("-n", "--name", help="Sender name")

    # read
    read_p = subparsers.add_parser("read", help="Read messages")
    read_p.add_argument("-n", "--limit", type=int, default=30, help="Number of messages (default: 30)")
    read_p.add_argument("-s", "--server", help="Server URL")
    read_p.add_argument("-r", "--room", help="Room code")

    # clear
    clear_p = subparsers.add_parser("clear", help="Clear messages in a room")
    clear_p.add_argument("-s", "--server", help="Server URL")
    clear_p.add_argument("-r", "--room", help="Room code")

    # listen
    listen_p = subparsers.add_parser("listen", help="Stream new messages live")
    listen_p.add_argument("-s", "--server", help="Server URL")
    listen_p.add_argument("-r", "--room", help="Room code")

    # rooms
    rooms_p = subparsers.add_parser("rooms", help="List active rooms")
    rooms_p.add_argument("-s", "--server", help="Server URL")

    args = parser.parse_args()

    if args.command == "config":
        updates = {}
        if args.server: updates["server"] = args.server
        if args.room: updates["room"] = args.room
        if args.name: updates["name"] = args.name
        saved = save_config(updates)
        print("Saved configuration to .boardrc:")
        print(f"  Server: {saved['server']}")
        print(f"  Room:   {saved['room']}")
        print(f"  Name:   {saved['name']}")

    elif args.command == "send":
        client = BoardClient(server=args.server, room=args.room, name=args.name)
        text = " ".join(args.message).strip()
        res = client.send(text)
        print(f"[{res['room']}] {res['name']}: {res['text']}")

    elif args.command == "read":
        client = BoardClient(server=args.server, room=args.room)
        msgs = client.read(limit=args.limit)
        if not msgs:
            print(f"(No messages in room '{client.room}')")
            return
        for m in msgs:
            t = time.strftime("%H:%M:%S", time.localtime(m["created_at"]))
            print(f"[{t}] {m['name']}: {m['text']}")

    elif args.command == "clear":
        client = BoardClient(server=args.server, room=args.room)
        res = client.clear()
        print(f"✓ {res.get('message', 'Cleared messages')}")

    elif args.command == "listen":
        client = BoardClient(server=args.server, room=args.room)
        try:
            client.listen()
        except KeyboardInterrupt:
            print("\nStopped listening.")

    elif args.command == "rooms":
        client = BoardClient(server=args.server)
        res = client.rooms()
        rooms = res.get("rooms", [])
        if not rooms:
            print("No active rooms.")
            return
        print(f"Active rooms on {client.server}:")
        for r in rooms:
            t = time.strftime("%H:%M:%S", time.localtime(r["last_activity"]))
            print(f"  • {r['room']:<20} ({r['count']} messages, last active {t})")

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
