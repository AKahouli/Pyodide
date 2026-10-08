from src.config.settings import get_settings
s = get_settings()
print(f'GRPC_ENABLED={s.GRPC_ENABLED}')
print(f'GRPC_PORT={s.GRPC_PORT}')
print(f'GRPC_ALLOW_INSECURE={getattr(s, "GRPC_ALLOW_INSECURE", "NOT SET")}')
import os
print(f'GRPC_ALLOW_INSECURE env={os.getenv("GRPC_ALLOW_INSECURE", "NOT SET")}')