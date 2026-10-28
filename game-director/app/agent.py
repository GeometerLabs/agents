import os

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from . import tools

INSTRUCTIONS = (
    "You are the director of a small game world's economy. For each world event, read it, then answer it: "
    "spawn_resource for a spawn event, set_price for a price event, each once. Keep spawns modest and prices "
    "sensible. If a tool says it is held, refused or already applied, say so and stop; do not try another way."
)


def default_model():
    provider = OpenAIProvider(base_url=os.environ.get("OPENAI_BASE_URL"), api_key=os.environ.get("OPENAI_API_KEY"))
    return OpenAIChatModel(os.environ.get("MODEL", "gpt-4o-mini"), provider=provider)


director = Agent(default_model(), instructions=INSTRUCTIONS)


@director.tool_plain
def get_event(event_id: str) -> str:
    """Read a world event: what happened and what the world suggests."""
    return tools.get_event(event_id)


@director.tool_plain
def spawn_resource(event_id: str, resource: str, count: int, approval: str = "") -> str:
    """Spawn units of a resource in answer to an event. Above the spawn limit, approval is a game master's id."""
    return tools.spawn_resource(event_id, resource, count, approval)


@director.tool_plain
def set_price(event_id: str, item: str, price: str) -> str:
    """Set a shop item's price in gems in answer to an event. Prices outside the allowed range are refused."""
    return tools.set_price(event_id, item, price)
