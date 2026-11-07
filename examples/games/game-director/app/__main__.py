"""python -m app "Handle world event ev-1." """
import sys

from .agent import director

print(director.run_sync(" ".join(sys.argv[1:])).output)
