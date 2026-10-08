@echo off
rem Pretty-prints the unified log envelopes while running the ADK locally.
rem Run from an activated conda env (conda activate meta).
cmd /c "python main.py 2>&1 | node ..\scripts\observability\pretty.mjs"
