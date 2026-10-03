"""
AgentMesh Python SDK
Zero-dependency client library for connecting AI agents to the AgentMesh Hub.
Works with Python 3.8+ using only the standard library.
"""

import json
import urllib.request
import urllib.error
import urllib.parse
import time
from typing import Dict, List, Optional, Any


class AgentMeshClient:
    def __init__(
        self,
        hub_url: str = "http://localhost:8765",
        agent_name: str = "Python-Agent",
        author_name: str = "Python-Dev",
        model_name: str = "Python-LLM",
        capabilities: Optional[List[str]] = None,
    ):
        self.hub_url = hub_url.rstrip("/")
        self.agent_name = agent_name
        self.author_name = author_name
        self.model_name = model_name
        self.capabilities = capabilities or ["python", "coding"]
        self.agent_id: Optional[str] = None

    def _request(self, method: str, path: str, data: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.hub_url}{path}"
        headers = {"Content-Type": "application/json"}
        req_data = json.dumps(data).encode("utf-8") if data is not None else None

        req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                res_body = resp.read().decode("utf-8")
                return json.loads(res_body) if res_body else None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                raise RuntimeError(err_json.get("error", f"HTTP {e.code}: {e.reason}"))
            except Exception:
                raise RuntimeError(f"HTTP {e.code}: {err_body or e.reason}")

    # --- Agent Registration & Heartbeat ---
    def register(self, status: str = "idle", current_task: Optional[str] = None) -> Dict[str, Any]:
        """Register the agent with the mesh hub."""
        payload = {
            "name": self.agent_name,
            "author": self.author_name,
            "model": self.model_name,
            "capabilities": self.capabilities,
            "status": status,
            "currentTask": current_task,
        }
        res = self._request("POST", "/api/agents/register", payload)
        self.agent_id = res.get("id")
        return res

    def heartbeat(self, current_task: Optional[str] = None, status: Optional[str] = None) -> None:
        """Send heartbeat to maintain active presence."""
        payload = {
            "id": self.agent_id,
            "name": self.agent_name,
            "currentTask": current_task,
            "status": status,
        }
        self._request("POST", "/api/agents/heartbeat", payload)

    def list_agents(self) -> List[Dict[str, Any]]:
        """List all online and registered agents."""
        return self._request("GET", "/api/agents")

    # --- Messaging ---
    def send_message(
        self,
        channel: str,
        content: str,
        mentions: Optional[List[str]] = None,
        reply_to_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a message to a team channel (e.g. 'general', 'architecture', 'backend', 'frontend')."""
        payload = {
            "channel": channel.lstrip("#").lower(),
            "content": content,
            "from_agent_id": self.agent_id or "python-agent",
            "from_agent_name": self.agent_name,
            "from_author": self.author_name,
            "is_human": False,
            "mentions": mentions or [],
            "reply_to_id": reply_to_id,
        }
        return self._request("POST", "/api/messages", payload)

    def read_messages(
        self,
        channel: Optional[str] = None,
        limit: int = 20,
        since: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Read recent messages from a channel."""
        params = [f"limit={limit}"]
        if channel:
            params.append(f"channel={urllib.parse.quote(channel.lstrip('#').lower())}")
        if since:
            params.append(f"since={since}")
        path = f"/api/messages?{'&'.join(params)}"
        return self._request("GET", path)

    # --- Tasks (Kanban) ---
    def list_tasks(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """List tasks on the shared board."""
        path = f"/api/tasks?status={urllib.parse.quote(status)}" if status else "/api/tasks"
        return self._request("GET", path)

    def create_task(
        self,
        title: str,
        description: str = "",
        priority: str = "medium",
        assignee: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new task on the shared board."""
        payload = {
            "title": title,
            "description": description,
            "priority": priority,
            "created_by_agent": self.agent_name,
            "created_by_author": self.author_name,
            "assigned_to_agent": assignee,
        }
        return self._request("POST", "/api/tasks", payload)

    def claim_task(self, task_id: str) -> Dict[str, Any]:
        """Atomically claim a task so no other agent duplicates work."""
        payload = {
            "status": "in_progress",
            "assigned_to_agent": self.agent_name,
            "assigned_to_author": self.author_name,
        }
        return self._request("PATCH", f"/api/tasks/{task_id}", payload)

    def update_task(
        self,
        task_id: str,
        status: str,
        result_notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Update task progress or mark complete."""
        payload = {"status": status, "result_notes": result_notes}
        return self._request("PATCH", f"/api/tasks/{task_id}", payload)

    # --- Concurrency Resource Locks ---
    def acquire_lock(
        self,
        resource_path: str,
        reason: str = "Editing resource",
        ttl_minutes: int = 15,
    ) -> bool:
        """Lock a file or module to prevent merge collisions."""
        payload = {
            "resource_path": resource_path,
            "locked_by_agent": self.agent_name,
            "locked_by_author": self.author_name,
            "reason": reason,
            "ttlMinutes": ttl_minutes,
        }
        res = self._request("POST", "/api/locks/acquire", payload)
        return res.get("success", False)

    def release_lock(self, resource_path: str) -> bool:
        """Release a locked file or module."""
        payload = {
            "resource_path": resource_path,
            "agent_name": self.agent_name,
        }
        res = self._request("POST", "/api/locks/release", payload)
        return res.get("success", False)

    def list_locks(self) -> List[Dict[str, Any]]:
        """List all active file locks."""
        return self._request("GET", "/api/locks")

    # --- Shared Blackboard Context ---
    def get_context(self, key: str) -> Optional[Dict[str, Any]]:
        """Get shared specification or schema by key."""
        try:
            return self._request("GET", f"/api/context/{urllib.parse.quote(key)}")
        except RuntimeError:
            return None

    def set_context(
        self,
        key: str,
        value: Any,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Set shared architecture specification, DB schema, or API contract."""
        payload = {
            "key": key,
            "value": value if isinstance(value, str) else json.dumps(value, indent=2),
            "description": description,
            "updated_by_agent": self.agent_name,
            "updated_by_author": self.author_name,
        }
        return self._request("POST", "/api/context", payload)

    def list_context_keys(self) -> List[Dict[str, Any]]:
        """List all context keys."""
        return self._request("GET", "/api/context")

    # --- Artifacts ---
    def share_artifact(
        self,
        name: str,
        content: str,
        file_type: str = "text",
        description: str = "",
    ) -> Dict[str, Any]:
        """Publish a code snippet or schema artifact."""
        payload = {
            "name": name,
            "content": content,
            "file_type": file_type,
            "description": description,
            "created_by_agent": self.agent_name,
            "created_by_author": self.author_name,
        }
        return self._request("POST", "/api/artifacts", payload)

    def get_artifact(self, name: str) -> Optional[Dict[str, Any]]:
        """Retrieve a shared artifact."""
        try:
            return self._request("GET", f"/api/artifacts/{urllib.parse.quote(name)}")
        except RuntimeError:
            return None
