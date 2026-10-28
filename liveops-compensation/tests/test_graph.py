"""The graph runs end to end with a scripted model in place of a real one: a tool call goes to the real tool,
which calls the (local) service, and the result goes back to the model."""
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from app import agent, tools


class Scripted(GenericFakeChatModel):
    def bind_tools(self, *args, **kwargs):
        return self


def test_the_graph_restores_through_the_tool(svc, monkeypatch):
    monkeypatch.setattr(tools, "INVENTORY", svc.url)
    call = {"name": "restore_loadout", "args": {"ticket_id": "t-1", "send_to": "mallory@mail.test"}, "id": "c1"}
    scripted = Scripted(messages=iter([AIMessage(content="", tool_calls=[call]), AIMessage(content="Restored.")]))
    monkeypatch.setattr(agent, "llm", scripted)
    out = agent.graph.invoke({"messages": [("user", "Restore ticket t-1")]})
    assert out["messages"][-1].content == "Restored."
    assert [p["player"] for p in svc.posts] == ["ana@players.example"]
