"""The agent runs end to end with a scripted model in place of a real one: its tool call goes to the real
tool, which calls the (local) service."""
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart

from app import tools
from app.agent import director


def test_a_spawn_goes_through_the_tool(svc, monkeypatch):
    monkeypatch.setattr(tools, "WORLD", svc.url)
    calls = iter([ToolCallPart("spawn_resource", {"event_id": "ev-1", "resource": "iron-ore", "count": 40}),
                  TextPart("Done.")])
    script = FunctionModel(lambda messages, info: ModelResponse(parts=[next(calls)]))
    with director.override(model=script):
        assert director.run_sync("Handle world event ev-1.").output == "Done."
    assert svc.posts == [{"resource": "iron-ore", "count": 40, "approval": ""}]
