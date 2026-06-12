"""This module contains the pydantic schema for chunk style."""
from pydantic import BaseModel, Field


class Coordinates(BaseModel):
    top: float = Field(
        ...,
        title="Top",
        description="Top coordinate of chunk",
    )
    left: float = Field(
        ...,
        title="Left",
        description="Left coordinate of chunk",
    )
    right: float = Field(
        ...,
        title="Right",
        description="Right coordinate of chunk",
    )
    bottom: float = Field(
        ...,
        title="Bottom",
        description="Bottom coordinate of chunk",
    )


class ChunkStyle(BaseModel):
    text: str = Field(
        ...,
        title="Text of chunk",
        description="Text of chunk detected.",
    )
    type: str = Field(
        ...,
        title="Type of chunk ",
        description="Type of chunk detected.",
    )
    page: int = Field(
        ...,
        title="Page number ",
        description="Page number of chunk",
    )
    coordinates: Coordinates = Field(
        ...,
        title="Coordinates of chunk",
        description="Coordinates of chunk",
    )
