from fastapi import FastAPI

def add_cors(app: FastAPI) -> None:
    """
    Add CORS middleware to FastAPI application.
    """
    from fastapi.middleware.cors import CORSMiddleware

    # Set all CORS enabled origins
    origins = ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
