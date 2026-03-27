try:
    import ddtrace
    print("ddtrace found")
except ImportError:
    print("ddtrace NOT found")

try:
    import fastapi
    print("fastapi found")
except ImportError:
    print("fastapi NOT found")

try:
    import pydantic_settings
    print("pydantic_settings found")
except ImportError:
    print("pydantic_settings NOT found")
