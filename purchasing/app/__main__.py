"""python -m app "Order the supplies on purchase request pr-1." """
import sys

from .agent import build_crew

print(build_crew(" ".join(sys.argv[1:])).kickoff())
