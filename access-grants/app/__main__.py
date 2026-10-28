"""python -m app "Grant the role on request r-1." """
import asyncio
import sys

from google.adk.runners import InMemoryRunner
from google.genai import types

from .agent import root_agent


async def main(text):
    runner = InMemoryRunner(agent=root_agent, app_name="access_grants")
    session = await runner.session_service.create_session(app_name="access_grants", user_id="operator")
    message = types.Content(role="user", parts=[types.Part(text=text)])
    async for event in runner.run_async(user_id="operator", session_id=session.id, new_message=message):
        if event.is_final_response() and event.content:
            print(event.content.parts[0].text)

asyncio.run(main(" ".join(sys.argv[1:])))
