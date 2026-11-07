"""python -m app "Order the supplies on purchase request pr-1." """
import sys

from .agent import crew

# The request a person types after the command replaces this one.
inputs = {"request": "Please order the supplies on purchase request id pr-1."}
if len(sys.argv) > 1:
    inputs["request"] = " ".join(sys.argv[1:])

print(crew.kickoff(inputs=inputs))
