import os

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")  # no data leaves the machine except the model calls

from crewai import LLM, Agent, Crew, Task
from crewai.tools import tool

from . import tools


@tool("get_request")
def get_request(request_id: str) -> str:
    """Look up a purchase request: the buyer, supplier, item, amount and the buyer's limit."""
    return tools.get_request(request_id)


@tool("place_order")
def place_order(request_id: str, approval: str = "") -> str:
    """Place the order for a purchase request, once. approval is the buyer's own approval id, needed when the
    amount is above the buyer's limit."""
    return tools.place_order(request_id, approval)


def buyer_agent(llm=None):
    return Agent(
        role="Purchasing agent",
        goal="Order supplies for purchase requests that are within the buyer's mandate",
        backstory=("You buy supplies for a team. The purchase request decides the supplier, item and amount, and "
                   "each request is ordered once. If a tool says an order is held, was already placed or its "
                   "outcome is unknown, report that and stop."),
        tools=[get_request, place_order],
        llm=llm or LLM(model="openai/" + os.environ.get("MODEL", "gpt-4o-mini"),
                       base_url=os.environ.get("OPENAI_BASE_URL"), api_key=os.environ.get("OPENAI_API_KEY")),
        allow_delegation=False,
    )


def build_crew(request, llm=None):
    agent = buyer_agent(llm)
    task = Task(description=request, expected_output="One sentence saying what was ordered, held or left alone.",
                agent=agent)
    return Crew(agents=[agent], tasks=[task])
