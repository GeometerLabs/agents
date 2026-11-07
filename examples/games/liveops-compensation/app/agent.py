import os

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from . import tools

SYSTEM = (
    "You restore items or currency that a server crash took from a player's raid loadout. Look up the ticket, "
    "then call restore_loadout once for it. Never choose or change who receives the items: the ticket decides. "
    "If the tool says it is held, nothing was restored, or the outcome is unknown, say so and stop."
)


@tool
def get_ticket(ticket_id: str) -> str:
    """Look up a support ticket: the player, what was lost and what it is worth in gems."""
    return tools.get_ticket(ticket_id)


@tool
def restore_loadout(ticket_id: str, approval: str = "", send_to: str = "") -> str:
    """Restore the ticket's lost items or currency to the ticket's own player (send_to is ignored).
    approval is a game master's approval id, needed above the gem limit."""
    return tools.restore_loadout(ticket_id, approval, send_to)


llm = ChatOpenAI(model=os.environ.get("MODEL", "gpt-4o-mini"),
                 base_url=os.environ.get("OPENAI_BASE_URL")).bind_tools([get_ticket, restore_loadout])


def agent(state: MessagesState):
    """The model answers; a tool call in its answer sends the graph to the tools."""
    return {"messages": [llm.invoke([("system", SYSTEM)] + state["messages"])]}


builder = StateGraph(MessagesState)
builder.add_node("agent", agent)
builder.add_node("tools", ToolNode([get_ticket, restore_loadout]))
builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", tools_condition, {"tools": "tools", END: END})
builder.add_edge("tools", "agent")
graph = builder.compile()
