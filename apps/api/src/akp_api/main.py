"""API process entrypoint."""

from __future__ import annotations

import uvicorn
from akp_config import get_settings

from akp_api.app import create_app

app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "akp_api.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.NODE_ENV == "development",
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
