"""The crew's tools run through CrewAI itself against the local service; the crew builds with its agent and task."""
from app import tools
from app.agent import crew, place_order


def test_the_tool_places_one_order_through_crewai(svc, monkeypatch):
    monkeypatch.setattr(tools, "PROCUREMENT", svc.url)
    place_order.run(request_id="pr-1")
    assert "already ordered" in place_order.run(request_id="pr-1")
    assert len(svc.posts) == 1


def test_the_crew_has_one_agent_with_both_tools():
    assert [t.name for t in crew.agents[0].tools] == ["get_request", "place_order"]
