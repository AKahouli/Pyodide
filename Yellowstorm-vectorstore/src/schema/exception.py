from typing import Optional


class APIBaseException(Exception):
    """Base exception for metachatbotAPI """
    def __init__(self, message: str, error_code: str = "API_BASE_EXCEPTION", details: Optional[dict] = None):
        self.message = message
        self.error_code = error_code
        self.details = details or {}
        super().__init__(self.message)