"""python -m app "Order the supplies on purchase request pr-1." """
import sys

from .agent import crew

print(crew.kickoff(inputs={"request": " ".join(sys.argv[1:])}))
