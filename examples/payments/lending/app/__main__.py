"""python -m app "Disburse the approved loan for application a-1." """
import asyncio
import sys

from agents import Runner

from .agent import lending_agent

print(asyncio.run(Runner.run(lending_agent, " ".join(sys.argv[1:]))).final_output)
