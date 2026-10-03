import io
import threading
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from board import BoardClient


class ChatTests(unittest.TestCase):
    def test_chat_sends_and_displays_new_messages(self):
        client = BoardClient(server="http://unused", room="test", name="Alex")
        new_message_seen = threading.Event()
        sent = []
        reads = []

        def read(limit=50, since_id=0, room=None):
            reads.append((limit, since_id))
            if since_id == 0:
                return [{"id": 1, "created_at": 0, "name": "Pat", "text": "Earlier"}]
            new_message_seen.set()
            return [{"id": 2, "created_at": 0, "name": "Pat", "text": "Now"}]

        def user_input(prompt):
            if not sent:
                return "Hello Pat"
            self.assertTrue(new_message_seen.wait(1), "listener did not poll while input was open")
            return "/quit"

        client.read = read
        client.send = lambda message: sent.append(message)
        output = io.StringIO()
        with patch("builtins.input", side_effect=user_input), redirect_stdout(output):
            client.chat(poll_interval=0.001)

        self.assertEqual(sent, ["Hello Pat"])
        self.assertIn("Pat: Earlier", output.getvalue())
        self.assertIn("Pat: Now", output.getvalue())
        self.assertIn((100, 1), reads)


if __name__ == "__main__":
    unittest.main()
