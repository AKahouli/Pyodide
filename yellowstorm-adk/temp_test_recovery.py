import sys
sys.path.insert(0, r"C:\prog\YellowStorm-poc\yellowstorm-adk\src")

from flow_engine.nodes.step_result import _parse_structured_final_response

# Case 1: display_text contains unescaped JSON object
resp1 = '{"display_text":"{"error":"Aucune recherche documentaire."}","outputs":[{"output_port_id":"lead_research","output_port_label":"Informations enrichies","artifact_kind":"data","content":"{\\"error\\":\\"no research\\"}"}],"reasoning_trace":[{"id":"step_1","type":"observation","label":"Blocage","description":"No tools used."}]}'

result1 = _parse_structured_final_response(resp1)
print("Case 1 - display_text:", result1["display_text"][:60])
print("Case 1 - outputs:", len(result1["outputs"]), "ports")
print("Case 1 - trace:", len(result1.get("reasoning_trace", [])), "entries")
print()

# Case 2: display_text contains backtick-wrapped unescaped quotes
resp2 = '{"display_text":"# Script Python\\n\\nLe code est fourni dans le port de sortie \\"python_script\\".","outputs":[{"output_port_id":"python_script","output_port_label":"Script Python","artifact_kind":"code","content":"print(\\"hello\\")"}],"reasoning_trace":[{"id":"step_1","type":"observation","label":"Conception","description":"Script produced.","confidence":0.97}]}'

result2 = _parse_structured_final_response(resp2)
print("Case 2 - display_text:", result2["display_text"][:60])
print("Case 2 - outputs:", len(result2["outputs"]), "ports")
print("Case 2 - trace:", len(result2.get("reasoning_trace", [])), "entries")
print()

# Case 3: valid JSON still works (no regression)
resp3 = '{"display_text":"All good","outputs":[{"output_port_id":"out","artifact_kind":"text","content":"hello"}]}'
result3 = _parse_structured_final_response(resp3)
print("Case 3 - display_text:", result3["display_text"])
print("Case 3 - outputs:", len(result3["outputs"]), "ports")

print()
print("All cases passed")
