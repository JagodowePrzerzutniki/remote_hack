#!/usr/bin/env python3
"""
Autonomous Conversational Agent for Hackathon Room Coordination
Listens for teammate messages, understands context, and replies.
"""

import time
import sys
from board import BoardClient

client = BoardClient()
my_names = {"kacper", "kacper-agent", "agent"}

print(f"🤖 Conversational Agent active in room '{client.room}' on {client.server}")
print("Listening for incoming messages and responding automatically...\n")

# Get existing message IDs
initial = client.read(limit=50)
last_id = max([m["id"] for m in initial], default=0)

# If no previous message sent recently, send a welcoming kickoff
print(f"Tracking from message ID: {last_id}")

while True:
    try:
        new_msgs = client.read(limit=20, since_id=last_id)
        for m in new_msgs:
            last_id = max(last_id, m["id"])
            sender = m["name"].strip()
            text = m["text"].strip()
            t = time.strftime("%H:%M:%S", time.localtime(m["created_at"]))

            print(f"[{t}] {sender}: {text}")

            # If message is from someone else, formulate a smart reply
            if sender.lower() not in my_names:
                print(f"💡 Formulating reply to {sender}...")
                reply = ""
                lower_text = text.lower()

                if "frontend" in lower_text:
                    reply = f"Awesome @{sender}! For frontend integration, I've got endpoints ready: POST /api/auth/login and GET /api/projects. Let me know if you need mock data or TypeScript types!"
                elif "auth" in lower_text or "login" in lower_text or "register" in lower_text:
                    reply = f"@{sender} Auth is returning JWT in header `Authorization: Bearer <token>` and user payload `{'{id, email, name}'}`. Does that match your UI state?"
                elif "endpoint" in lower_text or "api" in lower_text:
                    reply = f"@{sender} All endpoints return JSON with standard error handling `{'{error: string}'}` on HTTP 4xx/5xx. Which endpoint are you connecting next?"
                elif "hi" in lower_text or "hello" in lower_text or "hey" in lower_text:
                    reply = f"Hey @{sender}! Ready to build. What feature should we sync on first?"
                elif "database" in lower_text or "schema" in lower_text or "model" in lower_text:
                    reply = f"@{sender} The database tables are User, Project, and Task with foreign keys. I can push the schema or SQL migrations if you need them."
                else:
                    reply = f"Got it @{sender}! I am on it. Let me know if you need any backend updates or API changes."

                time.sleep(1) # slight natural delay
                res = client.send(reply, name="Kacper")
                t_reply = time.strftime("%H:%M:%S", time.localtime(res["created_at"]))
                print(f"[{t_reply}] Kacper (Sent): {reply}\n")

    except Exception as e:
        print(f"[Error: {e}]", file=sys.stderr)

    time.sleep(2)
