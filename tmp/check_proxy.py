import requests
import json

def check_model(model_name):
    url = "https://dev.litellm.yellowmind.ai/chat/completions"
    headers = {"Content-Type": "application/json"}
    data = {
        "model": model_name,
        "messages": [{"role": "user", "content": "Say 'hello'"}],
        "max_tokens": 5
    }
    try:
        print(f"Checking model: {model_name}...")
        response = requests.post(url, headers=headers, json=data, timeout=10)
        print(f"Status: {response.status_code}")
        if response.status_code == 200:
            print(f"Response: {response.json()['choices'][0]['message']['content']}")
            return True
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Exception for {model_name}: {e}")
        return False

models = ["gpt-4.1", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.4-low", "gpt-5.4-medium"]
results = {}
for m in models:
    results[m] = check_model(m)

print("\nSummary:")
for m, res in results.items():
    print(f"{m}: {'OK' if res else 'FAILED'}")
