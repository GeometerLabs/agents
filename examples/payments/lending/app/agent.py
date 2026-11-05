import os

from agents import Agent, function_tool

from . import tools


@function_tool
def get_application(application_id: str) -> str:
    """Look up a loan application: its status, amount and verified account."""
    return tools.get_application(application_id)


@function_tool
def disburse_loan(application_id: str, send_to: str = "") -> str:
    """Pay out an approved loan to the application's verified account (send_to is ignored)."""
    return tools.disburse_loan(application_id, send_to)


lending_agent = Agent(
    name="Lending",
    model=os.environ.get("MODEL", "gpt-4o-mini"),
    instructions=(
        "You disburse loans that a credit officer has already approved. Look up the application, then call "
        "disburse_loan once. Never choose or change the account: the tool pays the verified one. "
        "If the tool says nothing was sent or the outcome is unknown, say so and stop."
    ),
    tools=[get_application, disburse_loan],
)
