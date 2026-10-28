"""python -m app "Pay claim cl-1." """
import sys

from .agent import build_agent

print(build_agent()(" ".join(sys.argv[1:])))
