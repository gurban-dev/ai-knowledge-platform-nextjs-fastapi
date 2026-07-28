"""Worker process entrypoint."""

from __future__ import annotations

import sys

from arq.worker import run_worker

from akp_worker.settings import build_worker_settings


def main() -> None:
    run_worker(build_worker_settings())
    sys.exit(0)


if __name__ == "__main__":
    main()
