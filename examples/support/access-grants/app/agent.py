import os

from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

from . import tools

INSTRUCTION = (
    "You grant roles that employees have asked for. Look up the request, then call grant_role once for it. "
    "Never choose or change who gets the role: the request decides. If the tool says it is held, nothing "
    "was granted, or the outcome is unknown, say so and stop."
)


def get_request(request_id: str) -> str:
    """Look up an access request: the account, the role and its privilege level (1 viewer, 2 editor, 3 admin)."""
    return tools.get_request(request_id)


def grant_role(request_id: str, approval: str = "", send_to: str = "") -> str:
    """Grant the role on the request to the request's own account (send_to is ignored).
    approval is a security lead's approval id, needed for admin roles."""
    return tools.grant_role(request_id, approval, send_to)


def default_model():
    """Any OpenAI-compatible endpoint through LiteLLM. For Gemini, replace this with the model name string."""
    return LiteLlm(model="openai/" + os.environ.get("MODEL", "gpt-4o-mini"),
                   api_base=os.environ.get("OPENAI_BASE_URL"), api_key=os.environ.get("OPENAI_API_KEY"))


root_agent = Agent(name="access_grants", model=default_model(), instruction=INSTRUCTION,
                   tools=[get_request, grant_role])
