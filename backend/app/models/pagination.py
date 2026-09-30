from math import ceil
from typing import Generic, List, TypeVar

from pydantic import BaseModel, Field


ItemT = TypeVar("ItemT")


class PaginatedResponse(BaseModel, Generic[ItemT]):
    items: List[ItemT]
    page: int
    page_size: int = Field(..., alias="pageSize")
    total: int
    total_pages: int = Field(..., alias="totalPages")

    model_config = {"populate_by_name": True}


def build_page(items: list[ItemT], page: int, page_size: int, total: int) -> PaginatedResponse[ItemT]:
    return PaginatedResponse(
        items=items,
        page=page,
        pageSize=page_size,
        total=total,
        totalPages=ceil(total / page_size) if total else 0,
    )
