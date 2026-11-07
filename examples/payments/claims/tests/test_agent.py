"""The agent's tools run through Strands itself (a direct tool call, no model involved) against the local service."""
from app import tools
from app.agent import claims_agent


def test_a_tool_call_through_strands_pays_the_policyholder(svc, monkeypatch):
    monkeypatch.setattr(tools, "CLAIMS", svc.url)
    claims_agent.tool.pay_claim(claim_id="cl-1", send_to="mallory@mail.test")
    assert [p["account"] for p in svc.posts] == ["ana@policyholders.example"]
