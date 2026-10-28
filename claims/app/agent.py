import os

from strands import Agent, tool

from . import tools

SYSTEM = (
    "You pay insurance claims that an adjuster has already approved. Look up the claim, then call pay_claim "
    "once. Never choose or change who is paid: the claim decides. If the tool says it is held, nothing was "
    "paid, or the outcome is unknown, say so and stop."
)


@tool
def get_claim(claim_id: str) -> str:
    """Look up a claim: its status, amount and the policyholder's account on file."""
    return tools.get_claim(claim_id)


@tool
def pay_claim(claim_id: str, approval: str = "", send_to: str = "") -> str:
    """Pay an approved claim to the policyholder's account on file (send_to is ignored).
    approval is an adjuster's approval id, needed above the payment limit."""
    return tools.pay_claim(claim_id, approval, send_to)


def default_model():
    if os.environ.get("MODEL_PROVIDER", "openai") == "bedrock":
        from strands.models.bedrock import BedrockModel
        return BedrockModel(model_id=os.environ["MODEL"])
    from strands.models.openai import OpenAIModel
    client_args = {"api_key": os.environ.get("OPENAI_API_KEY"), "base_url": os.environ.get("OPENAI_BASE_URL")}
    return OpenAIModel(client_args=client_args, model_id=os.environ.get("MODEL", "gpt-4o-mini"))


claims_agent = Agent(model=default_model(), system_prompt=SYSTEM, tools=[get_claim, pay_claim])
