"""python -m app "Pay claim cl-1." """
import sys

from .agent import claims_agent

print(claims_agent(" ".join(sys.argv[1:])))
