from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Medical Image FastAPI backend.")
    parser.add_argument("--host", default=os.getenv("MEDICAL_IMAGE_HOST", "127.0.0.1"))
    parser.add_argument("--port", default=int(os.getenv("MEDICAL_IMAGE_PORT", "8000")), type=int)
    parser.add_argument("--reload", action="store_true", help="Enable uvicorn reload for development.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    os.chdir(root)
    sys.path.insert(0, str(root))

    try:
        import uvicorn
    except ModuleNotFoundError:
        print(
            "Missing dependency: uvicorn. Install backend requirements first:\n"
            "  python -m pip install -r requirements.txt",
            file=sys.stderr,
        )
        raise SystemExit(1)

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
