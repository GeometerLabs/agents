"""The agent runs through ADK's own runner with a scripted model in place of a real one: its tool call goes to the
real tool, which calls the (local) service."""
import asyncio

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types

from app import agent, tools


class Scripted(BaseLlm):
    model: str = "scripted"

    async def generate_content_async(self, llm_request, stream=False):
        last = llm_request.contents[-1].parts[0]
        if last.function_response:
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="Granted.")]))
        else:
            call = types.FunctionCall(name="grant_role", args={"request_id": "r-1", "send_to": "mallory@mail.test"})
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(function_call=call)]))


def test_a_grant_goes_through_the_tool(svc, monkeypatch):
    monkeypatch.setattr(tools, "DIRECTORY", svc.url)
    scripted = agent.root_agent.model_copy(update={"model": Scripted()})

    async def run():
        runner = InMemoryRunner(agent=scripted, app_name="t")
        session = await runner.session_service.create_session(app_name="t", user_id="u")
        message = types.Content(role="user", parts=[types.Part(text="Grant r-1")])
        return [e async for e in runner.run_async(user_id="u", session_id=session.id, new_message=message)]

    events = asyncio.run(run())
    assert events[-1].content.parts[0].text == "Granted."
    assert [p["account"] for p in svc.posts] == ["ana@corp.example"]
