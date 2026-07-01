"""Affiche les derniers appels LiteLLM (end_user, modèle, coût). Usage: ./.venv/bin/python check_litellm_log.py"""
import httpx, json
from src.config.settings import get_settings
s = get_settings()
base = s.LITELLM_API_BASE_URL.rstrip('/')
logs = httpx.get(base + '/spend/logs',
                 headers={'Authorization': 'Bearer ' + s.LITELLM_API_SECRET_KEY},
                 timeout=20).json()
# tri par startTime, on montre les 8 plus récents
logs.sort(key=lambda l: l.get('startTime') or '', reverse=True)
print(f"{'startTime':<28} {'end_user':<35} {'model'}")
print('-' * 90)
for l in logs[:8]:
    print(f"{str(l.get('startTime'))[:26]:<28} {str(l.get('end_user')):<35} {l.get('model')}")
