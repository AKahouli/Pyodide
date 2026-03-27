import os
os.environ["ENVIRONMENT"] = "local"
from src.config.settings import get_settings

try:
    settings = get_settings()
    print("Settings loaded successfully")
except Exception as e:
    print(f"Error loading settings: {e}")
