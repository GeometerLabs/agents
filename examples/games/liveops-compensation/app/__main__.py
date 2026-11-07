"""python -m app "Restore the loadout for ticket t-1." """
import sys

from .agent import graph

result = graph.invoke({"messages": [("user", " ".join(sys.argv[1:]))]}, {"recursion_limit": 12})
print(result["messages"][-1].content)
