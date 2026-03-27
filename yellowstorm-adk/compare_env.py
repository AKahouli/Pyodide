import os
from pydantic_settings import BaseSettings
from src.config.settings import Settings
import dotenv

# Load .env manually to check keys
env_data = dotenv.dotenv_values(".env")
env_keys = set(env_data.keys())

# Get Settings keys
settings_keys = set(Settings.model_fields.keys())

# Find extras
extras = env_keys - settings_keys
print(f"Extra keys in .env: {extras}")

# Find missing (required)
missing = [k for k, v in Settings.model_fields.items() if v.is_required() and k not in env_data and k not in os.environ]
print(f"Missing required keys in .env: {missing}")
